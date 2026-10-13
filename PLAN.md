# PLAN

Zero-config WebMCP layer for React. See the task brief; spec findings in `docs/spec-notes.md`.

## Milestones
- **M0** Spec verification, plan (this).
- **M1** Monorepo scaffold; core adapter, registry, FormDiscoverer, naming, schema inference, native-setter fill; demo-vite; unit tests.
- **M2** Navigation, snapshot, settling; Playwright e2e for forms/routes.
- **M3** Safety layer (risk, confirm, rate limit, call log, untrusted wrapping); CLI `audit`.
- **M4** React fiber hook, router adapters, `<WebMCPAuto/>`, `useWebMCPTool`.
- **M5** Vite plugin, manifest, zod → JSON Schema.
- **M6** MV3 extension.
- **M7** Docs, benchmarks, packaging, Changesets dry run.

Each milestone ends with lint, typecheck, unit and e2e results reported honestly, then a commit.

## Risks
| Risk | Mitigation |
| --- | --- |
| Spec churn | One adapter file; both `document`/`navigator` probed |
| Chrome docs unverified (DNS) | Flagged in spec-notes; re-verify |
| No native WebMCP in sandbox Chromium | e2e uses the polyfill; native path tested via fake modelContext in unit tests |
| React hook must precede React init | Document; Vite plugin inline script; extension MAIN world at document_start |
| Controlled inputs ignore `.value=` | Native prototype setter + bubbling events; stress app |
| Prompt injection via page text | Delimited untrusted block, hidden-element stripping, docs/security.md |
| Scope is very large | Strict milestone order; unfinished items reported plainly |
| Heavy deps (zod-to-json-schema, babel parser, playwright, MUI, RHF) | Approved in the brief by name; anything else asks first |
