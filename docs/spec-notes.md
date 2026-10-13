# WebMCP spec notes

Verified: 2026-10-13. Everything spec-dependent in this repo lives in
`packages/core/src/adapter.ts`. If this file and the code disagree, fix the adapter.

## Sources and how well each was verified

| Source                                                                                                                                                                                                | Status                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [webmachinelearning/webmcp](https://github.com/webmachinelearning/webmcp) README, [`index.bs`](https://raw.githubusercontent.com/webmachinelearning/webmcp/main/index.bs), `implementation-status.md` | Read directly.                                                                                                                                        |
| [Declarative API explainer](https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md)                                                                                      | Read directly.                                                                                                                                        |
| [`@mcp-b/webmcp-polyfill` 6.0.1](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill) and [`webmcp-types` 0.1.10](https://www.npmjs.com/package/webmcp-types)                                        | Tarballs downloaded and source/types read.                                                                                                            |
| [WebMCP-org/npm-packages](https://github.com/WebMCP-org/npm-packages)                                                                                                                                 | README read.                                                                                                                                          |
| [Chrome imperative API docs](https://developer.chrome.com/docs/ai/webmcp/imperative-api)                                                                                                              | **NOT read directly.** `developer.chrome.com` does not resolve from the build sandbox. Only a search snippet was seen. Re-verify when network allows. |

Spec status: W3C WebML Community Group **CG-DRAFT**. Not a standard. Expect churn.

## Findings

- **Location: `document.modelContext`.** The spec IDL defines only `partial interface Document { [SecureContext, SameObject] readonly attribute ModelContext modelContext; }`. There is no `Navigator` partial. Secondary (third-party, unverified) sources say `navigator.modelContext` was the earlier location and may still exist in some Chrome builds as a deprecated alias. The polyfill explicitly does not provide the alias. **Decision:** adapter probes `document.modelContext` first, then `navigator.modelContext`.
- **`ModelContext`** is `[Exposed=Window, SecureContext]`, extends `EventTarget`, so HTTPS or localhost only.
- **`registerTool(tool, options?)`** returns `Promise<undefined>`. (Third-party note: older builds returned `void`; always `await`/`Promise.resolve` it.)
  - `options.signal?: AbortSignal` unregisters the tool on abort.
  - `options.exposedTo?: string[]` is a list of origins allowed to call the tool.
- **`ModelContextTool`**: `name` (required; 1-128 chars, ASCII alnum, `_`, `-`, `.`), `title?`, `description` (required), `inputSchema?` (JSON Schema object), `execute` (required), `annotations?`.
- **`execute(input, { signal })`** gets an `AbortSignal` in a second argument. Return type is `Promise<any>`. `executeTool` returns `Promise<string>`; the polyfill `JSON.stringify`s whatever execute returns. The spec does not mandate the MCP `{content:[{type:'text',text}]}` shape, but the polyfill README and MCP-B packages use it. **Decision (conservative):** return `{ content: [{ type: 'text', text }], isError? }` where `text` is JSON. It is valid under either reading.
- **`annotations`**: `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging` (all boolean, default false). **There is no `destructiveHint`** (that is MCP, not WebMCP). **Decision:** destructive → `consequentialHint: true`; read tools → `readOnlyHint: true`; snapshot/page-text tools → `untrustedContentHint: true`.
- **`getTools({ fromOrigins })`** → `Promise<RegisteredTool[]>`; `RegisteredTool` = `{ name, title, description, inputSchema?, window, origin, annotations? }`. `executeTool(tool, input?, { signal })`.
- **Events** on the `ModelContext`: `toolchange` (`ontoolchange`), `toolactivated`, `toolcancel` (declarative explainer spells it `toolcanceled`; types and IDL say `toolcancel`). We only rely on `toolchange`.
- **Iframes:** `allow="tools"` Permissions Policy; cross-origin exposure via `exposedTo`.
- **Declarative API** (explainer only, "not yet in the spec", loose Chromium trial): `<form toolname="…" tooldescription="…" [toolautosubmit]>`, `toolparamdescription` on controls, `SubmitEvent.agentInvoked`, `SubmitEvent.respondWith(promise)`, `:tool-form-active`. Schema reduction rules are unspecified. The polyfill implements a temporary declarative layer. **Decision:** we read `toolname`/`tooldescription` as naming hints only, and do not rely on the browser's declarative handling; our own FormDiscoverer registers an imperative tool and skips forms the browser already exposes natively (avoids duplicates).
- **Availability:** Chrome origin trial from 149 (Edge 150); local dev flag `chrome://flags/#enable-webmcp-testing`. Firefox/Safari: none → polyfill.
- **Polyfill:** `installWebMCP()` from `@mcp-b/webmcp-polyfill` (idempotent, keeps native, no-op on insecure pages). Optional peer dependency, loaded via dynamic `import()`.
- **Open spec issues that can bite us:** unregister/re-register race with different schema (#92), name/title size limits (#73), `title` default (#224).

## Ambiguities → conservative choices

1. Object location: probe both, prefer `document`.
2. Return shape: MCP-style content array with JSON text.
3. Destructive mapping: `consequentialHint`, plus we gate on our own confirm dialog regardless of the browser.
4. Re-registration of a changed tool: abort old, wait a microtask, register new (avoids #92).
5. Tool names are sanitised to `[A-Za-z0-9_.-]{1,128}`.
