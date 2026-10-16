import type { ToolCall } from './types';

export interface ConfirmDialogOptions {
  /**
   * Ignore synthetic (script-dispatched) events. Default true: an agent or page script calling
   * `button.click()` must not be able to approve its own consequential action.
   */
  requireTrusted?: boolean;
  /** Auto-decline after this long. Default 60s. */
  timeoutMs?: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Built-in accessible confirmation: `role="alertdialog"`, labelled and described, focus moved to
 * the safe button (Cancel), Tab trapped, Escape declines, focus restored afterwards.
 * Everything is inserted with textContent, never innerHTML (tool descriptions come from the page).
 * Concurrent requests queue; only one dialog is ever shown.
 */
export function createConfirmDialog(
  doc: Document,
  opts: ConfirmDialogOptions = {},
): (call: ToolCall) => Promise<boolean> {
  const requireTrusted = opts.requireTrusted ?? true;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let queue: Promise<unknown> = Promise.resolve();
  let seq = 0;

  const show = (call: ToolCall): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const id = `webmcp-confirm-${++seq}`;
      const previouslyFocused = doc.activeElement as HTMLElement | null;
      const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, txt?: string) => {
        const n = doc.createElement(tag);
        n.style.cssText = css;
        if (txt !== undefined) n.textContent = txt;
        return n;
      };

      const overlay = el(
        'div',
        'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font:14px/1.4 system-ui,sans-serif;',
      );
      overlay.setAttribute('data-webmcp-ui', 'confirm');
      const box = el(
        'div',
        'background:#fff;color:#111;max-width:480px;width:calc(100% - 32px);border-radius:8px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.4);',
      );
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-labelledby', `${id}-t`);
      box.setAttribute('aria-describedby', `${id}-d`);
      box.tabIndex = -1;

      const title = el(
        'h2',
        'margin:0 0 8px;font-size:18px;',
        'An AI agent wants to perform a consequential action',
      );
      title.id = `${id}-t`;
      const desc = el('div', '', undefined);
      desc.id = `${id}-d`;
      desc.append(
        el('p', 'margin:0 0 8px;', `Action: ${call.name}`),
        el(
          'p',
          'margin:0 0 8px;color:#444;',
          `Description (from the page): ${clip(call.description, 300)}`,
        ),
      );
      const inputs = Object.keys(call.input).length ? JSON.stringify(call.input) : '(no inputs)';
      desc.append(
        el(
          'pre',
          'margin:0 0 16px;white-space:pre-wrap;word-break:break-word;background:#f4f4f4;padding:8px;border-radius:4px;',
          clip(inputs, 500),
        ),
      );

      const row = el('div', 'display:flex;gap:8px;justify-content:flex-end;');
      const cancel = el('button', 'padding:8px 16px;font:inherit;cursor:pointer;', 'Cancel');
      const ok = el(
        'button',
        'padding:8px 16px;font:inherit;cursor:pointer;background:#b00020;color:#fff;border:0;border-radius:4px;',
        'Allow',
      );
      cancel.type = ok.type = 'button';
      row.append(cancel, ok);
      box.append(title, desc, row);
      overlay.append(box);

      let done = false;
      const timer = setTimeout(() => finish(false), timeoutMs);
      const trusted = (e: Event) => !requireTrusted || e.isTrusted;
      function finish(result: boolean) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        doc.removeEventListener('keydown', onKey, true);
        overlay.remove();
        try {
          previouslyFocused?.focus?.();
        } catch {
          /* element may be gone */
        }
        resolve(result);
      }
      function onKey(e: KeyboardEvent) {
        if (!trusted(e)) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          (doc.activeElement === cancel ? ok : cancel).focus();
        }
      }
      cancel.addEventListener('click', (e) => trusted(e) && finish(false));
      ok.addEventListener('click', (e) => trusted(e) && finish(true));
      // Clicking the backdrop is a decline, never an approval.
      overlay.addEventListener('click', (e) => e.target === overlay && trusted(e) && finish(false));
      doc.addEventListener('keydown', onKey, true);

      (doc.body ?? doc.documentElement).append(overlay);
      cancel.focus(); // safe default
    });

  return (call) => {
    const next = queue.then(() => show(call));
    queue = next.catch(() => undefined);
    return next;
  };
}
