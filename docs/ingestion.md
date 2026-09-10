# Collecting public GitHub evidence

The worker imports public GitHub facts into PostgreSQL. The capture importer is the production write path for both the checked-in dataset and live collection. A capture contains an allowlisted payload, API URL/version, observation timestamp, ETag, and explicit coverage.

## Commands

Run commands at the repository root after database migrations and role grants:

```sh
pnpm ingest
pnpm ingest -- --capture fixtures/github
pnpm ingest -- --live --seed config/seed-manifest.json --max-requests 350
pnpm worker
pnpm --filter @gia-github/worker exec tsx src/cli.ts enrich --max-model-calls 1
```

`DATABASE_URL` is the application writer connection, not the migration connection. Live collection also requires `GIA_GITHUB_TOKEN`. Optional model enrichment requires `OPENAI_API_KEY`; `GIA_GITHUB_ENRICHMENT_MODEL` defaults to `gpt-4.1-mini`. Environment loading happens only in the executable entrypoint. Library functions receive configuration explicitly.

The foreground live command reports its request count and whether its budget ended the run. Each successful source page remains committed if a later request fails. `ingest.sync_state` records partial traversal, the next page, successful observations, and failed attempts. A finished bounded run can still have partial source coverage.

The persistent worker stores jobs in the PostgreSQL `jobs` schema, which database setup creates for the writer. It queues an initial collection and repeats every six hours. Pass `--no-schedule` when starting the worker directly to process a single initial job without creating a recurring schedule. The queue allows one pending or active job per seed key and retries failures with backoff. Graceful shutdown stops job delivery and closes connections.

## Seed and request budgets

`config/seed-manifest.json` selects 15 repositories and four public-membership lists. Stable repository IDs allow renamed repositories to keep their identity. GitHub's canonical response supplies the current owner/name.

The seed limits PR pages, records per page, time window, full profile fetches, reviewed PRs, and PR file lists separately. Collection visits repository metadata first, then public members, repository content/activity, selected reviews/files, and profiles. Review slots are spread across repositories. It never expands every person into all of their repositories.

Requests are serial, counted before dispatch, and restricted to `https://api.github.com`. Octokit's implicit retries are disabled so the request budget is real. ETags revalidate complete profile, metadata, content, language, review, and file observations. Rate-limit responses fail the job without a tight retry loop; pg-boss handles later attempts. A budget must cover the fixed discovery and revalidation work before it can make progress on later sources. The initial 15-repository seed fits the default 350-request budget.

PR traversal sorts by `updated_at`. It may stop after reaching the requested update window; it cannot stop based on `merged_at`, because recently updated old merges appear between newer merges. A bounded page with a next link remains partial. Closed PRs without `merged_at` are not contributions. Bot authors/reviewers are preserved as accounts so person queries can exclude them explicitly.

Only `/orgs/{org}/public_members` supplies membership. Each page is partial until the entire traversal succeeds. The final complete set can retire absent members. Missing public membership does not establish lack of employment or a historical affiliation. Large membership traversals stop after ten pages and remain partial.

## Transactions, identity, and freshness

All GitHub IDs use `bigint`. Actual PR IDs already exceed 32-bit integer range. Account names and repository names can change without changing identity.

The importer takes a transaction-scoped advisory lock for one source, writes its facts, stores its capture receipt, and writes its checkpoint in the same transaction. Requests and model calls occur outside that transaction. Replaying a capture preserves logical facts and existing language IDs. Constraint failures roll back preceding row writes and the checkpoint.

Sparse account observations update identity fields without erasing complete profile fields. Identity observation time and complete-profile fetch time are checked separately, so a delayed profile cannot undo a newer account name. GitHub nulls from a complete profile remain nulls; unknown follower counts are not zero.

README content stores its Git blob SHA. PR evidence stores the PR head commit SHA. These identities differ: an immutable blob URL uses `/git/blobs/{blob_sha}`, not a web URL that treats a blob SHA as a commit. An old PR-file capture cannot produce accepted evidence when its head differs from the current stored PR head.

## Concept enrichment

The initial vocabulary is `ai`, `rag`, `retrieval`, `reranking`, `embeddings`, `tool-calling`, `hybrid-search`, `semantic-search`, `agents`, `mcp`, `npm:ai`, `postgresql`, `redis`, `nextjs`, `openai`, and `langgraph`.

Package-manifest extraction recognizes exact direct/optional/peer dependency names. Text extraction records concept mentions in topics, README text, PR titles/bodies, and added patch lines. Deleted patch lines cannot create new evidence. Mention-derived evidence has `support_level=inferred`; a mention alone does not prove an implemented feature, negate surrounding prose, or establish a contributor's personal skill. Exact package evidence has `support_level=explicit` and still describes the repository, not every contributor.

Each concept record retains the source, revision, exact excerpt, extraction version, scope, and review state. New observations supersede prior source evidence. Semantic guidance and result explanations must preserve repository versus PR scope and explicit versus inferred support.

Optional model enrichment uses a bounded README excerpt and a closed concept vocabulary. It retains only exact source substrings with allowed concepts. Unsupported proposed claims are rejected individually and counted in the receipt; safe abstention can yield zero claims. All retained model claims begin `pending`, so the model cannot silently promote its own interpretation to accepted search evidence. Review the source before changing a proposal's status to `accepted` or `rejected`.

Successful model calls, including abstentions, are cached by repository, source revision, model, and extractor version. A second run for the same source reads the receipt without another model call. A crash after a provider response but before the database commit can repeat the external call, so the per-run call limit remains necessary.

## Actual dataset and tests

`fixtures/github/manifest.json` lists 95 immutable captures and their SHA-256 digests. They were observed on 2026-09-10 between 10:25:13 and 10:28:47 UTC through API version `2022-11-28`. They contain 15 repositories, 137 human account identities, eight complete profiles, 343 closed PRs, 294 merged PRs, 17 reviews, 15 README files, 15 language maps, eight package manifests, and five PR file sets. Public-membership lists contain 72 Vercel members, five vercel-labs members, two assistant-ui members, and zero Upstash members.

The frozen PR corpus is a closed-PR sample. Live collection uses `state=all` within its update window. Five captured closed-PR lists are complete at observation: `vercel-labs/ai-facts`, `vercel-labs/ai-sdk-persistence-db`, `vercel-labs/natural-language-postgres`, `upstash/rag-chat-component`, and `vercel-labs/bash-tool`. The other PR lists are partial. Only selected PRs have collected reviews/files. Most profiles are sparse; the database does not invent omitted profile fields.

`tests/integration/worker.integration.test.ts` imports these records through production code into real PostgreSQL. It verifies each full profile independently, replay/identity stability, sparse coverage, transaction rollback under a real constraint, obsolete PR-head evidence, model boundaries, and persistent queue restart. `tests/live/github.live.test.ts` exercises real API redirects, ETags, public membership, an exact merged PR, and one bounded real model enrichment with cached replay. Missing credentials fail the live tier rather than silently skipping it.

The corpus does not make all ten golden queries nonempty. For example, it contains no personally owned repository and limited multi-month review history. Query expectations must use the actual collection scope and an explicit evaluation date.
