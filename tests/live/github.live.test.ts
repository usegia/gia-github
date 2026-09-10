import { captures, conceptEvidence, repositories } from "@gia-github/db/schema";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  accountSchema,
  pullRequestSchema,
  repositorySchema,
} from "../../apps/worker/src/capture.ts";
import { enrichRepositories } from "../../apps/worker/src/enrich-database.ts";
import { conceptDefinitions } from "../../apps/worker/src/enrichment.ts";
import { createGitHubClient, GitHubCollectionError } from "../../apps/worker/src/github.ts";
import { setupIntegrationDatabase } from "../integration/setup.ts";

describe("live public GitHub API contracts", () => {
  it("persists source-validated model proposals and caches a real enrichment call", async () => {
    const apiKey = z.string().min(1).parse(process.env.OPENAI_API_KEY);
    const database = await setupIntegrationDatabase();
    try {
      const config = {
        apiKey,
        model: process.env.GIA_GITHUB_ENRICHMENT_MODEL ?? "gpt-4.1-mini",
        maximumCalls: 1,
        repositoryId: 644461337n,
      };
      const [repository] = await database.db
        .select()
        .from(repositories)
        .where(eq(repositories.id, config.repositoryId));
      if (!repository?.readmeText || !repository.readmeSha)
        throw new Error("Actual AI SDK README missing");
      const first = await enrichRepositories(database, config);
      expect(first.calls).toBe(1);
      const second = await enrichRepositories(database, config);
      expect(second.calls).toBe(0);
      expect(second.cached).toBe(1);
      const claims = await database.db
        .select()
        .from(conceptEvidence)
        .where(
          and(
            eq(conceptEvidence.repositoryId, config.repositoryId),
            eq(conceptEvidence.method, "llm"),
          ),
        );
      expect(claims).toHaveLength(first.pendingClaims);
      for (const claim of claims) {
        expect(repository.readmeText).toContain(claim.excerpt);
        expect(claim.sourceRevision).toBe(repository.readmeSha);
        expect(claim.reviewStatus).toBe("pending");
        expect(claim.supportLevel).toBe("inferred");
        expect(claim.extractorVersion).toContain(config.model);
      }
      const receipt = await database.db
        .select()
        .from(captures)
        .where(
          eq(
            captures.sourceUrl,
            `https://api.github.com/repos/vercel/ai/git/blobs/${repository.readmeSha}`,
          ),
        );
      expect(receipt).toHaveLength(1);
      expect(receipt[0]?.recordCount).toBe(first.pendingClaims);
      expect(receipt[0]?.coverage).toMatchObject({
        kind: "llm_enrichment",
        model: config.model,
        sourceRevision: repository.readmeSha,
        status: "pending_review",
      });
      const validIds = await database.pool.query<{ slug: string }>(
        "SELECT c.slug FROM github.concept_evidence e JOIN github.concepts c ON c.id=e.concept_id WHERE e.method='llm'",
      );
      expect(
        validIds.rows.every((row) =>
          conceptDefinitions.some((concept) => concept.slug === row.slug),
        ),
      ).toBe(true);
    } finally {
      await database.close();
    }
  }, 120_000);
  it("resolves a real repository rename, revalidates its ETag, and enforces the request budget", async () => {
    const token = z.string().min(1).parse(process.env.GIA_GITHUB_TOKEN);
    const client = createGitHubClient({ token, maximumRequests: 2 });
    const response = await client.get("/repos/vercel/ai-chatbot");
    if (response.kind !== "data") throw new Error("Public renamed repository unavailable");
    const repository = repositorySchema.parse(response.data);
    expect(repository.id).toBe(642917329);
    expect(repository.full_name).toBe("vercel/chatbot");
    expect(repository.visibility).toBe("public");
    expect(response.etag).toBeTruthy();
    expect((await client.get("/repos/vercel/ai-chatbot", response.etag)).kind).toBe("not_modified");
    await expect(client.get("/repos/vercel/chatbot")).rejects.toBeInstanceOf(GitHubCollectionError);
    expect(client.metrics().requests).toBe(2);
  }, 60_000);

  it("reads real public membership and a known merged PR without concealed membership endpoints", async () => {
    const token = z.string().min(1).parse(process.env.GIA_GITHUB_TOKEN);
    const client = createGitHubClient({ token, maximumRequests: 2 });
    const response = await client.get("/orgs/vercel/public_members?per_page=100&page=1");
    if (response.kind !== "data") throw new Error("Public Vercel membership unavailable");
    const members = z.array(accountSchema).parse(response.data);
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((member) => member.type === "User")).toBe(true);
    const pull = await client.get("/repos/vercel-labs/ai-python/pulls/258");
    if (pull.kind !== "data") throw new Error("Actual merged reranking PR unavailable");
    const pr = pullRequestSchema.parse(pull.data);
    expect(pr.id).toBe(4230553909);
    expect(pr.user?.id).toBe(24557773);
    expect(pr.merged_at).toBe("2026-08-14T16:31:44Z");
  }, 60_000);
});
