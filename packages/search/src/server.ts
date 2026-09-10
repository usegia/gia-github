import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPostgresQueryExecutor,
  createPostgresQueryOperation,
  type LocalProjectAuthorityDocuments,
  type PostgresQueryOperation,
  type PostgresQuerySuccess,
  runtimeClientFor,
} from "@gia/client";
import pg from "pg";
import { z } from "zod";
import { admitSearch, finishSearch } from "./admission.ts";
import {
  githubIdSchema,
  type SearchOutcome,
  type SearchService,
  type SearchServiceConfig,
  searchInputSchema,
} from "./contracts.ts";
import { findPerson, hydratePeople, readCatalog, readCoverage } from "./database.ts";
import { createExecutorPool } from "./executor.ts";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const authoritySchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().min(1),
    worldId: z.string().min(1),
    lockProjectId: z.string().min(1),
    candidateSnapshotId: sha,
    schemaProducerDialectId: z.literal("postgres"),
    schemaObservedDialectId: z.literal("postgres"),
    postgresStoreVersion: z.string().regex(/^\d+$/),
    accountsEntityId: z.string().min(1),
    compilerBindingBase64: z.string().min(1),
  })
  .strict();
const credentialsSchema = z.object({
  projectId: z.string().min(1),
  apiKey: z.string().min(1),
  runtimeBaseUrl: z.url(),
});
const limitsSchema = z.object({
  maximumConcurrentSearches: z.number().int().min(1).max(20),
  maximumDailySearches: z.number().int().min(1).max(10_000),
  maximumSearchesPerMinute: z.number().int().min(1).max(60),
  timeoutMs: z.number().int().min(1000).max(180_000),
});
class ConfigurationUnavailable extends Error {}
const failure = (
  requestId: string,
  code: string,
  message: string,
  retryable = false,
): SearchOutcome => ({ kind: "failed", requestId, code, message, retryable });

