import type { ToolCandidate } from './types';

/** Tool names must be 1-128 chars of [A-Za-z0-9_.-] (spec-notes.md). */
export function sanitizeName(raw: string): string {
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  return (cleaned || 'tool').slice(0, 120);
}

export function slug(raw: string): string {
  return sanitizeName(raw.toLowerCase());
}

/** Applies user naming, sanitises, then adds deterministic `_2`, `_3` suffixes in input order. */
export function assignNames(
  candidates: ToolCandidate[],
  naming?: (c: ToolCandidate) => string,
): ToolCandidate[] {
  const used = new Map<string, number>();
  return candidates.map((c) => {
    let base = c.name;
    if (naming) {
      try {
        base = naming(c) || base;
      } catch {
        /* user naming bug must not break scanning */
      }
    }
    base = sanitizeName(base);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? { ...c, name: base } : { ...c, name: `${base}_${n}`.slice(0, 128) };
  });
}

/** Minimal glob: `*` matches any run of characters. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function matchesAny(name: string, node: Element | undefined, patterns: string[]): boolean {
  for (const p of patterns) {
    if (globToRegExp(p).test(name)) return true;
    if (node) {
      try {
        if (node.matches(p) || node.closest(p)) return true;
      } catch {
        /* not a valid selector: it was a glob */
      }
    }
  }
  return false;
}
