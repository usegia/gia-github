# Database

The application uses PostgreSQL 17 and the pinned ParadeDB 0.24.3 image in `compose.yaml`. The image digest is part of the integration contract. Normal foreign keys and B-tree indexes serve structured joins; three BM25 indexes serve account, repository, and PR text. Source text remains separate from accepted semantic evidence.

| Schema and table | Purpose |
| --- | --- |
| `github.accounts` | Stable GitHub identity, account kind, nullable public profile attributes |
| `github.repositories` | Repository identity, mutable names, README revision, project metadata |
| `github.public_memberships` | Observed public person-to-organization affiliation and observation interval |
| `github.pull_requests` | Authorship, merge dates, text, source commit, and repository |
| `github.pull_request_reviews` | Review events, nullable reviewer, PR, state, and time |
| `github.repository_languages` | Observed repository language byte counts |
| `github.concepts` | Small reviewed domain, capability, and technology vocabulary |
| `github.concept_evidence` | Source excerpt, exact revision, extraction version, review state, and scope |
| `ingest.sync_state` | Progress, bounded time window, and incomplete/complete/failed status |
| `ingest.captures` | Public capture provenance and integrity receipt |
| `operations.search_requests` | Private request admission and operational accounting |
| `jobs.*` | pg-boss durable job state, owned by the worker |

Every GitHub identity uses PostgreSQL bigint. JavaScript application boundaries preserve IDs as decimal strings or bigint, never 32-bit integers. Unknown follower counts and missing profiles stay NULL. A closed PR is merged only when `merged_at` is non-NULL. A reviewed-PR count uses distinct PRs and excludes self-reviews when the question requires other people's work.

Concept evidence references one repository, and optional PR evidence has a composite foreign key that guarantees the same repository. Positive confirmed-capability filters require accepted, explicit evidence. Rejected, pending, and superseded records cannot satisfy that filter. The source excerpt must be found in its source revision.

## Permissions

`DATABASE_ADMIN_URL` belongs to migrations and provisioning. `DATABASE_URL` is the application writer with DML in `github`, `ingest`, and `operations`, plus ownership of `jobs`. `GIA_DATABASE_URL` is the Gia executor, with SELECT only in `github` and default read-only transactions. It has no access to ingestion, request accounting, or job state. Default privileges extend those rules to future migrated tables.

Local development credentials in `.env.example` are deliberately public defaults for the loopback-only Docker service. `pnpm db:prepare` refuses a nonlocal database or a different database name. Deployment requires unique credentials and database-owner provisioning, as described in deployment instructions.

## Migrations

`pnpm db:generate` generates a Drizzle migration. SQL-only changes use `drizzle-kit generate --custom --name meaningful_name`. Review generated SQL, add column comments describing domain semantics, then run the actual integration suite. Applied migration files are immutable. Grant roles after migrating, and regenerate/review Gia authority when the schema changes.

Tests reset only the explicitly named `gia_github_test` database. They reapply the migrations and import real capture records through the production worker importer. The development corpus and Gia registry are separate databases.
