# Contributing

Read `AGENTS.md`, then the owning package's instructions. Use Node.js 24 or later, pnpm 9.15, and Docker Compose v2. Dependency versions and container images are pinned.

The lead owns root configuration, shared schema/contracts, and the lockfile during parallel work. Helpers work in isolated worktrees and modify only their assigned paths. Installation and source bootstrap run through the lead until the dependency graph is stable.

Database schema changes require a reviewed migration. ParadeDB indexes and source comments use explicit SQL migrations. Do not run an unreviewed schema push against an existing database.

Verification uses real GitHub captures, PostgreSQL, Gia, and the browser. See `tests/README.md`. A missing live credential or database is a failed prerequisite for that tier, never a silent skip. Source-only checks and endpoint liveness are not substitutes for integration tests.

Commit only the application and allowlisted public evidence. Inspect staged files for secrets, local paths, generated debug captures, private source code, and unreviewed source snapshots.
