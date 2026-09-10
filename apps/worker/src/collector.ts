import type { Database } from "@gia-github/db";
import { repositories, syncState } from "@gia-github/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  type Account,
  accountSchema,
  type Capture,
  captureSchema,
  contentSchema,
  fileSchema,
  profileSchema,
  pullRequestSchema,
  repositorySchema,
  reviewSchema,
  sha256,
} from "./capture.ts";
import {
  GITHUB_API_VERSION,
  type GitHubClient,
  GitHubCollectionError,
  type GitHubResponse,
} from "./github.ts";
import { importCapture } from "./importer.ts";

const slug = z.string().regex(/^[A-Za-z0-9_.-]+$/);
export const seedSchema = z.object({
  version: z.literal(1),
  organizations: z.array(slug).max(30),
  repositories: z
    .array(
      z.object({
        fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        id: z.string().regex(/^\d+$/).optional(),
      }),
    )
    .min(1)
    .max(100),
  pullRequestPages: z.number().int().min(1).max(20).default(1),
  pullRequestsPerPage: z.number().int().min(1).max(100).default(30),
  windowDays: z.number().int().min(1).max(730).default(180),
  maximumProfiles: z.number().int().min(0).max(500).default(150),
  maximumReviewedPullRequests: z.number().int().min(0).max(500).default(30),
  maximumPullRequestFiles: z.number().int().min(0).max(100).default(15),
});
export type Seed = z.infer<typeof seedSchema>;

function envelope(
  response: GitHubResponse,
  payload: Capture["payload"],
  coverage?: Partial<Capture["coverage"]>,
): Capture {
  return captureSchema.parse({
    version: 1,
    sourceUrl: response.sourceUrl,
    observedAt: response.observedAt,
    apiVersion: GITHUB_API_VERSION,
    etag: response.etag,
    coverage: {
      status: response.nextUrl ? "partial" : "complete",
      page: 1,
      nextCursor: response.nextUrl,
      windowStart: null,
      windowEnd: null,
      ...coverage,
    },
    payload,
  });
}

