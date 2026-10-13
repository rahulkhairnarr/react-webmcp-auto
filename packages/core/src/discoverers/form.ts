import { accessibleName, currentRoute, deepQueryAll, isHidden, nearestHeading, text } from '../dom';
import { fillControl, FillError } from '../fill';
import { collectValidationErrors } from '../diagnostics';
import { slug } from '../naming';
import { classifyRisk, parseRisk } from '../risk';
import { buildFormModel, toInputSchema, type Field, type FormModel } from '../schema';
import type { Discoverer, ScanContext, ToolCandidate, ToolResult } from '../types';

function result(payload: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError } : {}),
  };
}

function submitButton(form: HTMLFormElement): HTMLElement | null {
  return form.querySelector<HTMLElement>(
    'button[type="submit"]:not([disabled]),button:not([type]):not([disabled]),input[type="submit"]:not([disabled])',
  );
}

export function resolveFormName(
  form: HTMLFormElement,
  route: string,
  index: number,
): { base: string; stable: boolean } {
  const attr = (n: string) => form.getAttribute(n)?.trim();
  const explicit = attr('data-webmcp-tool');
  if (explicit) return { base: explicit, stable: true };
  const toolname = attr('toolname');
  if (toolname) return { base: toolname, stable: true };
  const parts = [attr('aria-label'), attr('id'), attr('name'), nearestHeading(form)];
  for (const p of parts) if (p) return { base: `submit_${slug(p)}`, stable: true };
  const r = route.split('/').filter(Boolean).map(slug).join('_') || 'root';
  return { base: `submit_form_${r}_${index + 1}`, stable: false };
}

function nameSourceText(form: HTMLFormElement): string {
  const btn = submitButton(form);
  return [
    form.getAttribute('data-webmcp-tool'),
    form.getAttribute('aria-label'),
    form.id,
    form.getAttribute('name'),
    btn ? (btn.tagName === 'INPUT' ? (btn as HTMLInputElement).value : text(btn)) : '',
    form.getAttribute('action'),
  ]
    .filter(Boolean)
    .join(' ');
}

function relocate(candidateForm: HTMLFormElement, doc: Document): HTMLFormElement | null {
  if (candidateForm.isConnected) return candidateForm;
  const sel = candidateForm.id ? `form#${CSS.escape(candidateForm.id)}` : null;
  return sel ? doc.querySelector<HTMLFormElement>(sel) : null;
}

function describeForm(form: HTMLFormElement, model: FormModel, risk: string): string {
  const custom =
    form.getAttribute('data-webmcp-description') ?? form.getAttribute('tooldescription');
  const label = form.getAttribute('aria-label') || nearestHeading(form) || form.id || 'form';
  let d =
    custom?.trim() ||
    `Fill in and submit the "${label}" form on this page${form.ownerDocument.title ? ` (${form.ownerDocument.title})` : ''}.`;
  if (risk === 'destructive') d += ' This action is consequential and requires user confirmation.';
  const omitted = model.omitted.filter((o) => o.reason !== 'file');
  if (omitted.length) {
    d += ` Sensitive fields (${omitted.map((o) => o.label).join(', ')}) are not exposed; the user must enter them.`;
  }
  if (model.omitted.some((o) => o.reason === 'file')) d += ' File uploads are not supported.';
  return d;
}

export const formDiscoverer: Discoverer = {
  id: 'form',
  discover(ctx: ScanContext): ToolCandidate[] {
    const doc = ctx.document;
    const route = currentRoute(doc);
    const forms = deepQueryAll<HTMLFormElement>(doc, 'form').filter(
      (f) => !f.closest('[data-webmcp-ignore],[data-webmcp-ui]') && !isHidden(f),
    );
    const out: ToolCandidate[] = [];
    forms.forEach((form, index) => {
      const { base, stable } = resolveFormName(form, route, index);
      const model = buildFormModel(form);
      const risk = classifyRisk({
        text: nameSourceText(form),
        method: form.method,
        declared: form.getAttribute('data-webmcp-risk'),
      });
      const declaredRisk = parseRisk(form.getAttribute('data-webmcp-risk'));
      const key = stable ? `form:${base}` : `form:${route}:${index + 1}`;
      out.push({
        key,
        name: base,
        title: form.getAttribute('aria-label') || nearestHeading(form) || undefined,
        description: describeForm(form, model, declaredRisk ?? risk),
        inputSchema: toInputSchema(model),
        risk,
        source: 'form',
        node: form,
        execute: (input, opts) => executeForm(form, ctx, input, opts.signal),
      });
    });
    return out;
  },
};

