# Gia setup and operation

The application uses the real Gia client to obtain, verify, re-admit, and execute signed PostgreSQL queries. It never writes SQL from the question itself. Profile hydration runs fixed parameterized SQL after execution and preserves the order of returned people. Repository and PR cards are public context; they are not asserted to prove why that person matched.

## Access and reproducible dependencies

Gia Core, SDK, and Runtime are private repositories today. This application's public license does not grant access to them. A person without that access can read the application and ingestion source, but cannot currently build its complete Gia search dependency graph. No public npm distribution or hosted signup flow is implied.

Use Node 26 for local Gia tooling. The application supports Node 24. Authenticate Git read access to the repositories named in `.gia-sources.json`, then run:

```sh
node scripts/gia/bootstrap.mjs
pnpm install --frozen-lockfile
```

Bootstrap clones exact revisions into ignored `.deps/gia-sources`, builds Core and the client using their own compiler settings, and writes the ignored `.deps/gia-client` application package. Existing source checkouts must remain clean at the receipt revisions; bootstrap never resets them. The application keeps strict TypeScript settings without typechecking upstream source under a different compiler policy. The generated client package contains private code and must never be committed or published as this project's source.

Only `@gia/client` and its Core contract dependencies enter web serving. SDK authoring and private Runtime source stay in separate lifecycle processes. A container build must run bootstrap with authorized repository access or receive the same ignored built dependencies privately.

## Initialize against collected data

Create and migrate the application database, import a bounded real GitHub capture, and create a separate empty `gia_github_runtime` registry database. PostgreSQL table and column comments must be present before initialization. `.env.example` documents application roles; the Gia query executor always uses `GIA_DATABASE_URL`, which must be read-only.

With the environment loaded, run:

```sh
node --env-file=.env scripts/gia/runtime.mjs start
node --env-file=.env scripts/gia/project.mjs init
node --env-file=.env scripts/gia/project.mjs profile
node --env-file=.env scripts/gia/project.mjs authority
```

`init` uses `DATABASE_ADMIN_URL` when provided and selects only `config/gia-tables.txt`. It explicitly requests enriched initialization using the existing OpenRouter key. Initialization publishes the first World. Keep initialization output private: `.gia/init.log` can contain the minted API key. Credentials and signing material are mode 0600 under ignored `.gia`. Runtime receives its registry URL, provider key, and signing key; it never receives the customer database URL or GitHub token.

When collected values change, run `node --env-file=.env scripts/gia/project.mjs refresh`. This explicitly reharvests selected values with enrichment, publishes the updated snapshot, and promotes the development alias. Then run `profile` and `authority` again.

Review `gia/` as project source. Author meaning through Gia's supported authoring and regeneration commands; do not edit `gia/generated`. After a changed World is published, run `profile` and `authority` again. The profile uses Core-derived physical identities and a pinned snapshot. Head movement checks the prior revision, and mutation operation IDs are deterministic for each exact command so uncertain retries retain identity.

`authority` exports the SDK's current local authority documents into `gia/client-authority.json`. This deployment artifact contains no credentials. It belongs alongside the reviewed World in the application image. The server reads it once per service instance and verifies tickets against that fixed authority. Restart web instances after publishing a different authority artifact.

The web host may pass `GIA_API_KEY` explicitly. Otherwise it reads `.gia/credentials.json` in `GIA_PROJECT_DIR` and checks its project and Runtime origin against local configuration. Browsing catalog or person pages works before Gia credentials are configured; a search returns a configuration failure until setup completes.

## Search limits and evidence

The default limits allow three active searches across instances, six submissions per client per minute, and 100 admitted searches per UTC day. PostgreSQL serializes admission and stores only a hash of the client key, request identifiers, timestamps, outcome, and duration. These are request allowances, not an exact currency budget. Each Gia request has a 180-second deadline, at most 50 requested people, and 262144 decoded result bytes. Database cancellation has its own connection pool, so a saturated execution pool cannot prevent cancellation.

The application preserves direct, assumed, unsupported, failed, and truncated outcomes. It does not replay uncertain ticket issuance automatically. The client requests account identity only; unexpected identity types, missing local rows, and non-human accounts fail result hydration. Duplicate identities collapse to their first occurrence, preserving rank; the signed tuple truncation flag remains unchanged.

Coverage describes the indexed public corpus. Partial collection remains unknown. Public organization membership is not employment, and repository languages and technologies do not establish personal proficiency. PRs and reviews shown on a card are labeled background activity, with source URLs and revision information.

To stop the project's owned Runtime while retaining registry data:

```sh
node scripts/gia/runtime.mjs stop
```

