import { safeInternalPath, type RouterAdapter, createHistoryRouter } from '../router';
import type { Discoverer, ScanContext, ToolCandidate, ToolResult } from '../types';

const json = (payload: unknown, isError = false): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  ...(isError ? { isError } : {}),
});

export function createNavigationDiscoverer(
  getRouter?: () => RouterAdapter | undefined,
): Discoverer {
  return {
    id: 'navigation',
    discover(ctx: ScanContext): ToolCandidate[] {
      const router = getRouter?.() ?? createHistoryRouter(ctx.document);
      const routes = router.getRoutes();
      return [
        {
          key: 'nav:list_routes',
          name: 'list_routes',
          description:
            'List the pages (routes) of this web app that can be navigated to, and the current route.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          risk: 'read',
          source: 'navigation',
          untrusted: true,
          execute: async () =>
            json({ current: router.getCurrentRoute(), routes: router.getRoutes() }),
        },
        {
          key: 'nav:navigate',
          name: 'navigate',
          description:
            'Navigate to a page of this app without reloading. Use list_routes to see valid paths. Only same-origin paths are allowed.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: `Same-origin path, e.g. "/settings". Known routes: ${routes.slice(0, 30).join(', ') || 'unknown'}`,
              },
            },
            required: ['path'],
            additionalProperties: false,
          },
          risk: 'write',
          source: 'navigation',
          execute: async (input) => {
            const path =
              typeof input.path === 'string' ? safeInternalPath(input.path, ctx.document) : null;
            if (!path)
              return json({ status: 'error', error: 'Only same-origin paths are allowed.' }, true);
            const from = router.getCurrentRoute();
            try {
              await router.navigate(path);
            } catch (e) {
              return json({ status: 'error', error: (e as Error).message }, true);
            }
            const settled = await ctx.settle({ quietMs: 150, timeoutMs: 3000 });
            return json({
              status: 'navigated',
              from,
              to: router.getCurrentRoute(),
              title: ctx.document.title,
              messages: settled.alerts,
            });
          },
        },
      ];
    },
  };
}
