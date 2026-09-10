import { createDatabase, type Database } from "@gia-github/db";
import { migrateDatabase } from "@gia-github/db/migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupIntegrationDatabase } from "./setup.ts";

let database: Database;
beforeAll(async () => {
  database = await setupIntegrationDatabase();
});
afterAll(async () => {
  await database?.close();
});

async function rejectedStatement(statement: string, code: string): Promise<void> {
  const connection = await database.pool.connect();
  try {
    await connection.query("BEGIN");
    await expect(connection.query(statement)).rejects.toMatchObject({ code });
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
  }
}

function roleDatabase(role: "writer" | "reader"): Database {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  url.username = `gia_github_${role}`;
  url.password = role === "writer" ? "local-write-only" : "local-read-only";
  return createDatabase({ connectionString: url.toString() });
}

describe("migrated PostgreSQL with actual public GitHub observations", () => {
  it("imports a nonempty, bounded corpus with actual merged and unmerged PRs", async () => {
    const { rows } = await database.pool.query(`
      SELECT (SELECT count(*)::int FROM github.repositories) AS repositories,
             (SELECT count(*)::int FROM github.accounts WHERE account_type = 'User') AS people,
             count(*)::int AS pulls,
             count(*) FILTER (WHERE merged_at IS NOT NULL)::int AS merged,
             count(*) FILTER (WHERE merged_at IS NULL)::int AS unmerged
      FROM github.pull_requests
    `);
    expect(rows[0]).toMatchObject({ repositories: 15, pulls: 343, merged: 294, unmerged: 49 });
    expect(rows[0]?.people).toBeGreaterThanOrEqual(137);
  });

  it("preserves GitHub IDs above signed 32-bit range exactly", async () => {
    const { rows } = await database.pool.query(`
      SELECT p.id, p.number, r.full_name FROM github.pull_requests p
      JOIN github.repositories r ON r.id = p.repository_id
      WHERE p.id = 4489175312
    `);
    expect(rows).toEqual([{ id: "4489175312", number: 20564, full_name: "vercel/ai" }]);
  });

  it("uses the canonical renamed repository identity", async () => {
    const { rows } = await database.pool.query(
      "SELECT id, full_name FROM github.repositories WHERE id = 642917329",
    );
    expect(rows).toEqual([{ id: "642917329", full_name: "vercel/chatbot" }]);
  });

  it("retains sparse profile unknowns and distinguishes bots from humans", async () => {
    const { rows } = await database.pool.query(`
      SELECT count(*) FILTER (WHERE account_type = 'Bot')::int AS bots,
             count(*) FILTER (WHERE account_type = 'User' AND profile_fetched_at IS NULL AND followers_count IS NULL)::int AS unknown_profiles,
             count(*) FILTER (WHERE account_type = 'User' AND profile_fetched_at IS NOT NULL)::int AS profiles
      FROM github.accounts
    `);
    expect(rows[0]?.bots).toBeGreaterThan(0);
    expect(rows[0]?.unknown_profiles).toBeGreaterThan(100);
    expect(rows[0]?.profiles).toBeGreaterThanOrEqual(8);
  });

  it("proves the public affiliation and merged-PR join using independent SQL", async () => {
    const { rows } = await database.pool.query(`
      SELECT DISTINCT a.login
      FROM github.accounts a
      JOIN github.public_memberships m ON m.person_id = a.id AND m.currently_public
      JOIN github.accounts org ON org.id = m.organization_id AND lower(org.login) = 'vercel'
      JOIN github.pull_requests p ON p.author_id = a.id
      WHERE a.account_type = 'User'
        AND p.merged_at >= '2026-06-12T00:00:00Z' AND p.merged_at < '2026-09-11T00:00:00Z'
      ORDER BY a.login
    `);
    expect(rows.map((row) => row.login)).toEqual(expect.arrayContaining(["HugoRCD", "n1ckoates"]));
  });

  it("distinguishes review rows, reviewed PRs, and self-review on actual vector-js#53", async () => {
    const { rows } = await database.pool.query(`
      SELECT count(*)::int AS reviews,
             count(*) FILTER (WHERE v.reviewer_id = p.author_id)::int AS self_reviews,
             count(DISTINCT v.reviewer_id) FILTER (WHERE v.reviewer_id <> p.author_id)::int AS other_reviewers,
             count(DISTINCT v.pull_request_id)::int AS pull_requests
      FROM github.pull_request_reviews v
      JOIN github.pull_requests p ON p.id = v.pull_request_id
      JOIN github.repositories r ON r.id = p.repository_id
      WHERE r.full_name = 'upstash/vector-js' AND p.number = 53
    `);
    expect(rows).toEqual([{ reviews: 11, self_reviews: 2, other_reviewers: 2, pull_requests: 1 }]);
  });

  it("retrieves the real reranking PR using the actual BM25 index", async () => {
    const { rows } = await database.pool.query(`
      SELECT id, title, paradedb.score(id) AS score
      FROM github.pull_requests WHERE search_text @@@ 'reranking'
      ORDER BY paradedb.score(id) DESC, id
    `);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.find((row) => row.id === "4230553909")?.title).toBe("Implement reranking");
    expect(rows.every((row) => row.score > 0)).toBe(true);
  });

  it("keeps complete and partial enumerations distinguishable", async () => {
    const { rows } = await database.pool.query(
      "SELECT status, count(*)::int AS count FROM ingest.sync_state GROUP BY status",
    );
    const counts = new Map(rows.map((row) => [row.status, row.count]));
    expect(counts.get("complete")).toBeGreaterThan(0);
    expect(counts.get("partial")).toBeGreaterThan(0);
  });

  it("reapplying migrations preserves all captured records", async () => {
    const before = await database.pool.query(
      "SELECT count(*)::int AS count FROM github.pull_requests",
    );
    await migrateDatabase(database);
    const after = await database.pool.query(
      "SELECT count(*)::int AS count FROM github.pull_requests",
    );
    expect(after.rows).toEqual(before.rows);
    expect(after.rows[0]?.count).toBe(343);
  });

  it("rejects negative follower counts through the database constraint", async () => {
    await rejectedStatement(
      "UPDATE github.accounts SET followers_count = -1 WHERE login = 'n1ckoates'",
      "23514",
    );
  });

  it("rejects identity collisions even when login case differs", async () => {
    await rejectedStatement(
      `UPDATE github.accounts SET login = 'N1CKOATES' WHERE login = 'HugoRCD'`,
      "23505",
    );
  });

  it("rejects moving a review onto a deleted PR through its foreign key", async () => {
    await rejectedStatement(
      `DELETE FROM github.pull_requests WHERE id IN (SELECT pull_request_id FROM github.pull_request_reviews LIMIT 1)`,
      "23503",
    );
  });

  it("prevents PR evidence from claiming a different repository", async () => {
    const actual = await database.pool.query(
      "SELECT count(*)::int AS count FROM github.concept_evidence WHERE pull_request_id IS NOT NULL",
    );
    expect(actual.rows[0]?.count).toBeGreaterThan(0);
    await rejectedStatement(
      `
      UPDATE github.concept_evidence e SET repository_id =
        (SELECT r.id FROM github.repositories r WHERE r.id <> e.repository_id LIMIT 1)
      WHERE e.id = (SELECT id FROM github.concept_evidence WHERE pull_request_id IS NOT NULL LIMIT 1)
    `,
      "23503",
    );
  });

  it("allows the application writer to update data but denies DDL", async () => {
    const writer = roleDatabase("writer");
    try {
      const updated = await writer.pool.query(
        "UPDATE github.accounts SET login = login WHERE login = 'n1ckoates' RETURNING id",
      );
      expect(updated.rows).toEqual([{ id: "58091943" }]);
      await expect(
        writer.pool.query("CREATE TABLE github.forbidden (id integer)"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await writer.close();
    }
  });

  it("enforces reader permissions even after disabling default read-only mode", async () => {
    const reader = roleDatabase("reader");
    const connection = await reader.pool.connect();
    try {
      const people = await connection.query(
        "SELECT id FROM github.accounts WHERE login = 'n1ckoates'",
      );
      expect(people.rows).toEqual([{ id: "58091943" }]);
      await connection.query("SET default_transaction_read_only = off");
      await expect(
        connection.query("UPDATE github.accounts SET login = login WHERE login = 'n1ckoates'"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        connection.query("SELECT * FROM operations.search_requests"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(connection.query("SELECT * FROM ingest.captures")).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      connection.release();
      await reader.close();
    }
  });
});
