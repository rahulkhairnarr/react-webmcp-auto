/** Small, defensive DOM helpers. Read-only. */

/** CSS.escape is missing in some environments (jsdom); this covers what ids can contain. */
export function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&');
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Collects matches in the light DOM plus every OPEN shadow root. Closed roots are invisible by design. */
export function deepQueryAll<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  const out: T[] = [...root.querySelectorAll<T>(selector)];
  const hosts = root.querySelectorAll('*');
  for (const h of hosts) {
    const sr = (h as Element).shadowRoot;
    if (sr) out.push(...deepQueryAll<T>(sr, selector));
  }
  return out;
}

export function isHidden(el: Element): boolean {
  if (el.closest('[hidden],[aria-hidden="true"],[inert]')) return true;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  try {
    const cs = view.getComputedStyle(el as HTMLElement);
    return cs.display === 'none' || cs.visibility === 'hidden';
  } catch {
    return false;
  }
}

function byIds(el: Element, ids: string): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  return ids
    .split(/\s+/)
    .map((id) => text(root.getElementById?.(id) ?? el.ownerDocument.getElementById(id)))
    .filter(Boolean)
    .join(' ');
}

function ownText(label: Element, control: Element): string {
  const clone = label.cloneNode(true) as Element;
  clone.querySelectorAll('input,select,textarea,button').forEach((n) => n.remove());
  void control;
  return text(clone);
}

/** Accessible name approximation: aria-labelledby > aria-label > <label> > title > placeholder (last resort). */
export function accessibleName(el: Element): string {
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const t = byIds(el, lb);
    if (t) return t;
  }
  const al = el.getAttribute('aria-label')?.trim();
  if (al) return al;
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    const t = [...labels]
      .map((l) => ownText(l, el))
      .filter(Boolean)
      .join(' ');
    if (t) return t;
  }
  const id = el.getAttribute('id');
  if (id) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const l = root.querySelector?.(`label[for="${cssEscape(id)}"]`);
    const t = l ? ownText(l, el) : '';
    if (t) return t;
  }
  const wrap = el.closest('label');
  if (wrap) {
    const t = ownText(wrap, el);
    if (t) return t;
  }
  const title = el.getAttribute('title')?.trim();
  if (title) return title;
  const tag = el.tagName;
  if (tag === 'BUTTON' || el.getAttribute('role') === 'button' || tag === 'A') {
    const t = text(el);
    if (t) return t;
  }
  return el.getAttribute('placeholder')?.trim() ?? '';
}

export function nearestHeading(el: Element): string {
  let cur: Element | null = el;
  while (cur) {
    let sib: Element | null = cur.previousElementSibling;
    while (sib) {
      if (/^H[1-6]$/.test(sib.tagName)) return text(sib);
      const inner = sib.querySelector('h1,h2,h3,h4,h5,h6');
      if (inner) return text(inner);
      sib = sib.previousElementSibling;
    }
    cur = cur.parentElement;
    if (cur && /^H[1-6]$/.test(cur.tagName)) return text(cur);
  }
  const own = el.querySelector('h1,h2,h3,h4,h5,h6,legend');
  return own ? text(own) : '';
}

export function currentRoute(doc: Document): string {
  try {
    return doc.defaultView?.location.pathname || '/';
  } catch {
    return '/';
  }
}