export function createSearchService(config: SearchServiceConfig): SearchService {
  const limits = limitsSchema.parse({
    maximumConcurrentSearches: config.maximumConcurrentSearches ?? 3,
    maximumDailySearches: config.maximumDailySearches ?? 100,
    maximumSearchesPerMinute: config.maximumSearchesPerMinute ?? 6,
    timeoutMs: config.timeoutMs ?? 180_000,
  });
  const operationsPool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });
  const readPool = new pg.Pool({
    connectionString: config.readOnlyDatabaseUrl,
    max: limits.maximumConcurrentSearches + 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: limits.timeoutMs,
  });
  const cancellationPool = new pg.Pool({
    connectionString: config.readOnlyDatabaseUrl,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  const executorPool = createExecutorPool(readPool, cancellationPool);
  const lifetime = new AbortController();
  const active = new Set<Promise<SearchOutcome>>();
  let configured:
    | Promise<{ operation: PostgresQueryOperation; accountsEntityId: string }>
    | undefined;
  let closePromise: Promise<void> | undefined;

  async function operation() {
    configured ??= (async () => {
      try {
        const document = authoritySchema.parse(
          JSON.parse(
            await readFile(path.join(config.projectDirectory, "gia/client-authority.json"), "utf8"),
          ),
        );
        const { version: _version, accountsEntityId, compilerBindingBase64, ...facts } = document;
        const compilerBindingBytes = Buffer.from(compilerBindingBase64, "base64");
        if (compilerBindingBytes.toString("base64") !== compilerBindingBase64)
          throw new ConfigurationUnavailable();
        const authority: LocalProjectAuthorityDocuments = { ...facts, compilerBindingBytes };
        let apiKey = config.runtimeApiKey;
        if (!apiKey) {
          const credentials = credentialsSchema.parse(
            JSON.parse(
              await readFile(path.join(config.projectDirectory, ".gia/credentials.json"), "utf8"),
            ),
          );
          if (
            credentials.projectId !== authority.projectId ||
            new URL(credentials.runtimeBaseUrl).origin !== new URL(config.runtimeUrl).origin
          )
            throw new ConfigurationUnavailable();
          apiKey = credentials.apiKey;
        }
        if (!apiKey || !config.profileId) throw new ConfigurationUnavailable();
        return {
          accountsEntityId,
          operation: createPostgresQueryOperation({
            runtime: runtimeClientFor(
              { baseUrl: config.runtimeUrl, timeoutMs: limits.timeoutMs },
              apiKey,
            ),
            localAuthority: async () => authority,
            authenticatedProjectId: authority.projectId,
            createExecutor: (targetSha) =>
              createPostgresQueryExecutor({ pool: executorPool, targetSha }),
          }),
        };
      } catch {
        throw new ConfigurationUnavailable();
      }
    })();
    try {
      return await configured;
    } catch (error) {
      configured = undefined;
      throw error;
    }
  }

  async function performSearch(
    input: Parameters<SearchService["search"]>[0],
  ): Promise<SearchOutcome> {
    const requestId = randomUUID();
    const parsed = searchInputSchema.safeParse({ question: input.question, limit: input.limit });
    if (!parsed.success || !input.clientKey || input.clientKey.length > 256)
      return failure(
        requestId,
        "INVALID_SEARCH",
        "Enter a question between 3 and 2,000 characters and choose up to 50 people.",
      );
    const signal = AbortSignal.any([
      input.signal,
      lifetime.signal,
      AbortSignal.timeout(limits.timeoutMs),
    ]);
    if (signal.aborted) return failure(requestId, "CANCELLED", "The search was cancelled.");
    let configuredOperation: Awaited<ReturnType<typeof operation>>;
    try {
      configuredOperation = await operation();
    } catch {
      return failure(
        requestId,
        "CONFIGURATION_REQUIRED",
        "Search needs a published Gia World and configured serving profile.",
      );
    }
    const started = performance.now();
    let admitted = false;
    let outcome: SearchOutcome = failure(
      requestId,
      "SEARCH_FAILED",
      "The search could not complete. Try a narrower question.",
    );
    try {
      const admission = await admitSearch(operationsPool, {
        ...limits,
        id: requestId,
        clientKey: input.clientKey,
      });
      if (admission.kind === "rejected") {
        const message =
          admission.code === "DAILY_LIMIT_REACHED"
            ? "Today's shared search allowance has been reached."
            : admission.code === "RATE_LIMITED"
              ? "Please wait a minute before searching again."
              : "All search slots are busy. Please try again shortly.";
        return failure(
          requestId,
          admission.code,
          message,
          admission.code !== "DAILY_LIMIT_REACHED",
        );
      }
      admitted = true;
      const result = await configuredOperation.operation.execute({
        profileId: config.profileId,
        question: `Find distinct individual human GitHub accounts with account_type User. Exclude organization and bot accounts. Apply this search request: ${JSON.stringify(parsed.data.question)}`,
        answer: { kind: "identity", entity: configuredOperation.accountsEntityId },
        outcomeMode: "interpretation",
        limits: {
          maximumRows: parsed.data.limit,
          maximumResultBytes: 262_144,
          timeoutMs: limits.timeoutMs,
        },
        debug: "off",
        sqlReuse: "off",
        signal,
      });
      if (!result.ok) {
        outcome = failure(
          result.diagnostic.requestId ?? requestId,
          result.diagnostic.issue.code,
          "Gia could not complete this search. Its filters were not weakened.",
          result.diagnostic.retrySafety === "safe-before-issuance",
        );
      } else if ("kind" in result.value && result.value.kind === "unsupported") {
        outcome = {
          kind: "unsupported",
          requestId: result.value.requestId,
          explanation: result.value.explanation,
        };
      } else {
        const value = result.value;
        const success = "kind" in value ? value.result : value;
        const identities = resultIdentities(success);
        const [people, coverage] = await Promise.all([
          hydratePeople(readPool, identities),
          readCoverage(operationsPool),
        ]);
        outcome = {
          kind: "matches",
          requestId: success.requestId,
          people,
          coverage,
          truncated: success.truncated,
          durationMs: performance.now() - started,
          interpretation:
            "kind" in value
              ? {
                  kind: "assumed",
                  summary: value.interpretation.assumption,
                  assumptions: [value.interpretation.assumption],
                }
              : { kind: "direct" },
        };
      }
    } catch {
      outcome = signal.aborted
        ? failure(requestId, "CANCELLED", "The search was cancelled or reached its time limit.")
        : failure(
            requestId,
            "SEARCH_FAILED",
            "Search could not verify and load the result. No partial matches were returned.",
          );
    } finally {
      if (admitted)
        await finishSearch(operationsPool, {
          id: requestId,
          outcome: outcome.kind,
          runtimeRequestId: outcome.requestId === requestId ? null : outcome.requestId,
          durationMs: performance.now() - started,
        }).catch(() => undefined);
    }
    return outcome;
  }

  return {
    search(input) {
      if (lifetime.signal.aborted)
        return Promise.resolve(
          failure(randomUUID(), "SERVICE_CLOSED", "Search is temporarily unavailable."),
        );
      const pending = performSearch(input);
      active.add(pending);
      void pending.then(
        () => active.delete(pending),
        () => active.delete(pending),
      );
      return pending;
    },
    catalog: () => readCatalog(operationsPool),
    person: (login) => findPerson(readPool, login),
    close() {
      closePromise ??= (async () => {
        lifetime.abort();
        await Promise.allSettled([...active]);
        await Promise.all([operationsPool.end(), readPool.end(), cancellationPool.end()]);
      })();
      return closePromise;
    },
  };
}

function resultIdentities(result: PostgresQuerySuccess): string[] {
  if (result.columns.length !== 1) throw new Error("Person identity must have one result column");
  const identities = result.tuples.map((tuple) => {
    const cell = tuple[0];
    if (tuple.length !== 1 || cell === null || cell === undefined || cell.kind !== "int64")
      throw new Error("Person identity must be a nonnull int64");
    return githubIdSchema.parse(cell.value);
  });
  return [...new Set(identities)];
}
