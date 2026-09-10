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

The application retains the Runtime's default `terra-openai-none` planner policy: `openai/gpt-5.6-terra` through OpenRouter's OpenAI provider, reasoning disabled, seed 29, and a 16384-token output cap. Planner selection belongs to the Runtime process. Changing a web-process environment variable does not reconfigure an existing Runtime.

The launcher validates `GIA_RUNTIME_HARNESS_PROFILE` with the pinned Runtime's own `parseHarnessProfileId` before creating signing state, migrating, or spawning the server. `.env.example` selects `terra-openai-none`; the shipped Runtime revision `112b50f3ab2b44a06ee4847c6150488afb9060df` accepts only that profile. Benchmark candidates may accept additional profiles, but changing this variable does not make an unsupported profile available in the shipped source.

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

An authored evidence-scope distinction, rendered after the available joins, explains the different roles of the nullable PR reference and the source repository reference. With that distinction and the precise repository field description, the unchanged membership paraphrase improved from 0/5 to 5/5. PR-scope and review-count controls each passed 5/5, followed by all 13 original cases passing. The change adds domain meaning; it neither stores duplicate evidence nor changes the query grammar.

The additional hybrid acceptance case combines a full-text PR search for reranking with merged-work and known-follower filters. Catalog inspection verified that the account, PR, and repository indexes each use `id` as their BM25 key and `search_text` as searchable text. Their authored table descriptions expose that existing capability using the pinned Harness contract. The ordinary service case passed; a separate operator-only SDK capture matched its exact returned ticket ID to the signed program and verified an admitted `@@@` predicate alongside the relational filters. It returned the independently expected GitHub identity. Default live tests do not require sensitive capture.

The first expanded 14-case cohort passed 13 cases. The disjunction case regressed to a broad, truncated result: the issued query combined public membership with any authored merged PR and omitted its requested capability. That failure is retained alongside the earlier passing disjunction trials; one passing cohort does not establish stable accuracy for every phrasing. The sanitized per-question identities, snapshots, outcomes, and exact-ticket BM25 proof are recorded in `audit/query-evaluations.json`.

An unchanged diagnostic repeat then produced 5/5 exact disjunction answers and 5/5 exact BM25 controls. These calls used the same public SDK operation, question wrapper, identity output, limits, World and planner policy, with sensitive capture enabled to correlate every returned ticket; they omitted application admission and hydration. They establish intermittent composition behavior rather than a missing schema fact. They do not change the recorded 13/14 service-cohort result, and no further schema or prose correction was applied to make that run appear passing.

These schema and World comparisons kept the frozen GitHub observations, question wording, identity output, planner policy, and disabled SQL reuse constant. They used no application SQL rewriting, provider substitution, weaker assertion, or private Gia implementation change.

### Candidate reasoning-policy comparison

A separate Runtime candidate, revision `5c2f931309e3610c32746623481c0da62252bc11`, added a closed medium-reasoning profile. Its controlled comparison kept World `99d2f089490819f8eaedbe269e0386c3b63a4ecac902816a5479a4e8804e72a6`, the corpus, questions, SDK, Core, model, provider, seed, output cap, and disabled SQL reuse fixed. This was a measured candidate, not an application dependency or recommended deployment setting.

| Diagnostic case | Default none | Candidate medium | Median none | Median medium |
| --- | --- | --- | --- | --- |
| Explicit disjunction | 5/5 | 4/5 | 3.27 s | 23.07 s |
| BM25 plus relational filters | 5/5 | 5/5 | 2.29 s | 3.60 s |

The failed medium sample produced a union-shaped output that did not meet the stored `account.id` identity contract. Gia rejected it before database execution. Diagnostic times include local capture writing and failed attempts. Reported provider cost across five calls rose from $0.026352 to $0.161937 for the disjunction and from $0.017376 to $0.038296 for BM25. These small samples show no demonstrated accuracy gain and do not establish population accuracy rates.

The unchanged 14-case service cohort then passed under the candidate in 102.64 seconds. That result remains separate from its 4/5 diagnostic disjunction result and the default policy's earlier 13/14 service cohort. The application retains the default policy because this comparison did not justify the additional latency and cost.

