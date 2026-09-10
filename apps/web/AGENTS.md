# Web application ownership

Use Next.js App Router and Server Components for pages and initial safe reads. Client Components own explicit search submission and interaction state. Paid Gia calls must never run because of a prefetch, build, or keystroke. Use a bounded POST endpoint and pass cancellation through the server service.

Import browser-safe contracts from `@gia-github/search/contracts`; import the server service only from server-owned files. Do not duplicate search logic, decode arbitrary Gia tuples in the browser, or expose credentials via NEXT_PUBLIC variables. Read configuration in the app's composition root.

Present actual people, source observation dates, collection coverage, assumptions, and honest context. Public membership is not employment. The source drawer describes collected context unless query evidence directly establishes a match. Unsupported, failure, empty results, and partial coverage are different states.

Keep shadcn components local under `src/components/ui`. Use accessible labels, focus states, keyboard submission, reduced-motion support, responsive layouts, and adequate contrast. Validate API requests before calling a provider; render remote Markdown only through a safe renderer or as plain text.

Browser tests call the real application, real Gia, and real PostgreSQL with actual GitHub records. Do not intercept routes to inject fake responses. Assert person identity and meaningful evidence, not just a heading or HTTP 200.