async function executeForm(
  originalForm: HTMLFormElement,
  ctx: ScanContext,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const form = relocate(originalForm, ctx.document);
  if (!form) return result({ status: 'error', error: 'The form is no longer on the page.' }, true);
  const model = buildFormModel(form);
  const byKey = new Map<string, Field>(model.fields.map((f) => [f.key, f]));

  const unknown = Object.keys(input).filter((k) => !byKey.has(k));
  if (unknown.length) {
    return result(
      {
        status: 'error',
        error: `Unknown field(s): ${unknown.join(', ')}. Allowed: ${[...byKey.keys()].join(', ')}.`,
      },
      true,
    );
  }

  try {
    for (const [key, value] of Object.entries(input)) {
      if (signal?.aborted) return result({ status: 'cancelled' }, true);
      const field = byKey.get(key)!;
      applyValue(field, value);
    }
  } catch (e) {
    if (e instanceof FillError) return result({ status: 'error', error: e.message }, true);
    throw e;
  }

  // Let the framework re-render (controlled inputs, resolver-based validation).
  await ctx.settle({ quietMs: 60, timeoutMs: 1500 });

  const errors = collectValidationErrors(form);
  if (errors.length) {
    try {
      form.reportValidity?.();
    } catch {
      /* purely cosmetic */
    }
    return result({ status: 'validation_failed', errors }, true);
  }

  const needsUser = model.omitted.filter((o) => o.reason !== 'file' && o.required && o.empty);
  if (needsUser.length) {
    return result({
      status: 'needs_user_input',
      message:
        'Fields were filled, but the form was NOT submitted because sensitive fields must be entered by the user.',
      userMustFill: needsUser.map((o) => o.label),
    });
  }
  const requiredFiles = model.omitted.filter((o) => o.reason === 'file' && o.required && o.empty);
  if (requiredFiles.length) {
    return result(
      {
        status: 'error',
        error: `This form requires a file upload (${requiredFiles.map((f) => f.label).join(', ')}), which agents cannot provide.`,
      },
      true,
    );
  }

  const btn = submitButton(form);
  try {
    if (btn && (btn instanceof HTMLButtonElement || btn instanceof HTMLInputElement))
      form.requestSubmit(btn);
    else form.requestSubmit();
  } catch (e) {
    return result({ status: 'error', error: `Submit failed: ${(e as Error).message}` }, true);
  }

  const settled = await ctx.settle();
  const after = collectValidationErrors(
    form.isConnected ? form : (relocate(form, ctx.document) ?? form),
    true,
  );
  const win = ctx.document.defaultView;
  const payload = {
    status: after.length ? 'submitted_with_errors' : 'submitted',
    url: win ? win.location.pathname + win.location.search : undefined,
    routeChanged: settled.route,
    messages: settled.alerts,
    errors: after,
    timedOut: settled.timedOut,
  };
  return result(payload, after.length > 0);
}

function applyValue(field: Field, value: unknown): void {
  const allowed = (field.schema.items?.enum ?? field.schema.enum) as unknown[] | undefined;
  const check = (v: unknown) => {
    if (allowed && !allowed.map(String).includes(String(v))) {
      throw new FillError(
        `Invalid value "${String(v)}" for "${field.key}". Allowed: ${allowed.join(', ')}.`,
      );
    }
  };
  switch (field.kind) {
    case 'radio-group': {
      check(value);
      const target = (field.elements as HTMLInputElement[]).find(
        (e) => (e.value || 'on') === String(value),
      );
      if (target) fillControl(target, true);
      return;
    }
    case 'checkbox-group': {
      const wanted = new Set((Array.isArray(value) ? value : [value]).map(String));
      wanted.forEach(check);
      for (const e of field.elements as HTMLInputElement[])
        fillControl(e, wanted.has(e.value || 'on'));
      return;
    }
    case 'select':
      (Array.isArray(value) ? value : [value]).forEach(check);
      return fillControl(field.elements[0]!, value);
    default:
      return fillControl(field.elements[0]!, value);
  }
}

// Exported for tests/audit.
export { accessibleName };