The candidate's clean source revision, selected Runtime process, existing owner request-assembly test, and successful real provider calls establish the configured route. The assembly test checks `reasoning: { effort: "medium", exclude: true }`. Sensitive captures did not retain outbound model or reasoning controls, and no separate reasoning-token count was available. This is not a direct capture of the outbound request. Per-query source, policy, execution path, outcomes, usage, and measured duration are recorded in `audit/query-evaluations.json`.

The selected Runtime revision `112b50f3ab2b44a06ee4847c6150488afb9060df`, from its already-merged main branch, then passed the unchanged 14-case service suite in 45.35 seconds with default none reasoning and sensitive debug off. It includes general stable-projection guidance relative to the earlier none baseline, so this is a separate source observation rather than a reasoning-only comparison. The World and captured GitHub corpus were unchanged. The passing run does not resolve the intermittent disjunction concern recorded above.

Before the requested Gemini Flash low comparison, the selected revision also ran five unchanged disjunction queries and five BM25 controls through the diagnostic SDK path. Both scored 5/5, with exact signed-ticket correlation and an admitted indexed-search operator in every BM25 control. Median times were 3.837 seconds for the disjunction and 2.017 seconds for BM25; total reported provider costs for each five-call group were $0.027235 and $0.016675. This records a baseline with the current prompt guidance rather than relying on the older Runtime revision's repetitions.

### Gemini Flash low comparison

The user-requested Gemini comparison used private Runtime candidate `7ac6750b018def65b188f6724f938e913c642c3b`, retained on `usegia/gia-runtime` branch `feat/github-query-reasoning`. Its closed `gemini38-google-low` profile requests `google/gemini-3.8-flash` through `google-vertex/global`, with low reasoning. It preserves the selected revision's prompt guidance, seed, output cap, data-collection policy, and disabled provider fallback. The World, corpus, questions, identity output, Core, SDK, and disabled SQL reuse stayed fixed. This candidate records an experimental benchmark. Its profile is not a released Runtime setting or a shipped application dependency.

| Measurement | Terra none | Gemini low |
| --- | --- | --- |
| Disjunction diagnostic identities | 5/5 | 5/5 |
| BM25 diagnostic identities | 5/5 | 5/5 |
| Full service suite | 14/14 | 13/14 |
| Full suite duration | 45.35 s | 55.46 s |
| Median disjunction duration | 3.837 s | 3.143 s |
| Median BM25 duration | 2.017 s | 2.537 s |
| Five disjunction calls, reported cost | $0.027235 | $0.0319125 |
| Five BM25 calls, reported cost | $0.016675 | $0.034040625 |

The Gemini failure occurred on the same-repository AI SDK and PostgreSQL question. The application returned `PREPARATION_UNAVAILABLE`; the exact request ID correlated with HTTP 503 in the owned Runtime's completion log. Retained evidence does not identify a provider or transport subtype, and no identities were returned. The failure remains in the denominator and was not retried. Every diagnostic result matched independent expected identities, and every BM25 control had an indexed predicate in its exactly correlated signed ticket.

The configured process and clean source pin are recorded. The production decoder validates accepted response model identity, but saved query bundles omit resolved model/provider fields and OpenRouter generation IDs. A generation lookup was therefore unavailable. The decoder also accepts documented cache-hit responses that omit provider metadata, so successful calls alone do not independently prove the resolved provider. No request observer or synthetic preflight was added; the comparison records requested routing and marks returned routing metadata unavailable.

The application retains Terra none. Gemini did not demonstrate an overall improvement in this cohort: one full-suite preparation failure, faster disjunction repetitions, slower BM25 repetitions, and higher reported cost for both subsets. These small measurements do not establish population accuracy or reliability rates. The earlier intermittent disjunction concern remains. A separate fresh-installation proof uses a different project and is excluded from this model comparison.

Local raw captures are private diagnostics with a 24-hour deletion deadline; they are not repository fixtures.
