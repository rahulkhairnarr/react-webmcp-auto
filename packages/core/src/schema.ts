import { accessibleName, isHidden, text } from './dom';
import { isSensitiveField } from './sensitive';
import type { JsonSchema } from './types';

export type FieldKind =
  'text' | 'checkbox' | 'checkbox-group' | 'radio-group' | 'select' | 'contenteditable';

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  elements: Element[];
  schema: JsonSchema;
  required: boolean;
}

export interface OmittedField {
  label: string;
  reason: 'sensitive' | 'file' | 'hidden-payment';
  required: boolean;
  empty: boolean;
}

export interface FormModel {
  fields: Field[];
  omitted: OmittedField[];
}

const SKIP_TYPES = new Set(['submit', 'reset', 'button', 'image', 'hidden']);

function num(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function inputSchema(el: HTMLInputElement | HTMLTextAreaElement): JsonSchema {
  const type = el instanceof HTMLTextAreaElement ? 'textarea' : el.type;
  const s: JsonSchema = {};
  switch (type) {
    case 'number':
    case 'range': {
      s.type = 'number';
      const min = num(el.getAttribute('min'));
      const max = num(el.getAttribute('max'));
      if (min !== undefined) s.minimum = min;
      if (max !== undefined) s.maximum = max;
      const step = el.getAttribute('step');
      if (step && step !== 'any') {
        const st = num(step);
        if (st && st > 0) s.multipleOf = st;
      }
      return s;
    }
    case 'email':
      s.type = 'string';
      s.format = 'email';
      break;
    case 'url':
      s.type = 'string';
      s.format = 'uri';
      break;
    case 'date':
      s.type = 'string';
      s.format = 'date';
      break;
    case 'datetime-local':
      s.type = 'string';
      s.description = 'Local date-time, e.g. 2025-01-31T14:30';
      break;
    case 'time':
      s.type = 'string';
      s.format = 'time';
      break;
    case 'month':
      s.type = 'string';
      s.pattern = '^\\d{4}-\\d{2}$';
      break;
    case 'week':
      s.type = 'string';
      s.pattern = '^\\d{4}-W\\d{2}$';
      break;
    default:
      s.type = 'string';
  }
  if (
    type === 'date' ||
    type === 'time' ||
    type === 'month' ||
    type === 'week' ||
    type === 'datetime-local'
  ) {
    const min = el.getAttribute('min');
    const max = el.getAttribute('max');
    if (min || max) {
      s.description = [s.description, min && `min ${min}`, max && `max ${max}`]
        .filter(Boolean)
        .join('; ');
    }
  }
  const minLength = num(el.getAttribute('minlength'));
  const maxLength = num(el.getAttribute('maxlength'));
  if (minLength !== undefined) s.minLength = minLength;
  if (maxLength !== undefined) s.maxLength = maxLength;
  const pattern = el.getAttribute('pattern');
  if (pattern) s.pattern = pattern;
  return s;
}

function describe(schema: JsonSchema, label: string, extra?: string): JsonSchema {
  const parts = [label, schema.description as string | undefined, extra].filter(Boolean);
  return { ...schema, description: parts.join(' - ') };
}

function groupLabel(el: Element): string {
  const fs = el.closest('fieldset');
  const legend = fs?.querySelector(':scope > legend');
  return legend ? text(legend) : '';
}

function uniqueKey(base: string, used: Set<string>): string {
  let k = base || 'field';
  let i = 2;
  while (used.has(k)) k = `${base}_${i++}`;
  used.add(k);
  return k;
}

/** Infers the tool's field model from a form's controls. Sensitive and file inputs are omitted. */
export function buildFormModel(form: HTMLFormElement): FormModel {
  const fields: Field[] = [];
  const omitted: OmittedField[] = [];
  const used = new Set<string>();

  const controls = new Set<Element>([
    ...(Array.from(form.elements) as Element[]),
    ...Array.from(form.querySelectorAll('[contenteditable=""],[contenteditable="true"]')),
  ]);
  const groups = new Map<string, HTMLInputElement[]>();
  const order: (Element | string)[] = [];

  for (const el of controls) {
    if (el.closest('[data-webmcp-ignore]')) continue;
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'FIELDSET' || tag === 'OBJECT' || tag === 'OUTPUT') continue;
    const type = el instanceof HTMLInputElement ? el.type : '';
    if (SKIP_TYPES.has(type)) continue;

    const required = (el as HTMLInputElement).required === true;
    if (isSensitiveField(el)) {
      omitted.push({
        label: accessibleName(el) || el.getAttribute('name') || 'sensitive field',
        reason: (el.getAttribute('autocomplete') ?? '').startsWith('cc-')
          ? 'hidden-payment'
          : 'sensitive',
        required,
        empty: !(el as HTMLInputElement).value,
      });
      continue;
    }
    if (type === 'file') {
      omitted.push({ label: accessibleName(el) || 'file', reason: 'file', required, empty: true });
      continue;
    }
    if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) continue;
    if (isHidden(el)) continue;

    if (el instanceof HTMLInputElement && (type === 'radio' || type === 'checkbox') && el.name) {
      const gk = `${type}:${el.name}`;
      if (!groups.has(gk)) {
        groups.set(gk, []);
        order.push(gk);
      }
      groups.get(gk)!.push(el);
    } else {
      order.push(el);
    }
  }

  for (const item of order) {
    if (typeof item === 'string') {
      const els = groups.get(item)!;
      const first = els[0]!;
      const isRadio = first.type === 'radio';
      const label = groupLabel(first) || first.name;
      const key = uniqueKey(first.name, used);
      const labelled = els.map((e) => ({
        value: e.value || 'on',
        label: accessibleName(e) || e.value,
      }));
      if (!isRadio && els.length === 1) {
        fields.push({
          key,
          label: accessibleName(first) || label,
          kind: 'checkbox',
          elements: els,
          required: first.required,
          schema: describe({ type: 'boolean' }, accessibleName(first) || label),
        });
        continue;
      }
      const enumDesc = labelled.map((o) => `${o.value}: ${o.label}`).join('; ');
      const enumSchema: JsonSchema = { type: 'string', enum: labelled.map((o) => o.value) };
      fields.push({
        key,
        label,
        kind: isRadio ? 'radio-group' : 'checkbox-group',
        elements: els,
        required: els.some((e) => e.required),
        schema: describe(
          isRadio ? enumSchema : { type: 'array', items: enumSchema, uniqueItems: true },
          label,
          `Options: ${enumDesc}`,
        ),
      });
      continue;
    }

    const el = item;
    const label = accessibleName(el);
    const base =
      el.getAttribute('name') ||
      el.getAttribute('id') ||
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    if (!base) continue;
    const key = uniqueKey(base, used);
    const required =
      (el as HTMLInputElement).required === true || el.getAttribute('aria-required') === 'true';

    if (el instanceof HTMLSelectElement) {
      const opts = Array.from(el.options).filter((o) => !o.disabled && o.value !== '');
      const enumDesc = opts.map((o) => `${o.value}: ${text(o)}`).join('; ');
      const enumSchema: JsonSchema = { type: 'string', enum: opts.map((o) => o.value) };
      fields.push({
        key,
        label,
        kind: 'select',
        elements: [el],
        required,
        schema: describe(
          el.multiple ? { type: 'array', items: enumSchema } : enumSchema,
          label,
          `Options: ${enumDesc}`,
        ),
      });
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      let schema = inputSchema(el);
      const listId = el instanceof HTMLInputElement ? el.getAttribute('list') : null;
      const dl = listId ? el.ownerDocument.getElementById(listId) : null;
      let extra: string | undefined;
      if (dl) {
        const opts = Array.from(dl.querySelectorAll('option')).filter((o) => o.value);
        if (opts.length) {
          schema = { ...schema, enum: opts.map((o) => o.value) };
          extra = `Options: ${opts.map((o) => `${o.value}${o.label || o.text ? `: ${o.label || text(o)}` : ''}`).join('; ')}`;
        }
      }
      fields.push({
        key,
        label,
        kind: 'text',
        elements: [el],
        required,
        schema: describe(schema, label, extra),
      });
    } else {
      fields.push({
        key,
        label,
        kind: 'contenteditable',
        elements: [el],
        required,
        schema: describe({ type: 'string' }, label),
      });
    }
  }
  return { fields, omitted };
}

export function toInputSchema(model: FormModel): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const f of model.fields) properties[f.key] = f.schema;
  const schema: JsonSchema = { type: 'object', properties, additionalProperties: false };
  const required = model.fields.filter((f) => f.required).map((f) => f.key);
  if (required.length) schema.required = required;
  return schema;
}
