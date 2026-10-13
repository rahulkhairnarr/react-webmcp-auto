import { expect, type Page } from '@playwright/test';

/** Loose shape of the JSON our tools return; snapshot tools return plain text instead. */
export interface ToolData {
  status?: string;
  errors?: { field: string; message: string }[];
  messages?: string[];
  userMustFill?: string[];
  from?: string;
  to?: string;
  current?: string;
  routes?: string[];
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  annotations?: Record<string, boolean>;
}

/** Wait until the runtime has registered at least `min` tools. */
export async function waitForTools(page: Page, min = 1): Promise<void> {
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext?.getTools())?.length ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(min);
}

export function listTools(page: Page): Promise<ToolInfo[]> {
  return page.evaluate(async () => {
    const tools = (await document.modelContext?.getTools()) ?? [];
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as never,
      annotations: t.annotations as never,
    }));
  });
}

/** Calls a tool through the real WebMCP surface (document.modelContext.executeTool). */
export async function callTool(
  page: Page,
  name: string,
  input: object = {},
): Promise<{ raw: string; data: ToolData }> {
  const raw = await page.evaluate(
    async ([n, i]) => {
      const mc = document.modelContext!;
      const tool = (await mc.getTools()).find((t) => t.name === n);
      if (!tool) throw new Error(`tool ${n} not found`);
      return (await mc.executeTool(tool, i as object)) as unknown as string;
    },
    [name, input] as const,
  );
  const parsed = JSON.parse(raw);
  const text = parsed?.content?.[0]?.text;
  let data = text as unknown as ToolData;
  try {
    data = JSON.parse(text);
  } catch {
    /* snapshot tools return plain text */
  }
  return { raw, data };
}
