# Web application

`apps/web` is the Next.js application. Run `pnpm --filter @gia-github/web dev` from the repository after installing dependencies, migrating PostgreSQL, and importing the real capture. The default port is 3000. `pnpm --filter @gia-github/web build` does not connect to PostgreSQL or issue Gia queries.

The server composition root reads the repository `.env` lazily. It uses `DATABASE_URL` for search bookkeeping, `GIA_DATABASE_URL` for verified read-only execution, `GIA_PROJECT_DIR`, `GIA_API_URL`, `GIA_API_KEY`, and `GIA_ACTIVE_PROFILE`. `SEARCH_TIMEOUT_MS` defaults to 120000 and accepts 1000 through 180000. Gia may read its ignored project credentials when no API key is provided. Catalog and profile reads do not need a Gia API key.

## Requests and interpretation

- `GET /api/catalog` reads actual collection counts, examples, concepts, coverage, and freshness. Unavailable counts remain unavailable; the UI never substitutes zero.
- `GET /api/people/:login` reads one collected profile and its public source context.
- `POST /api/search` accepts the shared strict Zod request contract. It requires an Origin matching the direct request Host and protocol, rejects cross-site requests, accepts only JSON, and limits the body to 12 KiB. Next may normalize its internal request URL to the bind address, so the check uses the direct Host header, never an arbitrary forwarded host. Client cancellation reaches Gia through the request signal. No search runs during navigation, build, URL restoration, example selection, or typing.

The endpoint uses one conservative shared admission bucket, `public-web`. Do not derive a client identity from arbitrary forwarded headers. A deployment that needs per-client budgets must establish its trusted proxy or authenticated identity before changing this boundary. Global usage limits remain in the search service. Configure the ingress so Next.js sees the application's public request origin; the browser does not submit cross-origin searches.

The browser preserves the service's person order and shows distinct matches, supported empty results, assumptions, unsupported questions, operational failures, and cancellation. It displays actual elapsed request time, without invented progress stages. The question is restored from `?q=` but requires an explicit submission.

## Public data and links

Profile activity is contextual. It must not be relabeled as a reason for the match unless the search contract adds actual query-bound evidence. Membership indicates public affiliation, company and location are self-reported, and repository capabilities do not prove an individual's skill. Observation dates and partial collection stay visible.

Public source links allow only HTTPS GitHub URLs without embedded credentials. Avatars allow only `avatars.githubusercontent.com`. Text excerpts render as plain text. The application never renders GitHub Markdown as raw HTML.

## Integration proof

`tests/browser/search.spec.ts` uses a running application, PostgreSQL with imported real GitHub data, and an initialized Gia project/profile. The root Playwright configuration owns server startup. `pnpm test:e2e` fails when prerequisites are missing; it does not intercept or replace API responses.

The suite checks nonempty real catalog data, restored questions without paid requests, real membership/contribution matching, public source context, a supported empty result, HTTP admission failures, actual profile navigation, and mobile overflow. The positive window is June 12, 2026 inclusive through September 11, 2026 exclusive. The reviewed positive identities include `n1ckoates` and `HugoRCD`. Changing the corpus requires reviewing those expectations against independent SQL.

Radix Dialog supplies the activity drawer's focus management and Escape behavior. Keyboard users can submit with Enter, add a new line with Shift+Enter, and focus search with Command/Ctrl+K. The page supports reduced motion and keeps search, cancellation, and source controls accessible at narrow widths.
