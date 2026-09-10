# Collection and enrichment ownership

Collect only public GitHub resources. Prefer explicit public-members endpoints even when a credential has more access. Use stable IDs, preserve API canonical names after redirects, and never infer hidden membership, employment, or personal skills.

The CLI owns environment reads and budgets. GitHub calls use a bounded serial request schedule, pagination links, conditional requests, and rate-limit headers. Keep network calls outside database transactions. Commit a page's facts and checkpoint together. A capped or failed traversal is partial, never complete. Sorting PRs by update time does not sort merge time.

Store only allowlisted fields. Actual capture fixtures include source URL, timestamp, API version, digest, and coverage. Do not store emails, authentication headers, unrestricted API responses, or private source data. Preserve source revisions for README and PR evidence. LLM extraction validates a closed concept vocabulary and a source-supported excerpt, and can abstain. Enrichment never changes GitHub facts.

pg-boss owns retries and scheduling; `ingest.sync_state` owns collection completeness. Tests use actual GitHub captures through production import and a real PostgreSQL database, plus live API integration. Exercise rollback/replay with real records. Do not use synthetic profiles, mocks, fake HTTP servers, or vacuous success checks.
