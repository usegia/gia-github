import type { Database } from "@gia-github/db";
import { captures, conceptEvidence, concepts, repositories } from "@gia-github/db/schema";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { sha256 } from "./capture.ts";
import {
  conceptDefinitions,
  createModelEnricher,
  EXTRACTOR_VERSION,
  evidenceId,
  type ModelEnrichment,
} from "./enrichment.ts";

/** Model calls happen before the transaction. Receipts cache successful abstentions as well as claims. */
export async function enrichRepositories(
  database: Database,
  config: ModelEnrichment & { repositoryId?: bigint },
) {
  const enrich = createModelEnricher(config);
  const candidates = await database.db
    .select()
    .from(repositories)
    .where(
      and(
        isNotNull(repositories.readmeText),
        isNotNull(repositories.readmeSha),
        config.repositoryId === undefined ? undefined : eq(repositories.id, config.repositoryId),
      ),
    )
    .orderBy(repositories.id);
  let calls = 0;
  let pendingClaims = 0;
  let cached = 0;
  let rejectedClaims = 0;
  for (const repository of candidates) {
    if (!repository.readmeText || !repository.readmeSha) continue;
    const revision = repository.readmeSha;
    const id = sha256(
      `enrichment:${repository.id}:${revision}:${EXTRACTOR_VERSION}:${config.model}`,
    );
    const [receipt] = await database.db
      .select({ id: captures.id })
      .from(captures)
      .where(eq(captures.id, id));
    if (receipt) {
      cached += 1;
      continue;
    }
    if (calls >= config.maximumCalls) break;
    const result = await enrich(repository.readmeText);
    const claims = result.claims;
    calls += 1;
    rejectedClaims += result.rejectedClaims;
    await database.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ sha: repositories.readmeSha })
        .from(repositories)
        .where(eq(repositories.id, repository.id));
      if (current?.sha !== revision) return;
      const source = {
        repositoryId: repository.id,
        pullRequestId: null,
        sourceUrl: `https://api.github.com/repos/${repository.fullName}/git/blobs/${revision}`,
        sourceRevision: revision,
        observedAt: new Date(),
      };
      await tx.insert(concepts).values(conceptDefinitions).onConflictDoNothing();
      const definitions = await tx.select().from(concepts);
      const ids = new Map(definitions.map((row) => [row.slug, row.id]));
      await tx
        .update(conceptEvidence)
        .set({ reviewStatus: "superseded" })
        .where(
          and(
            eq(conceptEvidence.repositoryId, repository.id),
            eq(conceptEvidence.sourceKind, "readme"),
            eq(conceptEvidence.method, "llm"),
            ne(conceptEvidence.sourceRevision, revision),
          ),
        );
      for (const extraction of claims) {
        const conceptId = ids.get(extraction.slug);
        if (conceptId === undefined) throw new Error("Unknown enriched concept");
        await tx
          .insert(conceptEvidence)
          .values({
            ...source,
            ...extraction,
            sourceKind: "readme",
            conceptId,
            id: evidenceId({ ...source, extraction }),
            reviewStatus: "pending",
          })
          .onConflictDoNothing();
      }
      await tx
        .insert(captures)
        .values({
          id,
          sourceUrl: source.sourceUrl,
          capturedAt: source.observedAt,
          sha256: sha256(repository.readmeText ?? ""),
          apiVersion: "openai-chat-completions",
          recordCount: claims.length,
          coverage: {
            kind: "llm_enrichment",
            model: config.model,
            extractorVersion: EXTRACTOR_VERSION,
            sourceRevision: revision,
            status: "pending_review",
            rejectedClaims: result.rejectedClaims,
          },
        })
        .onConflictDoNothing();
      pendingClaims += claims.length;
    });
  }
  return { calls, cached, pendingClaims, rejectedClaims };
}
