import { accessibleName, text } from './dom';
import { isSensitiveField } from './sensitive';

export interface FieldError {
  field: string;
  message: string;
}

/** Validation problems, from native validity and from ARIA (`aria-invalid` + described-by text). */
/**
 * `includeAria` is only meaningful AFTER a submit: apps leave `aria-invalid` from the previous
 * attempt in place until the next submit, so it is stale before one.
 */
export function collectValidationErrors(form: HTMLFormElement, includeAria = false): FieldError[] {
  const errors: FieldError[] = [];
  const seen = new Set<Element>();
  for (const el of Array.from(form.elements)) {
    const c = el as HTMLInputElement;
    if (typeof c.checkValidity !== 'function' || c.disabled) continue;
    // Omitted fields are handled separately (needs_user_input); never leak their state here.
    if (c.type === 'file' || isSensitiveField(el)) continue;
    if (!c.checkValidity()) {
      seen.add(el);
      errors.push({
        field: c.name || c.id || accessibleName(el),
        message: c.validationMessage || 'Invalid value',
      });
    }
  }
  if (!includeAria) return errors;
  for (const el of Array.from(form.querySelectorAll('[aria-invalid="true"]'))) {
    if (seen.has(el)) continue;
    const ids = el.getAttribute('aria-describedby') ?? el.getAttribute('aria-errormessage') ?? '';
    const msg = ids
      .split(/\s+/)
      .map((id) => text(el.ownerDocument.getElementById(id)))
      .filter(Boolean)
      .join(' ');
    errors.push({
      field: el.getAttribute('name') || el.id || accessibleName(el),
      message: msg || 'Invalid value',
    });
  }
  return errors;
}
