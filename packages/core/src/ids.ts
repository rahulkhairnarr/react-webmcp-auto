/** Stable per-element ids for snapshots and actions. WeakMap-backed so detached nodes are collectable. */
const ids = new WeakMap<Element, string>();
const byId = new Map<string, WeakRef<Element>>();
let counter = 0;

export function elementId(el: Element): string {
  let id = ids.get(el);
  if (!id) {
    id = `e${++counter}`;
    ids.set(el, id);
    byId.set(id, new WeakRef(el));
  }
  return id;
}

export function elementById(id: string): Element | undefined {
  const el = byId.get(id)?.deref();
  return el?.isConnected ? el : undefined;
}
