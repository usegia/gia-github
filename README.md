# Gia GitHub

Search public GitHub people and their work with natural language. Results are grounded in profiles, public organization membership, repositories, pull requests, reviews, and source-linked concept evidence.

This repository is under initial implementation. `AGENTS.md` maps code ownership and verification requirements. `CONTRIBUTING.md` describes the executable development workflow as it is completed.

The application uses Next.js, Tailwind, shadcn/ui, PostgreSQL with ParadeDB, and a separate ingestion worker. Gia prepares signed queries; the application verifies and executes them against its read-only database connection.

Only public GitHub evidence is collected. Organization membership does not establish employment, and a repository's capabilities do not establish every contributor's personal skills. Coverage and source dates are part of the result.

Gia Core, SDK, and Runtime are currently private dependencies. The application source does not include their implementation. The final setup guide will distinguish access requirements from the public application's own license.
