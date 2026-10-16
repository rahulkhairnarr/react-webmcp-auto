import { deepQueryAll, isHidden } from '../dom';
import { classifyRisk, parseRisk } from '../risk';
import { slug } from '../naming';
import type { Discoverer, ScanContext, ToolCandidate, ToolResult } from '../types';

const json = (payload: unknown, isError = false): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  ...(isError ? { isError } : {}),
});

/**
 * Non-form elements the developer explicitly marked: `<button data-webmcp-tool="export_csv"
 * data-webmcp-description="..." data-webmcp-risk="read">`. Becomes a no-input tool that clicks it.
 * (Forms are handled by FormDiscoverer, which honours the same attributes.)
 * Consequential ones are confirmed by the safety guard like any other tool.
 */
export const declarativeDiscoverer: Discoverer = {
  id: 'declarative',
  discover(ctx: ScanContext): ToolCandidate[] {
    const out: ToolCandidate[] = [];
    for (const el of deepQueryAll<HTMLElement>(ctx.document, '[data-webmcp-tool]:not(form)')) {
      if (el.closest('[data-webmcp-ignore],[data-webmcp-ui]') || isHidden(el)) continue;
      const name = el.getAttribute('data-webmcp-tool')!.trim();
      if (!name) continue;
      const label = el.getAttribute('aria-label') || el.textContent?.trim() || name;
      const declared = parseRisk(el.getAttribute('data-webmcp-risk'));
      out.push({
        key: `declarative:${slug(name)}`,
        name,
        title: label.slice(0, 80),
        description:
          el.getAttribute('data-webmcp-description')?.trim() || `Activate "${label.slice(0, 80)}".`,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        risk: declared ?? classifyRisk({ text: `${name} ${label}` }),
        riskDeclared: !!declared,
        source: 'declarative',
        node: el,
        execute: async () => {
          if (!el.isConnected || (el as HTMLButtonElement).disabled) {
            return json({ status: 'error', error: 'The control is no longer available.' }, true);
          }
          el.click();
          const settled = await ctx.settle();
          return json({
            status: 'performed',
            messages: settled.alerts,
            timedOut: settled.timedOut,
          });
        },
      });
    }
    return out;
  },
};
