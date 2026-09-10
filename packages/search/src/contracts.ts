import { z } from "zod";

export const githubIdSchema = z.string().regex(/^[1-9]\d*$/);
export const searchInputSchema = z
  .object({
    question: z.string().trim().min(3).max(2_000),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type SearchInput = z.infer<typeof searchInputSchema>;

export const sourceContextSchema = z.object({
  kind: z.enum(["repository", "pull_request", "review", "concept", "membership"]),
  title: z.string(),
  url: z.url(),
  repository: z.string().nullable(),
  excerpt: z.string().nullable(),
  observedAt: z.iso.datetime(),
  occurredAt: z.iso.datetime().nullable(),
  sourceRevision: z.string().nullable(),
});
export type SourceContext = z.infer<typeof sourceContextSchema>;

export const personSchema = z.object({
  id: githubIdSchema,
  login: z.string(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  avatarUrl: z.url(),
  profileUrl: z.url(),
  location: z.string().nullable(),
  company: z.string().nullable(),
  followers: z.number().int().nonnegative().nullable(),
  organizations: z.array(z.string()),
  repositories: z.array(z.string()),
  concepts: z.array(z.string()),
  observedAt: z.iso.datetime(),
  context: z.array(sourceContextSchema),
});
export type Person = z.infer<typeof personSchema>;

export const coverageSchema = z.object({
  people: z.number().int().nonnegative(),
  repositories: z.number().int().nonnegative(),
  pullRequests: z.number().int().nonnegative(),
  reviews: z.number().int().nonnegative(),
  observedAt: z.iso.datetime().nullable(),
  completeSources: z.number().int().nonnegative(),
  partialSources: z.number().int().nonnegative(),
  notice: z.string(),
});
export type Coverage = z.infer<typeof coverageSchema>;

export const interpretationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct") }),
  z.object({ kind: z.literal("assumed"), summary: z.string(), assumptions: z.array(z.string()) }),
]);

export const searchOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("matches"),
    requestId: z.string(),
    people: z.array(personSchema),
    interpretation: interpretationSchema,
    coverage: coverageSchema,
    truncated: z.boolean(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({ kind: z.literal("unsupported"), requestId: z.string(), explanation: z.string() }),
  z.object({
    kind: z.literal("failed"),
    requestId: z.string(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type SearchOutcome = z.infer<typeof searchOutcomeSchema>;

export const catalogSchema = z.object({
  coverage: coverageSchema,
  examples: z.array(z.object({ label: z.string(), question: z.string() })),
  concepts: z.array(z.object({ slug: z.string(), label: z.string() })),
});
export type Catalog = z.infer<typeof catalogSchema>;

export type SearchServiceConfig = {
  databaseUrl: string;
  readOnlyDatabaseUrl: string;
  projectDirectory: string;
  runtimeUrl: string;
  runtimeApiKey: string;
  profileId: string;
  maximumConcurrentSearches?: number;
  maximumDailySearches?: number;
  maximumSearchesPerMinute?: number;
  timeoutMs?: number;
};

export type SearchService = {
  search(input: SearchInput & { clientKey: string; signal: AbortSignal }): Promise<SearchOutcome>;
  catalog(): Promise<Catalog>;
  person(login: string): Promise<Person | null>;
  close(): Promise<void>;
};
