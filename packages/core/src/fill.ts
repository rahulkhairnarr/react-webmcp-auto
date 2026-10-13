/**
 * Fill controls the way a user would, in a way React (and other frameworks) notice.
 * Controlled inputs ignore `el.value = x` because React tracks the value via an own-property
 * shadow; calling the PROTOTYPE setter bypasses that tracker, then bubbling events notify React.
 */

export class FillError extends Error {}

function win(el: Element): Window & typeof globalThis {
  return (el.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
}

function fire(el: Element, type: string, init: EventInit = { bubbles: true }): void {
  el.dispatchEvent(new (win(el).Event)(type, { bubbles: true, ...init }));
}

export function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const w = win(el);
  const proto =
    el instanceof w.HTMLTextAreaElement
      ? w.HTMLTextAreaElement.prototype
      : el instanceof w.HTMLSelectElement
        ? w.HTMLSelectElement.prototype
        : w.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  fire(el, 'input');
  fire(el, 'change');
}

function setChecked(el: HTMLInputElement, want: boolean): void {
  if (el.checked !== want) el.click(); // click toggles, fires input/change, and is what React listens to
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

export function fillControl(el: Element, value: unknown): void {
  const w = win(el);
  if (el instanceof w.HTMLInputElement) {
    const type = el.type;
    if (type === 'file')
      throw new FillError(`File inputs cannot be filled by agents (${el.name || el.id}).`);
    if (type === 'checkbox') return setChecked(el, Boolean(value));
    if (type === 'radio') return setChecked(el, true);
    if (el.disabled || el.readOnly)
      throw new FillError(`Field ${el.name || el.id} is not editable.`);
    return setNativeValue(el, toStr(value));
  }
  if (el instanceof w.HTMLTextAreaElement) return setNativeValue(el, toStr(value));
  if (el instanceof w.HTMLSelectElement) {
    if (el.multiple) {
      const wanted = new Set((Array.isArray(value) ? value : [value]).map(toStr));
      for (const o of Array.from(el.options)) o.selected = wanted.has(o.value);
      fire(el, 'input');
      fire(el, 'change');
      return;
    }
    return setNativeValue(el, toStr(value));
  }
  if ((el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true') {
    el.textContent = toStr(value);
    el.dispatchEvent(
      new (w.InputEvent ?? w.Event)('input', {
        bubbles: true,
        inputType: 'insertText',
        data: toStr(value),
      } as InputEventInit),
    );
    return;
  }
  throw new FillError(`Cannot fill element <${el.tagName.toLowerCase()}>.`);
}
