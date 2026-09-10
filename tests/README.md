# Integration proof

The required suites use real PostgreSQL with the pinned ParadeDB image and actual public GitHub records. No mocked providers, HTTP stubs, synthetic people, or smoke-only success checks are permitted.

`fixtures/github` holds immutable, allowlisted real GitHub captures with source URLs, capture time, content digests, and collection coverage. Production normalizers import these records. Captures prove repeatable ingestion and query behavior; the live tier separately proves current GitHub/Gia compatibility.

The database tier proves uniqueness, foreign keys, BM25 behavior, page/checkpoint atomicity, idempotent replay, and evidence revision handling. The Gia tier compares actual natural-language results with independently reviewed SQL expectations, including required and excluded identities. Browser tests submit real searches and inspect results, assumptions, coverage, and source links.

Use fixed evaluation dates for frozen temporal expectations. Exercise paraphrases, conjunctions on the same repository, exclusion, duplicate joins, absent evidence, and unknown/unsupported claims. Assert fixture population before result comparisons. Deliberate malformed inputs and real transaction/process failures test boundaries; they must not fabricate people or replace an external API with a stub.

## Run the tiers

Use Node 26, install the pinned dependencies, copy `.env.example` to `.env`, and run `pnpm db:setup`. The PostgreSQL suites reset only `gia_github_test`; never point the test URL at the development corpus or runtime registry. Do not run separate test processes against that same test database concurrently.

| Command | Prerequisites and proof |
| --- | --- |
| `pnpm check` | Static boundaries and types, then 30 PostgreSQL integration cases using the production capture importer, database permissions, durable jobs, evidence freshness, actual BM25 results, and cancellation |
| `pnpm exec vitest run --project live tests/live/github.live.test.ts` | Public-read GitHub token and OpenAI key; three live cases covering API rename/ETag behavior, public membership and a known merged PR, and one source-validated enrichment call with cached replay |
| `pnpm exec vitest run --project live tests/live/gia.live.test.ts` | Seeded development database, running Gia, enriched published World, matching serving profile and authority; 14 questions compared with independent expected identities |
| `pnpm exec vitest run --project live tests/live/runtime.live.test.ts` | Node 26, bootstrapped pinned Runtime, OpenRouter key, and reachable separate registry database; one real-process case verifies occupied-port startup failure clears its dead receipt and preserves the other TCP server |
| `pnpm test:e2e` | Running production web application and actual Gia; five browser workflows, including two submitted paid searches, source context, mobile profiles, and real HTTP boundary failures |

`pnpm test:live` runs all three live files: GitHub, Gia query correctness, and Runtime lifecycle. Missing credentials fail clearly. It spends provider quota, so the automatic public CI job runs only the database and worker tier. The full workflow is an explicit trusted dispatch. Browser tests use `PLAYWRIGHT_BASE_URL` when targeting a different deployment.

## Golden questions

The Gia suite covers the ten planned query families below. Public membership plus dated AI work and contributions across repositories each have two phrasings. A separate hybrid case combines BM25 over PR text with follower and merge filters. One further question requires an unsupported outcome for unavailable private intentions.

| Family | Independent condition |
| --- | --- |
| Public Vercel members doing dated AI work | Public membership, authored merged PR, fixed half-open date interval, repository AI evidence |
| PR-specific reranking work | Accepted reranking evidence attached to the authored PR, without inheritance from its repository |
| Repeated review work | At least two distinct PRs by other authors, excluding duplicate review events and self-reviews |
| AI SDK with PostgreSQL | Both concepts belong to the same repository |
| Work across projects | Authored merged PRs in at least two distinct repositories |
| Biography exclusion with work evidence | Explicit null handling and case-insensitive text exclusion, combined with independent PR evidence |
| Active popular projects | Current archive flag and star count constrain the qualifying repository |
| Less visible contributors | A known follower count below 500 and contributions across projects |
| Alternative qualifying paths | Public affiliation and merged work, OR specific reranking PR evidence |
| Explicit location | Missing normalized location does not satisfy a city filter |

The biography and location cases deliberately return no people in this frozen corpus. Every positive case first proves a nonempty expected population; exact sorted identities, uniqueness, and lack of truncation are then checked. The data does not establish employment, private membership, proficiency, or availability for hire.

For a repeated diagnostic cohort, set `GIA_GOLDEN_REPETITIONS=5` and choose cases with Vitest's `-t` filter. `GIA_GOLDEN_EVIDENCE_DIR` writes exclusive, owner-only JSON records with question, snapshot, request ID, expected IDs, and actual outcome. Preserve failed samples, compare a control, and record the exact cohort. A successful retry does not erase a prior failure. Raw provider captures remain private under `.gia`.

Verification reports must name the data source, dependency revisions, cases executed, and failures. Missing prerequisites, zero cases, and an entirely empty expected corpus do not count as passing proof.
