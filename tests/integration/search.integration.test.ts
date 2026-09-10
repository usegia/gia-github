import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admitSearch, finishSearch } from "../../packages/search/src/admission.ts";
import { findPerson, hydratePeople, readCatalog } from "../../packages/search/src/database.ts";
import { createExecutorPool } from "../../packages/search/src/executor.ts";
import { setupIntegrationDatabase } from "./setup.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for real PostgreSQL integration`);
  return value;
}
function testUrl(name: string): string {
  const url = new URL(required(name));
  url.pathname = "/gia_github_test";
  return url.href;
}
const writer = new pg.Pool({ connectionString: testUrl("DATABASE_URL"), max: 4 });
const reader = new pg.Pool({ connectionString: testUrl("GIA_DATABASE_URL"), max: 1 });
const cancellation = new pg.Pool({ connectionString: testUrl("GIA_DATABASE_URL"), max: 1 });
const requestIds: string[] = [];

beforeAll(async () => {
  const database = await setupIntegrationDatabase();
  await database.close();
  const result = await reader.query(
    "SELECT count(*)::integer AS people FROM github.accounts WHERE account_type='User'",
  );
  expect(
    result.rows[0].people,
    "Import the actual GitHub corpus before search integration",
  ).toBeGreaterThan(2);
});
afterAll(async () => {
  await writer.query("DELETE FROM operations.search_requests WHERE id=ANY($1::text[])", [
    requestIds,
  ]);
  await Promise.all([writer.end(), reader.end(), cancellation.end()]);
});

describe("public GitHub hydration against actual captured records", () => {
  it("retains caller identity order and resolves current usernames", async () => {
    const source = await reader.query(
      "SELECT id::text,login,bio FROM github.accounts WHERE account_type='User' ORDER BY id DESC LIMIT 3",
    );
    const ids = source.rows.map((row) => String(row.id));
    const people = await hydratePeople(reader, ids);
    expect(people.map((person) => person.id)).toEqual(ids);
    for (const [index, person] of people.entries()) {
      expect(person.login).toBe(source.rows[index].login);
      expect(person.bio).toBe(source.rows[index].bio);
      expect((await findPerson(reader, person.login.toUpperCase()))?.id).toBe(person.id);
    }
  });

  it("returns source PR context belonging to the displayed author", async () => {
    const source = await reader.query(`SELECT a.id::text,a.login FROM github.accounts a
      WHERE a.account_type='User' AND EXISTS(SELECT 1 FROM github.pull_requests p WHERE p.author_id=a.id)
      ORDER BY a.id LIMIT 1`);
    expect(source.rows).toHaveLength(1);
    const [person] = await hydratePeople(reader, [String(source.rows[0].id)]);
    expect(person).toBeDefined();
    const context = person?.context.filter((item) => item.kind === "pull_request") ?? [];
    expect(context.length).toBeGreaterThan(0);
    for (const item of context) {
      const proof = await reader.query(
        "SELECT author_id::text,head_sha,title FROM github.pull_requests WHERE pull_request_url=$1",
        [item.url],
      );
      expect(proof.rows[0].author_id).toBe(person?.id);
      expect(proof.rows[0].head_sha).toBe(item.sourceRevision);
      expect(proof.rows[0].title).toBe(item.title);
    }
  });

  it("refuses to silently drop missing or organization identities", async () => {
    const organization = await reader.query(
      "SELECT id::text FROM github.accounts WHERE account_type='Organization' LIMIT 1",
    );
    expect(organization.rows).toHaveLength(1);
    await expect(hydratePeople(reader, [String(organization.rows[0].id)])).rejects.toThrow(
      "does not match",
    );
    const absent = await reader.query("SELECT (max(id)+1)::text AS id FROM github.accounts");
    await expect(hydratePeople(reader, [String(absent.rows[0].id)])).rejects.toThrow(
      "does not match",
    );
  });

  it("reports actual corpus and partial-source counts", async () => {
    const catalog = await readCatalog(writer);
    const counts = await writer.query(
      "SELECT count(*)::integer AS value FROM ingest.sync_state WHERE status<>'complete'",
    );
    expect(catalog.coverage.partialSources).toBe(counts.rows[0].value);
    expect(catalog.coverage.people).toBeGreaterThan(2);
    expect(catalog.coverage.repositories).toBeGreaterThan(0);
    expect(catalog.concepts.length).toBeGreaterThan(0);
  });
});

