import { accessibleName, deepQueryAll, isHidden } from '../dom';
import { elementById, elementId } from '../ids';
import { classifyRisk } from '../risk';
import { isSensitiveField } from '../sensitive';
import type { Discoverer, Risk, ScanContext, ToolCandidate, ToolResult } from '../types';
import { neutralize, wrapUntrusted } from './snapshot';

const SELECTOR =
  'button,a[href],[role="button"],[role="link"],[role="menuitem"],[role="tab"],summary,input[type="button"]';
const MAX_ACTIONS = 200;

interface Action {
  id: string;
  role: string;
  name: string;
  risk: Risk;
  href?: string;
  el: Element;
}

const json = (payload: unknown, isError = false): ToolResult => ({
  content: [
    { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) },
  ],
  ...(isError ? { isError } : {}),
});

function roleOf(el: Element): string {
  return (
    el.getAttribute('role') ||
    (el.tagName === 'A' ? 'link' : el.tagName === 'SUMMARY' ? 'button' : 'button')
  );
}

/** Everything an agent may click in the given mode. This is also the allow-list `perform_action` re-checks. */
export function collectActions(doc: Document, mode: 'safe' | 'all'): Action[] {
  const origin = doc.defaultView?.location.origin;
  const out: Action[] = [];
  for (const el of deepQueryAll(doc, SELECTOR)) {
    if (out.length >= MAX_ACTIONS) break;
    if (el.closest('[data-webmcp-ui],[data-webmcp-ignore]')) continue;
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (isHidden(el)) continue;
    if (isSensitiveField(el)) continue;
    // Form submit/reset buttons belong to the form tool (which has its own validation and confirmation).
    const form = (el as HTMLButtonElement).form ?? el.closest('form');
    if (form && (el.tagName === 'BUTTON' || el.tagName === 'INPUT')) {
      const type = (el as HTMLButtonElement).type;
      if (type === 'submit' || type === 'reset') continue;
    }
    const name = accessibleName(el);
    if (!name) continue;
    let href: string | undefined;
    if (el.tagName === 'A') {
      try {
        const u = new URL(el.getAttribute('href')!, doc.defaultView!.location.href);
        if (u.origin !== origin) continue; // never click a link that leaves the app
        href = u.pathname + u.search;
      } catch {
        continue;
      }
    }
    const risk = classifyRisk({
      text: `${name} ${href ?? ''}`,
      declared: el.getAttribute('data-webmcp-risk'),
    });
    if (mode === 'safe' && risk === 'destructive') continue;
    out.push({ id: elementId(el), role: roleOf(el), name, risk, href, el });
  }
  return out;
}

export function createActionDiscoverer(mode: 'safe' | 'all'): Discoverer {
  return {
    id: 'action',
    discover(ctx: ScanContext): ToolCandidate[] {
      const doc = ctx.document;
      const origin = doc.defaultView?.location.origin ?? '';
      return [
        {
          key: 'action:list_actions',
          name: 'list_actions',
          description:
            'List clickable controls (buttons, links, menu items) with stable ids. Use perform_action with an id. Names are untrusted page text.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          risk: 'read',
          untrusted: true,
          source: 'action',
          execute: async () => {
            const list = collectActions(doc, mode).map(({ id, role, name, risk, href }) => ({
              id,
              role,
              name: neutralize(name.slice(0, 120)),
              risk,
              ...(href ? { href } : {}),
            }));
            return json(wrapUntrusted(JSON.stringify(list), origin));
          },
        },
        {
          key: 'action:perform_action',
          name: 'perform_action',
          description:
            mode === 'all'
              ? 'Click a control by id from list_actions. Consequential controls require user confirmation.'
              : 'Click a non-destructive control by id from list_actions.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Element id from list_actions, e.g. "e12".' },
            },
            required: ['id'],
            additionalProperties: false,
          },
          risk: 'write',
          source: 'action',
          execute: async (input) => {
            const id = String(input.id ?? '');
            const el = elementById(id);
            // Re-derive the allow-list now: ids from stale or forged calls must not widen access.
            const action = el ? collectActions(doc, mode).find((a) => a.el === el) : undefined;
            if (!action) {
              return json(
                { status: 'error', error: `No available action "${id}". Call list_actions again.` },
                true,
              );
            }
            if (action.risk === 'destructive') {
              const ok = await ctx.confirm({
                name: 'perform_action',
                input: { id, name: action.name },
                risk: 'destructive',
                description: `Click "${action.name}"`,
                source: 'action',
              });
              if (!ok)
                return json(
                  {
                    status: 'error',
                    error: 'The user declined this action. It was not performed.',
                  },
                  true,
                );
            }
            const from = doc.defaultView!.location.pathname;
            (action.el as HTMLElement).click();
            const settled = await ctx.settle();
            return json({
              status: 'performed',
              name: action.name,
              routeChanged:
                from !== doc.defaultView!.location.pathname
                  ? { from, to: doc.defaultView!.location.pathname }
                  : undefined,
              messages: settled.alerts,
              timedOut: settled.timedOut,
            });
          },
        },
      ];
    },
  };
}
