import type { ResolvedConfig, Risk, ToolCall, ToolResult } from './types';

export interface CallLogEntry {
  time: number;
  name: string;
  risk: Risk;
  status: 'ok' | 'error' | 'denied' | 'rate_limited';
  durationMs: number;
  input: Record<string, unknown>;
}

/** Fixed-size in-memory ring buffer of tool calls, exposed to devtools. */
export class CallLog {
  private readonly buf: CallLogEntry[] = [];
  constructor(private readonly max = 200) {}
  push(e: CallLogEntry): void {
    this.buf.push(e);
    if (this.buf.length > this.max) this.buf.shift();
  }
  entries(): CallLogEntry[] {
    return [...this.buf];
  }
  clear(): void {
    this.buf.length = 0;
  }
}

/** Sliding one-minute window limiter. */
export class RateLimiter {
  private readonly stamps: number[] = [];
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}
  take(): boolean {
    const t = this.now();
    while (this.stamps.length && t - this.stamps[0]! >= 60_000) this.stamps.shift();
    if (this.stamps.length >= this.perMinute) return false;
    this.stamps.push(t);
    return true;
  }
}

function err(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: message }) }],
    isError: true,
  };
}

export interface Guard {
  run(call: ToolCall, exec: () => Promise<ToolResult>): Promise<ToolResult>;
}

/**
 * rate limit -> confirm (destructive only) -> execute -> log.
 * Fails CLOSED: a destructive tool with no way to ask the user is refused.
 */
export function createGuard(
  config: Pick<ResolvedConfig, 'rateLimit' | 'confirm'>,
  log: CallLog,
  defaultConfirm?: (call: ToolCall) => Promise<boolean>,
  limiter = new RateLimiter(config.rateLimit.perMinute),
): Guard {
  return {
    async run(call, exec) {
      const started = Date.now();
      const record = (status: CallLogEntry['status']) =>
        log.push({
          time: started,
          name: call.name,
          risk: call.risk,
          status,
          durationMs: Date.now() - started,
          input: call.input,
        });

      if (!limiter.take()) {
        record('rate_limited');
        return err(`Rate limit exceeded (${config.rateLimit.perMinute}/min). Try again shortly.`);
      }
      if (call.risk === 'destructive') {
        const ask = config.confirm ?? defaultConfirm;
        let ok = false;
        try {
          ok = ask ? await ask(call) : false;
        } catch {
          ok = false;
        }
        if (!ok) {
          record('denied');
          return err(
            'The user declined (or could not be asked to confirm) this consequential action. It was not executed.',
          );
        }
      }
      try {
        const res = await exec();
        record(res.isError ? 'error' : 'ok');
        return res;
      } catch (e) {
        record('error');
        return err((e as Error).message || 'Tool execution failed.');
      }
    },
  };
}
