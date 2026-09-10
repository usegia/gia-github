# Deployment

The reference installation runs the production Next.js build, a persistent worker, pinned PostgreSQL with ParadeDB, and a separate Gia runtime. Docker Compose currently provisions the database; local Gia lifecycle commands own a loopback runtime process. These commands do not provision a public server.

A public deployment requires an application host, a PostgreSQL host that supports the pinned `pg_search` extension, and a reachable Gia runtime. A Vercel web deployment still needs an external database and persistent worker. The runtime registry must use a different database from the customer GitHub corpus.

## Release sequence

1. Build from a clean checkout and the exact `.gia-sources.json` revisions. Private source access is required until a public Gia client distribution exists. Do not publish the generated `.deps` package or private runtime source as application source.
2. Provision separate migration-owner, application-writer, and reader roles. Apply the SQL migrations as the owner, then grant roles. Give the writer DML on the application tables and ownership of the `jobs` schema. Give the reader SELECT only on `github`.
3. Collect the bounded seed and verify coverage. Initialize or refresh Gia with enrichment, review the authored World, publish, move the serving profile, and export `gia/client-authority.json`.
4. Deploy the web application with `DATABASE_URL`, `GIA_DATABASE_URL`, `GIA_API_URL`, `GIA_API_KEY`, `GIA_ACTIVE_PROFILE`, `GIA_PROJECT_DIR`, and `APP_ORIGIN`. Include the matching authority artifact in the deployment. `APP_ORIGIN` is the canonical external HTTPS origin behind an ingress proxy.
5. Run the persistent worker with its writer URL and a public-read GitHub token. Keep provider keys on the process that needs them. Runtime receives its own registry URL and signing/provider keys, never the customer database URL or GitHub token.
6. Run the actual live and browser suites against the deployment. Search success must include correct identities and source context, not merely a successful health response.

Use unique credentials, private database networking, TLS at public ingress, and database backups. These are concrete deployment prerequisites; the local example passwords are not production credentials. Request admission defaults to three concurrent searches and 100 admitted searches per UTC day across web instances. These are request caps, not a currency estimate. Configure provider-side spending limits separately.

Each web instance loads one fixed authority artifact. Publish a new artifact and restart instances together after a World change. Preserve the previous image and serving-profile revision for rollback. Refreshing raw GitHub observations does not by itself update Gia's value evidence.

## CI

`Public data integration` runs automatically on pushes and pull requests. `Full Gia and browser integration` is manually dispatched and requires `GIA_SOURCE_TOKEN`, `OPENROUTER_API_KEY`, and `OPENAI_API_KEY` repository secrets. The private-source token needs read access only to the receipt repositories. The live workflow runs trusted repository code; do not expose its secrets to untrusted fork pull requests.

The repository contains no public database or hosted Gia credentials. A public hosting target and access arrangement must be selected before the application can serve everyone on the internet.

Run paid evaluations against a dedicated installation rather than a public production database. Live tests retain real admitted request records, including failures, because they consumed provider quota. Repeated test runs therefore consume that installation's daily allowance. The live Gia test command accepts an explicit `GIA_GOLDEN_DAILY_LIMIT` for a bounded diagnostic run; it does not change production admission limits or delete accounting history.
