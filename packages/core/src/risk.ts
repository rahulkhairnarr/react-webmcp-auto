import type { Risk } from './types';

const DESTRUCTIVE =
  /\b(delete|remove|destroy|erase|wipe|purge|terminate|deactivate|revoke|unsubscribe|close (my )?account|cancel (my |your |the )?(subscription|account|plan|membership|order)|pay(ment)?|purchase|buy|checkout|place order|order now|transfer|wire|send|publish|post)\b/i;

export interface RiskInput {
  /** Free text: tool name, button label, heading, action URL. */
  text?: string;
  /** HTTP method when known. */
  method?: string;
  /** `data-webmcp-risk` value, if any. Always wins. */
  declared?: string | null;
}

export function parseRisk(v: string | null | undefined): Risk | undefined {
  return v === 'read' || v === 'write' || v === 'destructive' ? v : undefined;
}

export function classifyRisk(input: RiskInput): Risk {
  const declared = parseRisk(input.declared);
  if (declared) return declared;
  const method = input.method?.toUpperCase();
  if (method === 'DELETE') return 'destructive';
  if (input.text && DESTRUCTIVE.test(input.text.replace(/[_-]+/g, ' '))) return 'destructive';
  if (method === 'GET' || method === 'HEAD') return 'read';
  return 'write';
}