export async function collectGitHub(database: Database, client: GitHubClient, input: unknown) {
  const seed = seedSchema.parse(input);
  const people = new Map<number, Account>();
  const organizations = new Map<string, Account>();
  const reviewCandidates: Array<{
    repositoryId: number;
    repository: string;
    pr: z.infer<typeof pullRequestSchema>;
  }> = [];
  const windowEnd = new Date().toISOString();
  const windowStart = new Date(Date.now() - seed.windowDays * 86_400_000).toISOString();
  let importedCaptures = 0;
  const remember = (account: Account | null) => {
    if (account?.type === "User") people.set(account.id, account);
  };
  const commit = async (capture: Capture) => {
    await importCapture(database, capture);
    importedCaptures += 1;
  };
  async function conditional(path: string, scope: string, resource: string) {
    const [state] = await database.db
      .select()
      .from(syncState)
      .where(and(eq(syncState.scope, scope), eq(syncState.resource, resource)));
    const result = await client.get(path, state?.status === "complete" ? state.etag : null);
    if (result.kind === "not_modified" && state) {
      await database.db
        .update(syncState)
        .set({
          lastAttemptAt: new Date(result.observedAt),
          lastSuccessAt: new Date(result.observedAt),
          lastErrorCode: null,
        })
        .where(eq(syncState.id, state.id));
    }
    return result;
  }
  let activeSource: { scope: string; resource: string } | null = null;
  try {
    // Metadata first so a bounded run cannot leave later repositories undiscovered.
    for (const configured of seed.repositories) {
      const sourceUrl = `https://api.github.com/repos/${configured.fullName}`;
      activeSource = { scope: "repositories", resource: sourceUrl };
      const response = await conditional(sourceUrl, activeSource.scope, activeSource.resource);
      if (response.kind === "data") {
        // A privileged token must never turn private repository access into a public capture.
        const repository = repositorySchema
          .extend({ private: z.literal(false) })
          .parse(response.data);
        organizations.set(repository.owner.login.toLowerCase(), repository.owner);
        await commit(envelope(response, { kind: "repositories", records: [repository] }));
      }
    }
    for (const organization of seed.organizations) {
      let owner = organizations.get(organization.toLowerCase());
      if (!owner) {
        const response = await client.get(`/orgs/${organization}`);
        if (response.kind !== "data") continue;
        owner = accountSchema.parse(response.data);
      }
      activeSource = { scope: `organization:${owner.id}`, resource: "public_members" };
      const members: Account[] = [];
      let next: string | null = `/orgs/${organization}/public_members?per_page=100&page=1`;
      let page = 0;
      let first: GitHubResponse | null = null;
      let last: GitHubResponse | null = null;
      while (next && page < 10) {
        const response = await client.get(next);
        if (response.kind !== "data") break;
        first ??= response;
        last = response;
        const records = z.array(accountSchema).parse(response.data);
        members.push(...records);
        for (const member of records) remember(member);
        next = response.nextUrl;
        page += 1;
        // Persist progress without retiring anyone until the whole traversal succeeds.
        await commit(
          envelope(
            response,
            { kind: "memberships", organization: owner, records },
            { status: "partial", page, nextCursor: next },
          ),
        );
      }
      if (first && last && next === null)
        await commit(
          envelope(
            { ...first, observedAt: last.observedAt, etag: page === 1 ? first.etag : null },
            { kind: "memberships", organization: owner, records: members },
            { status: "complete", page, nextCursor: null },
          ),
        );
    }
    for (const configured of seed.repositories) {
      const [repository] = configured.id
        ? await database.db
            .select()
            .from(repositories)
            .where(eq(repositories.id, BigInt(configured.id)))
        : await database.db
            .select()
            .from(repositories)
            .where(eq(repositories.fullName, configured.fullName));
      if (!repository) continue;
      const repositoryId = Number(repository.id);
      if (!Number.isSafeInteger(repositoryId))
        throw new Error("GitHub ID cannot be represented safely by this client");
      const repositoryScope = { repositoryId, repository: repository.fullName };
      for (const resource of ["languages", "readme", "manifest"] satisfies Array<
        "languages" | "readme" | "manifest"
      >) {
        const suffix = resource === "manifest" ? "contents/package.json" : resource;
        activeSource = {
          scope: `repository:${repository.id}`,
          resource: resource === "manifest" ? "manifest:package.json" : resource,
        };
        const response = await conditional(
          `/repos/${repository.fullName}/${suffix}`,
          activeSource.scope,
          activeSource.resource,
        );
        if (response.kind !== "data") continue;
        if (resource === "languages") {
          await commit(
            envelope(response, {
              kind: "languages",
              ...repositoryScope,
              records: z.record(z.string(), z.number().int().nonnegative()).parse(response.data),
            }),
          );
        } else {
          await commit(
            envelope(response, {
              kind: resource,
              ...repositoryScope,
              content: contentSchema.parse(response.data),
            }),
          );
        }
      }
      activeSource = { scope: `repository:${repository.id}`, resource: "pull_requests" };
      const [previous] = await database.db
        .select()
        .from(syncState)
        .where(
          and(
            eq(syncState.scope, activeSource.scope),
            eq(syncState.resource, activeSource.resource),
          ),
        );
      const resuming =
        previous?.status !== "complete" &&
        previous?.cursor != null &&
        previous.windowStart !== null;
      let next: string | null = resuming
        ? previous.cursor
        : `/repos/${repository.fullName}/pulls?state=all&sort=updated&direction=desc&per_page=${seed.pullRequestsPerPage}&page=1`;
      const start =
        resuming && previous.windowStart ? previous.windowStart.toISOString() : windowStart;
      const end = resuming && previous.windowEnd ? previous.windowEnd.toISOString() : windowEnd;
      let page = resuming ? previous.pagesFetched : 0;
      for (let fetched = 0; next && fetched < seed.pullRequestPages; fetched += 1) {
        const response = await client.get(next);
        if (response.kind !== "data") break;
        const records = z.array(pullRequestSchema).parse(response.data);
        for (const pr of records) {
          remember(pr.user);
          if (pr.merged_at && pr.merged_at >= start)
            reviewCandidates.push({ ...repositoryScope, pr });
        }
        const reachedWindow = records.some((pr) => pr.updated_at < start);
        next = reachedWindow ? null : response.nextUrl;
        page += 1;
        await commit(
          envelope(
            response,
            { kind: "pull_requests", ...repositoryScope, records },
            {
              status: next ? "partial" : "complete",
              page,
              nextCursor: next,
              windowStart: start,
              windowEnd: end,
            },
          ),
        );
      }
    }
    // Spread the bounded review budget over repositories rather than spending it all on the first.
    const seenRepositories = new Map<number, number>();
    const ranked = reviewCandidates
      .map((candidate) => {
        const position = seenRepositories.get(candidate.repositoryId) ?? 0;
        seenRepositories.set(candidate.repositoryId, position + 1);
        return { candidate, position };
      })
      .sort((left, right) => left.position - right.position)
      .map((row) => row.candidate);
    for (const candidate of ranked.slice(0, seed.maximumReviewedPullRequests)) {
      activeSource = { scope: `pull_request:${candidate.pr.id}`, resource: "reviews" };
      const response = await conditional(
        `/repos/${candidate.repository}/pulls/${candidate.pr.number}/reviews?per_page=100&page=1`,
        activeSource.scope,
        activeSource.resource,
      );
      if (response.kind !== "data") continue;
      const reviews = z.array(reviewSchema).parse(response.data);
      for (const review of reviews) remember(review.user);
      await commit(
        envelope(response, {
          kind: "reviews",
          repositoryId: candidate.repositoryId,
          repository: candidate.repository,
          pullRequestId: candidate.pr.id,
          records: reviews,
        }),
      );
    }
    for (const candidate of ranked
      .filter(({ pr }) => /retriev|rerank|embed|rag\b|tools?|search|mcp/i.test(pr.title))
      .slice(0, seed.maximumPullRequestFiles)) {
      activeSource = { scope: `pull_request:${candidate.pr.id}`, resource: "pull_request_files" };
      const response = await conditional(
        `/repos/${candidate.repository}/pulls/${candidate.pr.number}/files?per_page=100&page=1`,
        activeSource.scope,
        activeSource.resource,
      );
      if (response.kind !== "data") continue;
      await commit(
        envelope(response, {
          kind: "pull_request_files",
          repositoryId: candidate.repositoryId,
          repository: candidate.repository,
          pullRequestId: candidate.pr.id,
          headSha: candidate.pr.head.sha,
          records: z.array(fileSchema).parse(response.data),
        }),
      );
    }
    const candidates = [...people.values()].slice(0, seed.maximumProfiles);
    for (const person of candidates) {
      const sourceUrl = `https://api.github.com/users/${person.login}`;
      activeSource = { scope: "profiles", resource: sourceUrl };
      const response = await conditional(sourceUrl, activeSource.scope, activeSource.resource);
      if (response.kind !== "data") continue;
      await commit(
        envelope(response, { kind: "profiles", records: [profileSchema.parse(response.data)] }),
      );
    }
    return { status: "complete" as const, captures: importedCaptures, ...client.metrics() };
  } catch (error: unknown) {
    if (activeSource) {
      const code = error instanceof GitHubCollectionError ? error.code : "collection_failed";
      const row = {
        id: sha256(`${activeSource.scope}:${activeSource.resource}`),
        ...activeSource,
        status: "failed" as const,
        lastAttemptAt: new Date(),
        lastErrorCode: code,
      };
      await database.db
        .insert(syncState)
        .values(row)
        .onConflictDoUpdate({
          target: syncState.id,
          set: { status: "failed", lastAttemptAt: row.lastAttemptAt, lastErrorCode: code },
        });
    }
    if (error instanceof GitHubCollectionError && error.code === "request_budget")
      return {
        status: "budget_exhausted" as const,
        captures: importedCaptures,
        ...client.metrics(),
      };
    throw error;
  }
}
