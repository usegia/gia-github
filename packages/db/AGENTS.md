# Database ownership

`src/schema.ts` defines the typed relational schema. Generated SQL and custom migrations in `migrations` create the actual database. Use explicit SQL for ParadeDB, grants, and source comments. Never mutate schema on application startup.

Stable GitHub IDs use PostgreSQL bigint and TypeScript bigint. Browser/API IDs are decimal strings. Foreign keys, unique keys, nonnegative counts, and valid evidence ownership belong in database constraints. Public account kind and evidence method remain explicit values.

Tests run against real PostgreSQL/ParadeDB and actual GitHub captures. Verify transaction rollback, idempotent replay, constraints, and indexed query results. Do not replace PostgreSQL with an in-memory substitute. Keep test databases isolated from the seeded development database.

Changing a queryable column or relation requires updating its SQL comment and refreshing Gia through the owning lifecycle command. Record schema changes in migrations; never edit an already-applied migration to change a deployed database.
