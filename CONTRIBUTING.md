# Contributing

Read `AGENTS.md`, then the owning package guide. `docs/README.md` maps the focused runbooks. Begin with a clean understanding of `git status`; preserve unrelated changes.

Use Node 26 and the pinned pnpm version. Follow README setup to start the real PostgreSQL instance and install the private Gia dependency closure when available. `pnpm dev` starts the web app and ingestion worker; start Gia separately with `pnpm gia:start` before exercising search.

Before a change is ready for review, run `pnpm check` and `pnpm build`. Run `pnpm test:live` when changing GitHub/Gia behavior, then `pnpm test:e2e` against the actual running application for public flow changes. These commands have external prerequisites and bounded provider costs; an unavailable tier must be reported as unverified. Do not replace it with a mock.

Schema changes need generated or custom SQL migrations, domain comments, actual PostgreSQL proof, and regenerated Gia artifacts. `pnpm db:generate` produces the Drizzle migration. Applied files stay immutable. New tables must receive permissions through `pnpm db:grant`; the executor must remain read-only.

Use `pnpm format` for source formatting. Captured GitHub bytes and generated Gia artifacts are excluded from formatting. Do not alter their hashes or generated prose to satisfy a test. `pnpm check:boundaries` checks package ownership and browser imports; `pnpm check:release` checks tracked files for private state and credentials available to the process.

New commands and environment variables must update README, `.env.example`, the relevant runbook, and the CI command that verifies them. Add business-level integration cases with actual public observations and independent expected results. Do not assert prompt text, rendered source strings, or import layout in the test suite.

Parallel writing work needs explicit file ownership or private worktrees. The lead owns the lockfile, migrations, shared response contracts, and generated Gia authority. Helpers do not operate Git branches or worktrees unless assigned. The lead integrates and removes finished worktrees after review.
