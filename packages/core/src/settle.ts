import type { SettleOptions, SettleResult } from './types';

export interface NetworkTracker {
  inflight(): number;
  dispose(): void;
}

/** Counts in-flight fetch/XHR. Wraps lightly and restores originals on dispose. */
export function installNetworkTracker(win: Window & typeof globalThis = window): NetworkTracker {
  let n = 0;
  const origFetch = win.fetch;
  const proto = win.XMLHttpRequest?.prototype;
  const origSend = proto?.send;

  const wrappedFetch: typeof fetch | undefined = origFetch
    ? function (this: unknown, ...args: Parameters<typeof fetch>) {
        n++;
        const done = () => void (n = Math.max(0, n - 1));
        let p: Promise<Response>;
        try {
          p = origFetch.apply(win, args);
        } catch (e) {
          done();
          throw e;
        }
        p.then(done, done);
        return p;
      }
    : undefined;
  if (wrappedFetch) win.fetch = wrappedFetch;

  const wrappedSend: XMLHttpRequest['send'] | undefined = origSend
    ? function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>) {
        n++;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          n = Math.max(0, n - 1);
        };
        this.addEventListener('loadend', done, { once: true });
        try {
          return origSend!.apply(this, args);
        } catch (e) {
          done();
          throw e;
        }
      }
    : undefined;
  if (proto && wrappedSend) proto.send = wrappedSend;

  return {
    inflight: () => n,
    dispose() {
      if (wrappedFetch && win.fetch === wrappedFetch) win.fetch = origFetch;
      if (proto && wrappedSend && proto.send === wrappedSend && origSend) proto.send = origSend;
    },
  };
}

function alertTexts(doc: Document): string[] {
  return [...doc.querySelectorAll('[role="alert"],[role="status"],[aria-live="assertive"]')]
    .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Resolves when the DOM has been quiet for `quietMs` with no in-flight requests,
 * or after `timeoutMs`. Reports route change and newly appeared alerts.
 */
export function settle(
  doc: Document,
  tracker: NetworkTracker | undefined,
  opts: SettleOptions = {},
): Promise<SettleResult> {
  const quietMs = opts.quietMs ?? 300;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const win = doc.defaultView!;
  const started = Date.now();
  const fromUrl = win.location.pathname + win.location.search;
  const before = new Set(alertTexts(doc));

  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const finish = (timedOut: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      mo.disconnect();
      const toUrl = win.location.pathname + win.location.search;
      resolve({
        settled: !timedOut,
        timedOut,
        durationMs: Date.now() - started,
        route: toUrl !== fromUrl ? { from: fromUrl, to: toUrl } : undefined,
        alerts: alertTexts(doc).filter((t) => !before.has(t)),
      });
    };
    const arm = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(check, quietMs);
    };
    const check = () => {
      if ((tracker?.inflight() ?? 0) > 0) return arm();
      finish(false);
    };
    const mo = new win.MutationObserver(arm);
    mo.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
    const hardTimer = setTimeout(() => finish(true), timeoutMs);
    arm();
  });
}
