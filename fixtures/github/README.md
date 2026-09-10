# Immutable public GitHub captures

`manifest.json` records the SHA-256 digest of every source capture. The production importer validates those bytes and parses the allowlisted envelope before writing PostgreSQL. Capture files retain their actual source URLs, observation times, API version, pagination links, and coverage.

The corpus was collected on 2026-09-10. It contains actual public GitHub records; it does not contain generated people, HTTP mocks, credentials, email fields, private membership observations, or discovery-only repository lists.

Do not edit a capture to make a test pass. Add a separately dated capture with provenance when new real evidence is required. Tests may select actual records or vary delivery order/failure conditions to exercise the ingestion boundary; those scenarios must not be described as new GitHub observations.

The complete corpus inventory and its limitations are documented in `docs/ingestion.md`. Most PR histories and profile records are partial, and their coverage must remain visible to search callers.
