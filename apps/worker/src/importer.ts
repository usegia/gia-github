import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database, DatabaseTransaction } from "@gia-github/db";
import {
  accounts,
  captures,
  conceptEvidence,
  concepts,
  publicMemberships,
  pullRequestReviews,
  pullRequests,
  repositories,
  repositoryLanguages,
  syncState,
} from "@gia-github/db/schema";
import { and, eq, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import {
  type Account,
  type Capture,
  captureSchema,
  captureScope,
  fixtureManifestSchema,
  type Profile,
  recordCount,
  sha256,
} from "./capture.ts";
import {
  conceptDefinitions,
  type Extraction,
  evidenceId,
  extractManifest,
  extractText,
} from "./enrichment.ts";

async function upsertAccount(
  tx: DatabaseTransaction,
  account: Account,
  date: Date,
  profile?: Profile,
) {
  const identity = {
    id: BigInt(account.id),
    nodeId: account.node_id,
    login: account.login,
    accountType: account.type,
    profileUrl: account.html_url,
    observedAt: date,
  };
  const details = profile
    ? {
        name: profile.name,
        bio: profile.bio,
        companyRaw: profile.company,
        locationRaw: profile.location,
        followersCount: profile.followers,
        publicReposCount: profile.public_repos,
        profileFetchedAt: date,
        searchText: [profile.login, profile.name, profile.bio, profile.company, profile.location]
          .filter(Boolean)
          .join("\n"),
      }
    : {};
  await tx
    .insert(accounts)
    .values({
      ...identity,
      ...details,
      avatarUrl: account.avatar_url ?? `${account.html_url}.png`,
      ...(!profile ? { searchText: account.login } : {}),
    })
    .onConflictDoUpdate({
      target: accounts.id,
      set: {
        ...identity,
        ...(account.avatar_url ? { avatarUrl: account.avatar_url } : {}),
      },
      setWhere: lte(accounts.observedAt, date),
    });
  if (profile) {
    await tx
      .update(accounts)
      .set({
        ...details,
        searchText: sql`concat_ws(E'\n', ${accounts.login}, ${profile.name}::text, ${profile.bio}::text, ${profile.company}::text, ${profile.location}::text)`,
        locationCity: sql`case when ${accounts.locationRaw} is distinct from ${profile.location}::text then null else ${accounts.locationCity} end`,
        locationCountry: sql`case when ${accounts.locationRaw} is distinct from ${profile.location}::text then null else ${accounts.locationCountry} end`,
        locationNormalization: sql`case when ${accounts.locationRaw} is distinct from ${profile.location}::text then null else ${accounts.locationNormalization} end`,
      })
      .where(
        and(
          eq(accounts.id, BigInt(account.id)),
        or(isNull(accounts.profileFetchedAt), lte(accounts.profileFetchedAt, date)),
        ),
      );
  }
}

type EvidenceSource = {
  repositoryId: bigint;
  pullRequestId: bigint | null;
  sourceKind: "topic" | "manifest" | "readme" | "pull_request";
  sourceUrl: string;
  sourceRevision: string;
  observedAt: Date;
};
export async function replaceSourceEvidence(
  tx: DatabaseTransaction,
  source: EvidenceSource,
  extractions: Extraction[],
) {
  const scope = and(
    eq(conceptEvidence.repositoryId, source.repositoryId),
    source.pullRequestId === null
      ? isNull(conceptEvidence.pullRequestId)
      : eq(conceptEvidence.pullRequestId, source.pullRequestId),
    eq(conceptEvidence.sourceKind, source.sourceKind),
    eq(conceptEvidence.sourceUrl, source.sourceUrl),
    eq(conceptEvidence.method, "deterministic"),
  );
  const [latest] = await tx
    .select({ date: sql<Date | null>`max(${conceptEvidence.observedAt})` })
    .from(conceptEvidence)
    .where(scope);
  if (latest?.date && new Date(latest.date) > source.observedAt) return;
  await tx
    .update(conceptEvidence)
    .set({ reviewStatus: "superseded" })
    .where(and(scope, lte(conceptEvidence.observedAt, source.observedAt)));
  if (extractions.length === 0) return;
  await tx.insert(concepts).values(conceptDefinitions).onConflictDoNothing();
  const definitions = await tx.select({ id: concepts.id, slug: concepts.slug }).from(concepts);
  const conceptIds = new Map(definitions.map((row) => [row.slug, row.id]));
  const rows = extractions.map((extraction): typeof conceptEvidence.$inferInsert => {
    const conceptId = conceptIds.get(extraction.slug);
    if (conceptId === undefined) throw new Error(`Unknown concept: ${extraction.slug}`);
    return {
      ...source,
      ...extraction,
      conceptId,
      id: evidenceId({ ...source, extraction }),
      reviewStatus: "accepted",
    };
  });
  for (const row of rows) {
    await tx
      .insert(conceptEvidence)
      .values(row)
      .onConflictDoUpdate({
        target: conceptEvidence.id,
        set: { observedAt: source.observedAt, reviewStatus: "accepted" },
        setWhere: lte(conceptEvidence.observedAt, source.observedAt),
      });
  }
}

async function importFacts(tx: DatabaseTransaction, capture: Capture): Promise<void> {
  const payload = capture.payload;
  const date = new Date(capture.observedAt);
  switch (payload.kind) {
    case "repositories":
      for (const repo of payload.records) {
        await upsertAccount(tx, repo.owner, date);
        const row = {
          id: BigInt(repo.id),
          nodeId: repo.node_id,
          ownerId: BigInt(repo.owner.id),
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          topics: repo.topics,
          defaultBranch: repo.default_branch,
          starsCount: repo.stargazers_count,
          isFork: repo.fork,
          isArchived: repo.archived,
          repositoryUrl: repo.html_url,
          pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
          observedAt: date,
          searchText: [repo.full_name, repo.description, ...repo.topics].filter(Boolean).join("\n"),
        };
        await tx
          .insert(repositories)
          .values(row)
          .onConflictDoUpdate({
            target: repositories.id,
            set: {
              ...row,
              searchText: sql`concat_ws(E'\n', ${row.searchText}::text, ${repositories.readmeText})`,
            },
            setWhere: lte(repositories.observedAt, date),
          });
        const text = repo.topics.join("\n");
        await replaceSourceEvidence(
          tx,
          {
            repositoryId: BigInt(repo.id),
            pullRequestId: null,
            sourceKind: "topic",
            sourceUrl: repo.html_url,
            sourceRevision: sha256(text),
            observedAt: date,
          },
          extractText(text),
        );
      }
      return;
    case "profiles":
      for (const profile of payload.records) await upsertAccount(tx, profile, date, profile);
      return;
    case "memberships": {
      await upsertAccount(tx, payload.organization, date);
      const organizationId = BigInt(payload.organization.id);
      for (const member of payload.records) {
        await upsertAccount(tx, member, date);
        await tx
          .insert(publicMemberships)
          .values({
            personId: BigInt(member.id),
            organizationId,
            firstSeenAt: date,
            lastSeenAt: date,
            lastCheckedAt: date,
            currentlyPublic: true,
            sourceUrl: capture.sourceUrl,
          })
          .onConflictDoUpdate({
            target: [publicMemberships.personId, publicMemberships.organizationId],
            set: {
              lastSeenAt: date,
              lastCheckedAt: date,
              currentlyPublic: true,
              sourceUrl: capture.sourceUrl,
            },
            setWhere: lte(publicMemberships.lastCheckedAt, date),
          });
      }
      // A complete single capture contains the entire membership traversal. Individual pages are partial.
      if (capture.coverage.status === "complete") {
        const ids = payload.records.map((member) => BigInt(member.id));
        await tx
          .update(publicMemberships)
          .set({ currentlyPublic: false, lastCheckedAt: date })
          .where(
            and(
              eq(publicMemberships.organizationId, organizationId),
              lte(publicMemberships.lastCheckedAt, date),
              ids.length > 0 ? notInArray(publicMemberships.personId, ids) : undefined,
            ),
          );
      }
      return;
    }
    case "pull_requests":
      for (const pr of payload.records) {
        if (pr.user) await upsertAccount(tx, pr.user, date);
        const row = {
          id: BigInt(pr.id),
          nodeId: pr.node_id,
          repositoryId: BigInt(payload.repositoryId),
          authorId: pr.user ? BigInt(pr.user.id) : null,
          number: pr.number,
          title: pr.title,
          bodyText: pr.body,
          state: pr.state,
          createdAt: new Date(pr.created_at),
          updatedAt: new Date(pr.updated_at),
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          pullRequestUrl: pr.html_url,
          headSha: pr.head.sha,
          searchText: [pr.title, pr.body].filter(Boolean).join("\n"),
          observedAt: date,
        };
        await tx
          .insert(pullRequests)
          .values(row)
          .onConflictDoUpdate({
            target: pullRequests.id,
            set: row,
            setWhere: lte(pullRequests.observedAt, date),
          });
        await tx
          .update(conceptEvidence)
          .set({ reviewStatus: "superseded" })
          .where(
            and(
              eq(conceptEvidence.pullRequestId, BigInt(pr.id)),
              lte(conceptEvidence.observedAt, date),
              sql`${conceptEvidence.sourceRevision} not like ${`${pr.head.sha}%`}`,
            ),
          );
        await replaceSourceEvidence(
          tx,
          {
            repositoryId: BigInt(payload.repositoryId),
            pullRequestId: BigInt(pr.id),
            sourceKind: "pull_request",
            sourceUrl: pr.html_url,
            sourceRevision: `${pr.head.sha}:${sha256(row.searchText)}`,
            observedAt: date,
          },
          extractText(row.searchText),
        );
      }
      return;
    case "reviews":
      for (const review of payload.records) {
        if (review.user) await upsertAccount(tx, review.user, date);
        const row = {
          id: BigInt(review.id),
          pullRequestId: BigInt(payload.pullRequestId),
          reviewerId: review.user ? BigInt(review.user.id) : null,
          state: review.state,
          bodyText: review.body,
          submittedAt: review.submitted_at ? new Date(review.submitted_at) : null,
          reviewUrl: review.html_url,
          commitSha: review.commit_id,
          observedAt: date,
        };
        await tx
          .insert(pullRequestReviews)
          .values(row)
          .onConflictDoUpdate({
            target: pullRequestReviews.id,
            set: row,
            setWhere: lte(pullRequestReviews.observedAt, date),
          });
      }
      return;
    case "languages": {
      const repositoryId = BigInt(payload.repositoryId);
      if (capture.coverage.status !== "complete")
        throw new Error("Language measurements require a complete response");
      const [latest] = await tx
        .select({ date: sql<Date | null>`max(${repositoryLanguages.observedAt})` })
        .from(repositoryLanguages)
        .where(eq(repositoryLanguages.repositoryId, repositoryId));
      if (latest?.date && new Date(latest.date) > date) return;
      await tx
        .delete(repositoryLanguages)
        .where(eq(repositoryLanguages.repositoryId, repositoryId));
      const rows = Object.entries(payload.records).map(([language, bytes]) => ({
        repositoryId,
        language,
        bytes: BigInt(bytes),
        observedAt: date,
      }));
      if (rows.length > 0) await tx.insert(repositoryLanguages).values(rows);
      return;
    }
    case "readme":
    case "manifest": {
      const text = Buffer.from(payload.content.content, "base64").toString("utf8");
      if (payload.kind === "readme") {
        // Source freshness is independent from metadata freshness.
        const { scope, resource } = captureScope(capture);
        const [state] = await tx
          .select()
          .from(syncState)
          .where(and(eq(syncState.scope, scope), eq(syncState.resource, resource)));
        if (state?.lastSuccessAt && state.lastSuccessAt > date) return;
        await tx
          .update(repositories)
          .set({
            readmeText: text,
            readmeSha: payload.content.sha,
            searchText: sql`concat_ws(E'\n', ${repositories.fullName}, ${repositories.description}, array_to_string(${repositories.topics}, ' '), ${text}::text)`,
          })
          .where(eq(repositories.id, BigInt(payload.repositoryId)));
      }
      await replaceSourceEvidence(
        tx,
        {
          repositoryId: BigInt(payload.repositoryId),
          pullRequestId: null,
          sourceKind: payload.kind,
          sourceUrl: payload.content.html_url,
          sourceRevision: payload.content.sha,
          observedAt: date,
        },
        payload.kind === "manifest" ? extractManifest(text) : extractText(text),
      );
      return;
    }
    case "pull_request_files": {
      const [current] = await tx
        .select({ headSha: pullRequests.headSha })
        .from(pullRequests)
        .where(eq(pullRequests.id, BigInt(payload.pullRequestId)));
      if (!current || current.headSha !== payload.headSha) return;
      for (const file of payload.records) {
        if (!file.patch) continue;
        await replaceSourceEvidence(
          tx,
          {
            repositoryId: BigInt(payload.repositoryId),
            pullRequestId: BigInt(payload.pullRequestId),
            sourceKind: "pull_request",
            sourceUrl: file.blob_url,
            sourceRevision: payload.headSha,
            observedAt: date,
          },
          [
            ...new Map(
              file.patch
                .split("\n")
                .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
                .flatMap(extractText)
                .map((extraction) => [extraction.slug, extraction]),
            ).values(),
          ],
        );
      }
      return;
    }
  }
}

export async function importCapture(
  database: Database,
  input: unknown,
): Promise<{ id: string; records: number }> {
  const capture = captureSchema.parse(input);
  const digest = sha256(JSON.stringify(capture));
  const date = new Date(capture.observedAt);
  const { scope, resource } = captureScope(capture);
  const records = recordCount(capture);
  await database.db.transaction(async (tx) => {
    // Serialize writers for this source while allowing unrelated repositories to proceed independently.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${resource}`}, 0))`,
    );
    await importFacts(tx, capture);
    await tx
      .insert(captures)
      .values({
        id: digest,
        sourceUrl: capture.sourceUrl,
        capturedAt: date,
        sha256: digest,
        apiVersion: capture.apiVersion,
        recordCount: records,
        coverage: capture.coverage,
      })
      .onConflictDoNothing();
    const checkpoint = {
      id: sha256(`${scope}:${resource}`),
      scope,
      resource,
      cursor: capture.coverage.nextCursor,
      etag: capture.etag,
      windowStart: capture.coverage.windowStart ? new Date(capture.coverage.windowStart) : null,
      windowEnd: capture.coverage.windowEnd ? new Date(capture.coverage.windowEnd) : null,
      status: capture.coverage.status,
      pagesFetched: capture.coverage.page,
      recordsFetched: records,
      lastAttemptAt: date,
      lastSuccessAt: date,
      lastErrorCode: null,
    };
    await tx
      .insert(syncState)
      .values(checkpoint)
      .onConflictDoUpdate({
        target: syncState.id,
        set: checkpoint,
        setWhere: lte(syncState.lastAttemptAt, date),
      });
  });
  return { id: digest, records };
}

export async function loadCaptureDirectory(directory: string): Promise<Capture[]> {
  const manifest = fixtureManifestSchema.parse(
    JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
  );
  const result: Capture[] = [];
  for (const file of manifest.files) {
    const bytes = await readFile(join(directory, file.path), "utf8");
    if (sha256(bytes) !== file.sha256) throw new Error(`Capture digest mismatch: ${file.path}`);
    result.push(captureSchema.parse(JSON.parse(bytes)));
  }
  if (result.length === 0) throw new Error("Capture directory contains no observations");
  return result;
}

export async function importCaptureDirectory(database: Database, directory: string) {
  const captureList = await loadCaptureDirectory(directory);
  let records = 0;
  for (const capture of captureList) records += (await importCapture(database, capture)).records;
  return { captures: captureList.length, records };
}