Runtime management refuses to stop an unowned process. Local loopback serving is the reference setup; this command does not configure production TLS, external authentication, or a public Gia service.

For an operator-owned local investigation, stop the Runtime and start it with `GIA_RUNTIME_LOCAL_DEBUG=1`. This enables the existing Runtime's loopback capture authority; an SDK query must separately request sensitive debug evidence and supply an owner-only debug sink. The web search service continues to request debug off. Captures can contain the full question, World, provider response, and SQL. Keep them under ignored `.gia`, respect their deletion deadline, and restart without this flag after the investigation. Changing the flag on an already running process has no effect.

The pinned Runtime selects the `terra-openai-none` planner policy: `openai/gpt-5.6-terra` through OpenRouter's OpenAI provider, reasoning disabled, seed 29, and a 16384-token output cap. That revision exposes no deployment configuration for selecting another planner model or reasoning effort. A different policy requires a reviewed Runtime release and an updated source receipt.

## Verification

The PostgreSQL integration suite imports actual public GitHub captures and checks ordering, profile identity, PR attribution, admission races, and cancellation through a saturated execution pool. The live Gia suite runs through the explicit `pnpm test:live` command and requires a published World and a running Runtime. It compares generated query results against independent SQL over those captured records and varies natural-language phrasing. Neither suite mocks providers or substitutes liveness for correctness.

For a bounded planner comparison, `GIA_GOLDEN_REPETITIONS=5` repeats each selected wording five times. `GIA_GOLDEN_EVIDENCE_DIR` writes private per-case records with the snapshot, question, expected identities, actual identities, and Runtime request ID. `GIA_GOLDEN_DAILY_LIMIT` allows an explicit test-only admission allowance from 100 to 1000; it defaults to 100 and never changes the web service's allowance. Record the chosen value and planned call count before a paid cohort. Keep previous request accounting rather than deleting rows to make another run fit.

### Vocabulary grounding investigation

The initial real-data cohort exposed a material correctness failure: a query requiring reranking work plus an absent biography keyword returned people with unrelated PR evidence. A disjunction with public organization membership had the same problem. Sensitive local captures showed that the provider's original SQL omitted the concept condition; Core signing and SDK execution preserved that SQL. Another question combined a PR-specific evidence join with a repository-level NULL condition, producing an empty result.

General authored descriptions clarified concept identity, evidence scope, review status, support strength, and distinct project counts. Five identical repetitions per arm improved the simple reranking question from 0/5 to 5/5, while the biography and disjunction questions stayed at 0/5. The distinct-repository control remained 5/5. These are separate measurements from the full 13-case cohort, which moved from 9/13 to 10/13 and still failed release correctness.

The captured model input revealed missing vocabulary facts. PostgreSQL `TEXT` mapped to Gia's `text`/`long-text` classification, which its value-domain producer deliberately excludes unless another schema constraint supplies a domain. The concept slug and label therefore had no observed inventory, even though the database contained only 16 reviewed concepts. `raw-values` is an exposure permission; it does not itself make a field eligible for a vocabulary inventory.

Migration `0002` changes the bounded vocabulary identifier and display label to `VARCHAR(100)` and `VARCHAR(200)`. Freeform descriptions, excerpts, and profile text stay text. The pinned PostgreSQL adapter classifies varchar as `string`/`short-text`; a forced enriched refresh then records the actual slug and label values with `complete-at-snapshot` evidence. This preserves open-world meaning: it describes the indexed snapshot rather than declaring all future legal concepts. All eight authored descriptions remain in the World. A captured query with the new artifacts included the previously missing concept predicate and passed real signed execution.

The vocabulary treatment scored 5/5 for each of the simple PR capability, distinct-repository, biography, and disjunction cases. The repository-scope paraphrase stayed 0/5, giving 20/25 selected passes. Its remaining error was a contradictory scope join, independent from concept identity. The following full cohort scored 11/13: that scope paraphrase failed again, and a review-count query produced a multirow scalar subquery inside a distinct aggregate. The application preserved the execution failure. A successful paraphrase used the supported path through the shared repository, proving the required join is reachable without changing admission.

At this Runtime pin, `gia describe` can author relationship descriptions but the PostgreSQL Harness renderer omits those descriptions from its join listing. Field descriptions and `gia field-distinction` guidance do reach the model. Inspect the captured input before attributing a no-effect relationship edit to the planner or adding more prose.

The comparisons use the same frozen GitHub observations, question wording, identity output, planner policy, and disabled SQL reuse. No application SQL rewriting, provider substitution, weaker assertion, or private Gia implementation change is part of the correction. Local raw captures are private diagnostics with a 24-hour deletion deadline; they are not repository fixtures.
