# Integration proof

The required suites use real PostgreSQL with the pinned ParadeDB image and actual public GitHub records. No mocked providers, HTTP stubs, synthetic people, or smoke-only success checks are permitted.

`fixtures/github` holds immutable, allowlisted real GitHub captures with source URLs, capture time, content digests, and collection coverage. Production normalizers import these records. Captures prove repeatable ingestion and query behavior; the live tier separately proves current GitHub/Gia compatibility.

The database tier proves uniqueness, foreign keys, BM25 behavior, page/checkpoint atomicity, idempotent replay, and evidence revision handling. The Gia tier compares actual natural-language results with independently reviewed SQL expectations, including required and excluded identities. Browser tests submit real searches and inspect results, assumptions, coverage, and source links.

Use fixed evaluation dates for frozen temporal expectations. Exercise paraphrases, conjunctions on the same repository, exclusion, duplicate joins, absent evidence, and unknown/unsupported claims. Assert fixture population before result comparisons. Deliberate malformed inputs and real transaction/process failures test boundaries; they must not fabricate people or replace an external API with a stub.

Each integration command must report its data source, source revisions, cases executed, and failures. Missing required prerequisites, zero cases, and an entirely empty expected corpus fail the suite.
