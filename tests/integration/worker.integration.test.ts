import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Database } from "@gia-github/db";
import {
  accounts,
  captures,
  conceptEvidence,
  publicMemberships,
  pullRequests,
  repositoryLanguages,
  syncState,
} from "@gia-github/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Capture, captureScope, sha256 } from "../../apps/worker/src/capture.ts";
import { seedSchema } from "../../apps/worker/src/collector.ts";
import { validateModelExtractions } from "../../apps/worker/src/enrichment.ts";
import {
  importCapture,
  importCaptureDirectory,
  loadCaptureDirectory,
} from "../../apps/worker/src/importer.ts";
import { createJobQueue, SYNC_QUEUE } from "../../apps/worker/src/jobs.ts";
import { captureDirectory, setupIntegrationDatabase } from "./setup.ts";

describe("actual GitHub collection and PostgreSQL replay", () => {
  let database: Database;
  let observations: Capture[];
  beforeAll(async () => {
    database = await setupIntegrationDatabase();
    observations = await loadCaptureDirectory(captureDirectory);
  }, 120_000);
  afterAll(async () => {
    await database?.close();
  });

  it("preserves every captured profile field independently for all eight real people", async () => {
    const profiles = observations.flatMap((capture) =>
      capture.payload.kind === "profiles" ? capture.payload.records : [],
    );
    expect(profiles).toHaveLength(8);
    expect(new Set(profiles.map((profile) => profile.followers)).size).toBeGreaterThan(3);
    for (const expected of profiles) {
      const [actual] = await database.db
        .select()
        .from(accounts)
        .where(eq(accounts.id, BigInt(expected.id)));
      expect(actual).toMatchObject({
        login: expected.login,
        name: expected.name,
        bio: expected.bio,
        companyRaw: expected.company,
        locationRaw: expected.location,
        followersCount: expected.followers,
        publicReposCount: expected.public_repos,
      });
    }
  });

  it("replays the complete capture without duplicate facts or changing language identities", async () => {
    const before = await database.db
      .select()
      .from(repositoryLanguages)
      .orderBy(repositoryLanguages.id);
    const counts = await database.pool.query(
      "SELECT (SELECT count(*) FROM github.accounts) accounts, (SELECT count(*) FROM github.pull_requests) prs, (SELECT count(*) FROM github.pull_request_reviews) reviews, (SELECT count(*) FROM github.concept_evidence) evidence",
    );
    await importCaptureDirectory(database, captureDirectory);
    expect(
      await database.db.select().from(repositoryLanguages).orderBy(repositoryLanguages.id),
    ).toEqual(before);
    expect(
      (
        await database.pool.query(
          "SELECT (SELECT count(*) FROM github.accounts) accounts, (SELECT count(*) FROM github.pull_requests) prs, (SELECT count(*) FROM github.pull_request_reviews) reviews, (SELECT count(*) FROM github.concept_evidence) evidence",
        )
      ).rows,
    ).toEqual(counts.rows);
  }, 120_000);

  it("preserves a newer identity while applying an older complete profile", async () => {
    const capture = observations.find(
      (row) =>
        row.payload.kind === "profiles" &&
        row.payload.records.some((person) => person.login === "n1ckoates"),
    );
    if (capture?.payload.kind !== "profiles")
      throw new Error("Required actual profile capture missing");
    const [original] = await database.db.select().from(accounts).where(eq(accounts.id, 58091943n));
    if (!original) throw new Error("Required real account missing");
    const later = new Date(original.observedAt.getTime() + 60_000);
    try {
      // A case variant refers to the same real account; this exercises delivery order, not a fabricated person.
      await database.db
        .update(accounts)
        .set({
          login: original.login.toUpperCase(),
          observedAt: later,
          profileFetchedAt: null,
          bio: null,
        })
        .where(eq(accounts.id, original.id));
      await importCapture(database, capture);
      const [actual] = await database.db
        .select()
        .from(accounts)
        .where(eq(accounts.id, original.id));
      expect(actual?.login).toBe(original.login.toUpperCase());
      expect(actual?.observedAt).toEqual(later);
      expect(actual?.followersCount).toBe(capture.payload.records[0]?.followers);
      expect(actual?.searchText).toContain(original.login.toUpperCase());
    } finally {
      await database.db.update(accounts).set(original).where(eq(accounts.id, original.id));
    }
  });

  it("does not retire public members when only a subset of an actual traversal is supplied", async () => {
    const capture = observations.find(
      (row) => row.payload.kind === "memberships" && row.payload.organization.login === "vercel",
    );
    if (capture?.payload.kind !== "memberships")
      throw new Error("Actual public membership list missing");
    const before = await database.db
      .select()
      .from(publicMemberships)
      .where(eq(publicMemberships.organizationId, BigInt(capture.payload.organization.id)));
    expect(before).toHaveLength(72);
    await importCapture(database, {
      ...capture,
      coverage: { ...capture.coverage, status: "partial" },
      payload: { ...capture.payload, records: capture.payload.records.slice(0, 1) },
    });
    expect(
      await database.db
        .select()
        .from(publicMemberships)
        .where(eq(publicMemberships.organizationId, BigInt(capture.payload.organization.id))),
    ).toEqual(before);
    await importCapture(database, capture);
  });

  it("rolls back preceding real PR writes and the checkpoint when a later row fails a real database constraint", async () => {
    const capture = observations.find(
      (row) => row.payload.kind === "pull_requests" && row.payload.repository === "vercel/ai",
    );
    if (capture?.payload.kind !== "pull_requests")
      throw new Error("Actual AI SDK PR capture missing");
    const first = capture.payload.records[0];
    if (!first || first.user?.id === 58091943)
      throw new Error("Actual rollback population changed");
    const digest = sha256(JSON.stringify(capture));
    const source = captureScope(capture);
    await database.db.delete(pullRequests).where(eq(pullRequests.id, BigInt(first.id)));
    await database.db.delete(captures).where(eq(captures.id, digest));
    await database.db
      .delete(syncState)
      .where(and(eq(syncState.scope, source.scope), eq(syncState.resource, source.resource)));
    await database.pool.query(
      "ALTER TABLE github.accounts ADD CONSTRAINT worker_reject_actual_account CHECK (id <> 58091943) NOT VALID",
    );
    try {
      await expect(importCapture(database, capture)).rejects.toThrow();
      expect(
        await database.db
          .select()
          .from(pullRequests)
          .where(eq(pullRequests.id, BigInt(first.id))),
      ).toHaveLength(0);
      expect(await database.db.select().from(captures).where(eq(captures.id, digest))).toHaveLength(
        0,
      );
      expect(
        await database.db
          .select()
          .from(syncState)
          .where(and(eq(syncState.scope, source.scope), eq(syncState.resource, source.resource))),
      ).toHaveLength(0);
    } finally {
      await database.pool.query(
        "ALTER TABLE github.accounts DROP CONSTRAINT worker_reject_actual_account",
      );
      await importCapture(database, capture);
    }
  });

  it("does not accept file evidence for a PR head that is no longer current", async () => {
    const capture = observations.find(
      (row) =>
        row.payload.kind === "pull_request_files" && row.payload.pullRequestId === 4230553909,
    );
    if (capture?.payload.kind !== "pull_request_files")
      throw new Error("Actual reranking file capture missing");
    const [original] = await database.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.id, 4230553909n));
    const [other] = await database.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.id, 4224468960n));
    if (!original || !other) throw new Error("Actual PR revisions missing");
    const originalEvidence = await database.db
      .select()
      .from(conceptEvidence)
      .where(eq(conceptEvidence.pullRequestId, original.id));
    expect(originalEvidence.length).toBeGreaterThan(0);
    try {
      await database.db
        .update(pullRequests)
        .set({ headSha: other.headSha })
        .where(eq(pullRequests.id, original.id));
      await database.db
        .update(conceptEvidence)
        .set({ reviewStatus: "superseded" })
        .where(eq(conceptEvidence.pullRequestId, original.id));
      await importCapture(database, capture);
      expect(
        await database.db
          .select()
          .from(conceptEvidence)
          .where(
            and(
              eq(conceptEvidence.pullRequestId, original.id),
              eq(conceptEvidence.reviewStatus, "accepted"),
            ),
          ),
      ).toHaveLength(0);
    } finally {
      await database.db
        .update(pullRequests)
        .set({ headSha: original.headSha })
        .where(eq(pullRequests.id, original.id));
      for (const evidence of originalEvidence)
        await database.db
          .update(conceptEvidence)
          .set({ reviewStatus: evidence.reviewStatus })
          .where(eq(conceptEvidence.id, evidence.id));
    }
  });

  it("rejects unsupported model claims against an actual README", () => {
    const capture = observations.find(
      (row) => row.payload.kind === "readme" && row.payload.repository === "vercel/ai",
    );
    if (capture?.payload.kind !== "readme") throw new Error("Actual README missing");
    const text = Buffer.from(capture.payload.content.content, "base64").toString("utf8");
    expect(validateModelExtractions({ claims: [] }, text, "test-boundary")).toEqual([]);
    expect(() =>
      validateModelExtractions(
        { claims: [{ slug: "employment", excerpt: text.slice(0, 40) }] },
        text,
        "test-boundary",
      ),
    ).toThrow();
    expect(() =>
      validateModelExtractions(
        { claims: [{ slug: "ai", excerpt: "unsupported statement absent from this repository" }] },
        text,
        "test-boundary",
      ),
    ).toThrow();
  });

  it("persists a real seed job across queue process restarts and deduplicates its singleton key", async () => {
    const seed = seedSchema.parse(
      JSON.parse(
        await readFile(
          fileURLToPath(new URL("../../config/seed-manifest.json", import.meta.url)),
          "utf8",
        ),
      ),
    );
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is required");
    const writerUrl = new URL(url);
    writerUrl.username = "gia_github_writer";
    writerUrl.password = "local-write-only";
    const first = await createJobQueue(writerUrl.href);
    const id = await first.send(
      SYNC_QUEUE,
      { seed, maximumRequests: 50 },
      { singletonKey: "integration-seed" },
    );
    expect(id).not.toBeNull();
    expect(
      await first.send(
        SYNC_QUEUE,
        { seed, maximumRequests: 50 },
        { singletonKey: "integration-seed" },
      ),
    ).toBeNull();
    await first.stop({ graceful: true });
    const restarted = await createJobQueue(writerUrl.href);
    try {
      const jobs = await restarted.fetch<unknown>(SYNC_QUEUE, { batchSize: 1 });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.id).toBe(id);
      expect(jobs[0]?.data).toEqual({ seed, maximumRequests: 50 });
      if (id) await restarted.complete(SYNC_QUEUE, id);
    } finally {
      await restarted.stop({ graceful: true });
    }
  }, 30_000);
});
