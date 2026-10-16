import type { JsonSchema, Risk, ToolCandidate } from './types';

export interface ManifestEntry {
  key: string;
  name?: string;
  description?: string;
  inputSchema?: JsonSchema;
  risk?: Risk;
  ignore?: boolean;
}

export interface Manifest {
  version?: number;
  tools: ManifestEntry[];
}

/** manifest > declarative attributes > inferred. Declarative attrs are already applied by discoverers. */
export function applyManifest(
  candidates: ToolCandidate[],
  manifest: Manifest | undefined,
): ToolCandidate[] {
  if (!manifest?.tools?.length) return candidates;
  const byKey = new Map(manifest.tools.map((t) => [t.key, t]));
  const out: ToolCandidate[] = [];
  for (const c of candidates) {
    const m = byKey.get(c.key);
    if (!m) {
      out.push(c);
      continue;
    }
    if (m.ignore) continue;
    out.push({
      ...c,
      name: m.name ?? c.name,
      description: m.description ?? c.description,
      inputSchema: m.inputSchema ?? c.inputSchema,
      risk: m.risk ?? c.risk,
      riskDeclared: m.risk ? true : c.riskDeclared,
    });
  }
  return out;
}
