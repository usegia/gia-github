# Documentation map

Read only the owner relevant to the change.

| Document | Owns |
| --- | --- |
| [Architecture](architecture.md) | Module boundaries, source semantics, and search behavior |
| [Database](database.md) | Tables, indexes, roles, migrations, and coverage |
| [Ingestion](ingestion.md) | Bounded collection, enrichment, job recovery |
| [Gia](gia.md) | Exact dependency receipts, lifecycle commands, serving authority |
| [Web](web.md) | Routes, interactions, and application configuration |
| [Testing](../tests/README.md) | Real-data integration, live providers, browser checks |
| [Deployment](deployment.md) | Release steps and operational prerequisites |

`AGENTS.md` is the startup guide. Code and executable contracts own behavior. This directory explains decisions that are hard to infer from code; it does not duplicate Gia's documentation.
