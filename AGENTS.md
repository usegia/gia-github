# Gia GitHub agent guide

Build public GitHub people search. Read this file, `README.md`, and the task's owning package before editing. This repository owns the application, collection pipeline, database schema, and product integration tests. Gia owns planning, admission, and verified execution.

## Find the owner

| Change | Owner | Read first |
| --- | --- | --- |
| Pages, interactions, HTTP endpoints | `apps/web` | `apps/web/AGENTS.md` |
| GitHub collection, jobs, enrichment | `apps/worker` | `apps/worker/AGENTS.md` |
| Tables, constraints, SQL migrations | `packages/db` | `packages/db/AGENTS.md` |
| Gia adapter, person results, query limits | `packages/search` | `packages/search/AGENTS.md` |
| Commands, CI, deployment, source receipts | `scripts`, root configuration | `CONTRIBUTING.md` |
| Actual GitHub captures and integration expectations | `fixtures`, `tests` | `tests/README.md` |

Start with `docs/README.md` for this application's documentation. When the sibling `../gia-docs` workspace exists, discover shared Gia documentation through `../gia-docs/manifest/reading-paths.json`. In a standalone checkout, use the repository, revision, and pages in `.gia-docs.json` to read the verified snapshot. Exact source dependencies are in `.gia-sources.json`. Current workspace documentation and a pinned snapshot are different sources. Prefer Core parsers, current owner implementation and tests, public declarations, then prose. Do not edit other Gia repositories to make an application check pass. Record and minimize an owner defect, then fix it in an isolated owner lane.

## Working rules

- Begin with `git status --short`. Preserve unrelated work. Name the owning files, the behavior being changed, and its real integration proof before editing.
- Shared contracts and schema are lead-owned during parallel work. Writing helpers use orchestrator-created worktrees with explicit file ownership. Read-only helpers need none. Helpers never manage branches or worktrees unless assigned. The lead reviews and merges each lane, then removes its worktree.
- Use package exports. Packages never import apps. Browser code imports only browser-safe contracts, never database clients, Gia authority files, or credentials. Load environment variables at executable entrypoints and pass configuration explicitly.
- Use strict TypeScript, schema-derived types, discriminated outcomes, and ordinary functions. Parse untrusted inputs once at their boundary. Avoid `any`, unchecked casts, generic service/repository layers, forwarding barrels, and one-use abstractions.
- Never author or rewrite SQL from natural language outside Gia. Preserve signed query ordering, limits, assumptions, and failures. Application hydration must not silently change who matched.
- GitHub account IDs are stable; names are mutable. Public membership is not employment. Repository languages are not individual proficiency. Repository capabilities are not evidence that every contributor implemented them.
- A claim must retain its source URL, revision, and observation time. Distinguish query evidence from profile context. Missing, stale, and incomplete collection are not negative facts. Retried pages commit facts and checkpoints atomically. External calls stay outside database transactions.
- Credentials belong in environment variables or ignored owner-only state. Never print them, commit `.env` files, capture private membership, or copy private Gia implementation into this public repository. Public responses and traces must exclude raw provider errors and secrets.

## Verification is behavior

`pnpm check` runs static checks and actual-data PostgreSQL integration tests. `pnpm test:live` exercises live GitHub and Gia with explicit credentials. `pnpm test:e2e` exercises the running application and real backend in a browser. Required prerequisites fail clearly; they never turn into skipped passing tests.

Use real PostgreSQL with the pinned ParadeDB image. Import immutable, allowlisted real GitHub captures through production code. Keep source URLs, capture times, hashes, and coverage in the fixture manifest. Captured-data tests prove database/pipeline behavior; live tests separately prove current API compatibility. Do not introduce mocks, HTTP stubs, synthetic people, smoke-only assertions, or prompt-source/snapshot tests. Meaningful failure tests may replay actual records or exercise rollback and real process/database failures in isolated databases.

Golden queries need independent expected identities, excluded identities, nonempty population assertions, and a fixed evaluation date when temporal wording is involved. Vary paraphrases, conjunctions, time boundaries, duplicate joins, absent evidence, and unsupported claims. A query merely returning rows is not a correctness proof. Broad cross-repository evaluations belong in Gia Playground; minimized product regressions stay here.

Before handoff, inspect the diff, run the affected integration suite, then the repository checks and a real browser workflow. Record exact commands and unresolved limitations. Never call a skipped, partial, or inconclusive run verified.

## Keep instructions current

When adding or renaming a command, update `README.md`, `CONTRIBUTING.md`, and its executable check together. When changing a public response, update its Zod contract and browser/integration proof. When changing schema, commit a migration and rebuild the reviewed Gia artifacts through lifecycle commands. Do not hand-edit `gia/generated`.

Use `rg` in the relevant package. `.deps`, `.data`, `.gia`, `node_modules`, build outputs, and worktrees are not source discovery roots. For Gia authoring, start with `gia/world.json` and the relevant entity in `gia/generated/effective-world.json`; inspect individual evidence records instead of dumping generated value inventories. Keep current decisions in the implementation, tests, and short runbooks. `audit/implementation.tsv` records this initial delivery; it is evidence, not a second instruction source.
