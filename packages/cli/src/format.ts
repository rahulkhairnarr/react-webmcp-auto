import type { AuditResult } from './audit';

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s.replace(/\s+/g, ' ');

function fields(schema: {
  properties?: Record<string, { type?: unknown; enum?: unknown[] }>;
  required?: string[];
}): string {
  const req = new Set(schema.required ?? []);
  const entries = Object.entries(schema.properties ?? {});
  if (!entries.length) return '-';
  return entries
    .map(([k, v]) => `${k}${req.has(k) ? '*' : ''}:${v.enum ? 'enum' : String(v.type ?? 'any')}`)
    .join(', ');
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) =>
    r
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();
  return [line(rows[0]!), line(widths.map((w) => '-'.repeat(w))), ...rows.slice(1).map(line)].join(
    '\n',
  );
}

export function formatTable(r: AuditResult): string {
  const out: string[] = [`Audit of ${r.url}`, ''];
  out.push(`Tools (${r.tools.length})`);
  out.push(
    r.tools.length
      ? table([
          ['NAME', 'RISK', 'SOURCE', 'FIELDS (*=required)', 'DESCRIPTION'],
          ...r.tools.map((t) => [
            t.name,
            t.risk,
            t.source,
            clip(fields(t.inputSchema as never), 60),
            clip(t.description, 70),
          ]),
        ])
      : '(none)',
  );
  out.push('', `Warnings (${r.warnings.length})`);
  out.push(
    r.warnings.length
      ? r.warnings
          .map((w) => `  [${w.code}] ${w.message}${w.hint ? `  (${w.hint})` : ''}`)
          .join('\n')
      : '  none',
  );
  return out.join('\n');
}

export function formatJson(r: AuditResult): string {
  return JSON.stringify(r, null, 2);
}
