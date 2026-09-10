# Gia GitHub

Search public GitHub people and their work with natural language. A Next.js interface uses Gia to prepare signed PostgreSQL queries, verifies them locally, and executes them through a read-only database role. A separate worker collects bounded public GitHub observations.

The initial real corpus contains 15 repositories, 137 people, 343 pull requests, and 17 reviews. Collection is deliberately partial. Public membership establishes visible affiliation, not employment. Results show observation dates and links to public activity; those links are background context, not a claim that every displayed item caused the match.

## Run locally

Requirements: Node 26, pnpm 9.15, Docker Compose, GitHub CLI, and authorized Git read access to the Gia repositories listed in `.gia-sources.json`. Gia Core, SDK, and Runtime are currently private. Their implementation is excluded from this repository. This application's MIT license does not grant access to those dependencies.

```sh
git clone https://github.com/usegia/gia-github.git
cd gia-github
nvm use
node scripts/gia/bootstrap.mjs
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:setup
pnpm ingest -- --capture fixtures/github
```

The captured-data import needs no GitHub token or model key. For live collection, set `GIA_GITHUB_TOKEN`. For Gia initialization and serving, make `OPENROUTER_API_KEY` available in the environment. Optional worker enrichment uses `OPENAI_API_KEY`. Keep credentials in your environment or ignored `.env`.

```sh
pnpm gia:start
pnpm gia:init
pnpm gia:profile
pnpm gia:authority
pnpm build
pnpm --filter @gia-github/web start
```

Open [localhost:3000](http://localhost:3000). PostgreSQL listens on loopback port 55448 and the local Gia runtime on 8798. The database, writer, and reader passwords in `.env.example` are local development defaults. Production needs its own provisioned credentials.

`GIA_RUNTIME_HARNESS_PROFILE` selects a closed planner policy supported by the pinned Runtime. The reference setting is `terra-openai-none`. Startup verifies the source revision and policy before spawning; stop the owned Runtime before changing either. See [Gia operation](docs/gia.md) for measured model comparisons.

`gia:init` creates a Gia project and publishes its initial enriched World. The checked-in `gia/` documents a reference deployment; initialization binds your installation to its own project. After collecting new values, use `pnpm gia:refresh`, then `pnpm gia:profile` and `pnpm gia:authority`. Restart the web process when its authority changes.

## Development and verification

```sh
pnpm dev                    # web and persistent ingestion worker
pnpm check                  # lint, boundaries, types, real PostgreSQL integration
pnpm test:live              # explicit live GitHub, enrichment, and Gia calls
pnpm exec playwright install chromium
pnpm test:e2e               # running production web app and actual backend
pnpm check:release          # tracked-file and available-credential hygiene
```

Tests use actual GitHub captures and the production importer. They exercise real PostgreSQL constraints, retries, evidence revisions, request admission, cancellation, and durable jobs. Gia cases compare people with independent SQL expectations and vary language, joins, counts, time windows, missing evidence, and unsupported requests. Browser tests never intercept the backend. See [the testing guide](tests/README.md) for prerequisites and exact scope.

The automatic public CI job runs the data and worker contracts without private Gia sources. The manually dispatched full workflow also requires private-source and model credentials. Missing prerequisites fail the requested tier rather than silently skipping it.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js, React, Tailwind, local shadcn-style components, HTTP boundary |
| `apps/worker` | Octokit collection, normalization, source evidence, pg-boss jobs |
| `packages/db` | Drizzle schema, SQL migrations, PostgreSQL roles |
| `packages/search` | Gia verification/execution, admission, public result contracts |
| `gia` | Authored World and generated, reviewable deployment authority |
| `fixtures/github` | Immutable real public observations with SHA-256 receipts |
| `tests` | Database, live-provider, and browser integration proof |

Start with [AGENTS.md](AGENTS.md) for coding-agent ownership and update obligations, [the architecture](docs/architecture.md) for design decisions, or [the documentation map](docs/README.md) for a focused route. [Deployment](docs/deployment.md) describes the public-hosting prerequisites.

Application code is MIT licensed. Captured third-party content retains its original ownership and licenses. Private Gia dependencies remain separately licensed.
