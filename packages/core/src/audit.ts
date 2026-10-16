import { accessibleName, isHidden } from './dom';
import { collectActions } from './discoverers/actions';
import type { ScanReport } from './runtime';

export type WarningCode =
  | 'unlabeled-input'
  | 'placeholder-only-label'
  | 'div-button'
  | 'duplicate-name'
  | 'canvas-only-ui'
  | 'destructive-undeclared'
  | 'no-tools';

export interface AuditWarning {
  code: WarningCode;
  message: string;
  hint?: string;
}

function hint(el: Element): string {
  const cls =
    typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
}

/** Read-only peek at React's props for a DOM node (`__reactProps$*`). Never calls anything. */
function hasReactClick(el: Element): boolean {
  for (const k of Object.keys(el)) {
    if (k.startsWith('__reactProps$')) {
      const props = (el as unknown as Record<string, { onClick?: unknown } | undefined>)[k];
      if (props && typeof props.onClick === 'function') return true;
    }
  }
  return false;
}

const INTERACTIVE =
  'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[tabindex]';

/** Static findings about how well a page can be turned into tools. Pure DOM + the last scan report. */
export function auditDocument(doc: Document, report: ScanReport | undefined): AuditWarning[] {
  const warnings: AuditWarning[] = [];
  const win = doc.defaultView!;

  for (const el of Array.from(doc.querySelectorAll('input,select,textarea'))) {
    const type = (el as HTMLInputElement).type;
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    if (isHidden(el) || el.closest('[data-webmcp-ignore]')) continue;
    const labelled =
      el.getAttribute('aria-labelledby') ||
      el.getAttribute('aria-label') ||
      (el as HTMLInputElement).labels?.length ||
      el.closest('label') ||
      el.getAttribute('title');
    if (labelled && accessibleName(el)) continue;
    if (accessibleName(el)) {
      warnings.push({
        code: 'placeholder-only-label',
        message: 'Input is labelled only by its placeholder.',
        hint: hint(el),
      });
    } else {
      warnings.push({
        code: 'unlabeled-input',
        message: 'Input has no accessible name; agents cannot tell what it is for.',
        hint: hint(el),
      });
    }
  }

  let divButtons = 0;
  for (const el of Array.from(doc.querySelectorAll('div,span,li,img,svg,p'))) {
    if (
      el.getAttribute('role') ||
      el.hasAttribute('tabindex') ||
      el.closest('a,button,[role="button"],[role="link"]')
    )
      continue;
    if (isHidden(el)) continue;
    const clickable = el.hasAttribute('onclick') || hasReactClick(el);
    let pointer = false;
    if (!clickable) {
      try {
        const own = win.getComputedStyle(el).cursor === 'pointer';
        const parent = el.parentElement
          ? win.getComputedStyle(el.parentElement).cursor === 'pointer'
          : false;
        pointer = own && !parent;
      } catch {
        /* ignore */
      }
    }
    if (clickable || pointer) {
      if (divButtons++ < 20) {
        warnings.push({
          code: 'div-button',
          message:
            'Clickable element has no role; it is invisible to action tools. Use <button> or add role="button" and tabindex.',
          hint: hint(el),
        });
      }
    }
  }

  for (const name of report?.duplicates ?? []) {
    warnings.push({
      code: 'duplicate-name',
      message: `Several tools asked for the name "${name}"; later ones got numeric suffixes. Add data-webmcp-tool or aria-label to disambiguate.`,
      hint: name,
    });
  }

  const viewport = Math.max(1, win.innerWidth * win.innerHeight);
  let canvasArea = 0;
  for (const c of Array.from(doc.querySelectorAll('canvas'))) {
    const r = c.getBoundingClientRect();
    canvasArea += r.width * r.height;
  }
  const interactive = Array.from(doc.querySelectorAll(INTERACTIVE)).filter(
    (e) => !isHidden(e),
  ).length;
  if (canvasArea / viewport >= 0.3 && interactive <= 2) {
    warnings.push({
      code: 'canvas-only-ui',
      message:
        'The page is mostly <canvas> with almost no accessible controls; automatic discovery cannot help here. Expose tools explicitly.',
    });
  }

  for (const c of report?.candidates ?? []) {
    if (c.risk === 'destructive' && !c.riskDeclared) {
      warnings.push({
        code: 'destructive-undeclared',
        message: `Tool "${c.name}" is treated as destructive only because of a text heuristic. Declare it with data-webmcp-risk="destructive" (or in the manifest) so it is not lost if the label changes.`,
        hint: c.name,
      });
    }
  }

  if (
    report &&
    report.candidates.filter((c) => c.source !== 'navigation' && c.source !== 'snapshot').length ===
      0 &&
    collectActions(doc, 'safe').length === 0
  ) {
    warnings.push({
      code: 'no-tools',
      message: 'No form or action tools were found on this page.',
    });
  }
  return warnings;
}
