# Search ownership

`src/contracts.ts` is the browser-safe application response contract. `src/server.ts` exposes the configured server service. This package owns Gia client/executor composition, manifest decoding, query limits, and profile hydration. It never imports private Runtime implementation or authors SQL from natural-language keywords.

Use Gia's real public query operation and explicit person identity answer. Preserve order, assumptions, truncation, and failure semantics. Hydrated PRs, concepts, and memberships are context unless returned query evidence proves why a person matched. Never manufacture per-match explanations from a later unrelated lookup.

The executor pool must retain one read-only repeatable-read connection for its session and have separate cancellation capacity. Credentials and local authority are injected by the executable host. Never expose provider exceptions, SQL debug captures, private paths, or keys in HTTP results.

Required tests use the actual Gia Runtime, real PostgreSQL, and real GitHub data. Compare person IDs with independently authored SQL expectations. Include meaningful matches/exclusions, paraphrases, multi-relation conditions, and unsupported questions. Do not mock Gia outcomes or count a returned row as correctness.