describe("database-backed search admission and cancellation", () => {
  it("serializes simultaneous admission across separate connections", async () => {
    const clientKey = `integration-${randomUUID()}`;
    const common = {
      clientKey,
      maximumConcurrentSearches: 20,
      maximumDailySearches: 10_000,
      maximumSearchesPerMinute: 1,
      timeoutMs: 180_000,
    };
    const ids = [randomUUID(), randomUUID()];
    requestIds.push(...ids);
    const attempts = await Promise.all(ids.map((id) => admitSearch(writer, { ...common, id })));
    expect(attempts.filter((attempt) => attempt.kind === "accepted")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.kind === "rejected")).toEqual([
      { kind: "rejected", code: "RATE_LIMITED" },
    ]);
    const index = attempts.findIndex((attempt) => attempt.kind === "accepted");
    const id = ids[index];
    if (id === undefined) throw new Error("Admission had no winner");
    await finishSearch(writer, { id, outcome: "matches", runtimeRequestId: null, durationMs: 12 });
    const record = await writer.query(
      "SELECT finished_at,outcome,duration_ms FROM operations.search_requests WHERE id=$1",
      [id],
    );
    expect(record.rows[0]).toMatchObject({ outcome: "matches", duration_ms: 12 });
    expect(record.rows[0].finished_at).toBeInstanceOf(Date);
  });

  it("retains an active lease across UTC midnight beyond the per-client minute window", async () => {
    const activeId = randomUUID();
    const attemptedId = randomUUID();
    requestIds.push(activeId, attemptedId);
    await writer.query(
      "INSERT INTO operations.search_requests(id,client_hash,created_at) VALUES($1,$2,$3)",
      [activeId, "midnight-integration", new Date("2026-09-10T23:59:00Z")],
    );
    const result = await admitSearch(writer, {
      id: attemptedId,
      clientKey: `midnight-${randomUUID()}`,
      maximumConcurrentSearches: 1,
      maximumDailySearches: 1,
      maximumSearchesPerMinute: 1,
      timeoutMs: 180_000,
      evaluationTime: new Date("2026-09-11T00:00:10Z"),
    });
    expect(result).toEqual({ kind: "rejected", code: "SEARCH_BUSY" });
    await writer.query("UPDATE operations.search_requests SET finished_at=$2 WHERE id=$1", [
      activeId,
      new Date("2026-09-11T00:00:15Z"),
    ]);
    const afterCompletion = await admitSearch(writer, {
      id: attemptedId,
      clientKey: `midnight-${randomUUID()}`,
      maximumConcurrentSearches: 1,
      maximumDailySearches: 1,
      maximumSearchesPerMinute: 1,
      timeoutMs: 180_000,
      evaluationTime: new Date("2026-09-11T00:00:20Z"),
    });
    expect(afterCompletion).toEqual({ kind: "accepted" });
    await writer.query("UPDATE operations.search_requests SET finished_at=$2 WHERE id=$1", [
      attemptedId,
      new Date("2026-09-11T00:00:21Z"),
    ]);
  });

  it("cancels a busy single-slot execution pool through independent capacity", async () => {
    const pool = createExecutorPool(reader, cancellation);
    const connection = await pool.connect();
    try {
      const pending = connection.query("SELECT pg_sleep(10)");
      const rejection = expect(pending).rejects.toMatchObject({ code: "57014" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await pool.cancelBackend(connection.backendPid);
      await rejection;
      const usable = await connection.query("SELECT current_user AS role");
      expect(usable.rows).toHaveLength(1);
    } finally {
      connection.release();
    }
  });
});
