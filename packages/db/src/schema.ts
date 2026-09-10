import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const github = pgSchema("github");
export const ingest = pgSchema("ingest");
export const operations = pgSchema("operations");
const observedAt = () => timestamp("observed_at", { withTimezone: true }).notNull();
const githubId = (name: string) => bigint(name, { mode: "bigint" });

export const accounts = github.table(
  "accounts",
  {
    id: githubId("id").primaryKey(),
    nodeId: text("node_id").notNull(),
    login: text("login").notNull(),
    accountType: text("account_type", { enum: ["User", "Organization", "Bot"] }).notNull(),
    name: text("name"),
    bio: text("bio"),
    companyRaw: text("company_raw"),
    locationRaw: text("location_raw"),
    locationCity: text("location_city"),
    locationCountry: text("location_country"),
    locationNormalization: text("location_normalization"),
    avatarUrl: text("avatar_url").notNull(),
    profileUrl: text("profile_url").notNull(),
    followersCount: integer("followers_count"),
    publicReposCount: integer("public_repos_count"),
    searchText: text("search_text").notNull().default(""),
    profileFetchedAt: timestamp("profile_fetched_at", { withTimezone: true }),
    observedAt: observedAt(),
  },
  (t) => [
    uniqueIndex("accounts_login_unique").on(sql`lower(${t.login})`),
    unique("accounts_node_id_unique").on(t.nodeId),
    check("accounts_kind_valid", sql`${t.accountType} in ('User', 'Organization', 'Bot')`),
    check("accounts_followers_nonnegative", sql`${t.followersCount} >= 0`),
  ],
);

export const repositories = github.table(
  "repositories",
  {
    id: githubId("id").primaryKey(),
    nodeId: text("node_id").notNull(),
    ownerId: githubId("owner_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    description: text("description"),
    topics: text("topics").array().notNull().default(sql`'{}'::text[]`),
    defaultBranch: text("default_branch").notNull(),
    readmeText: text("readme_text"),
    readmeSha: text("readme_sha"),
    starsCount: integer("stars_count").notNull(),
    isFork: boolean("is_fork").notNull(),
    isArchived: boolean("is_archived").notNull(),
    repositoryUrl: text("repository_url").notNull(),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    searchText: text("search_text").notNull().default(""),
    observedAt: observedAt(),
  },
  (t) => [
    uniqueIndex("repositories_full_name_unique").on(sql`lower(${t.fullName})`),
    index("repositories_owner").on(t.ownerId),
    check("repositories_stars_nonnegative", sql`${t.starsCount} >= 0`),
  ],
);

export const publicMemberships = github.table(
  "public_memberships",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    personId: githubId("person_id")
      .notNull()
      .references(() => accounts.id),
    organizationId: githubId("organization_id")
      .notNull()
      .references(() => accounts.id),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
    currentlyPublic: boolean("currently_public").notNull(),
    sourceUrl: text("source_url").notNull(),
  },
  (t) => [
    unique("public_memberships_pair_unique").on(t.personId, t.organizationId),
    index("public_memberships_org").on(t.organizationId, t.currentlyPublic),
    check("public_memberships_distinct_accounts", sql`${t.personId} <> ${t.organizationId}`),
  ],
);

export const pullRequests = github.table(
  "pull_requests",
  {
    id: githubId("id").primaryKey(),
    nodeId: text("node_id").notNull(),
    repositoryId: githubId("repository_id")
      .notNull()
      .references(() => repositories.id),
    authorId: githubId("author_id").references(() => accounts.id),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    bodyText: text("body_text"),
    state: text("state", { enum: ["open", "closed"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    pullRequestUrl: text("pull_request_url").notNull(),
    headSha: text("head_sha").notNull(),
    searchText: text("search_text").notNull().default(""),
    observedAt: observedAt(),
  },
  (t) => [
    unique("pull_requests_repo_number_unique").on(t.repositoryId, t.number),
    unique("pull_requests_id_repository_unique").on(t.id, t.repositoryId),
    index("pull_requests_author_merged").on(t.authorId, t.mergedAt),
    index("pull_requests_repo_merged").on(t.repositoryId, t.mergedAt),
    check("pull_requests_number_positive", sql`${t.number} > 0`),
    check("pull_requests_state_valid", sql`${t.state} in ('open', 'closed')`),
  ],
);

export const pullRequestReviews = github.table(
  "pull_request_reviews",
  {
    id: githubId("id").primaryKey(),
    pullRequestId: githubId("pull_request_id")
      .notNull()
      .references(() => pullRequests.id),
    reviewerId: githubId("reviewer_id").references(() => accounts.id),
    state: text("state").notNull(),
    bodyText: text("body_text"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewUrl: text("review_url").notNull(),
    commitSha: text("commit_sha").notNull(),
    observedAt: observedAt(),
  },
  (t) => [
    index("reviews_reviewer_submitted").on(t.reviewerId, t.submittedAt),
    index("reviews_pull_request").on(t.pullRequestId),
  ],
);

export const repositoryLanguages = github.table(
  "repository_languages",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    repositoryId: githubId("repository_id")
      .notNull()
      .references(() => repositories.id),
    language: text("language").notNull(),
    bytes: bigint("bytes", { mode: "bigint" }).notNull(),
    observedAt: observedAt(),
  },
  (t) => [
    unique("repository_languages_pair_unique").on(t.repositoryId, t.language),
    check("repository_languages_bytes_nonnegative", sql`${t.bytes} >= 0`),
  ],
);

export const concepts = github.table(
  "concepts",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    slug: text("slug").notNull().unique(),
    kind: text("kind", { enum: ["domain", "capability", "technology"] }).notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [check("concepts_kind_valid", sql`${t.kind} in ('domain', 'capability', 'technology')`)],
);

export const conceptEvidence = github.table(
  "concept_evidence",
  {
    id: text("id").primaryKey(),
    repositoryId: githubId("repository_id")
      .notNull()
      .references(() => repositories.id),
    pullRequestId: githubId("pull_request_id"),
    conceptId: githubId("concept_id")
      .notNull()
      .references(() => concepts.id),
    sourceKind: text("source_kind", {
      enum: ["topic", "manifest", "readme", "pull_request"],
    }).notNull(),
    method: text("method", { enum: ["deterministic", "llm"] }).notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceRevision: text("source_revision").notNull(),
    excerpt: text("excerpt").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    supportLevel: text("support_level", { enum: ["explicit", "inferred"] }).notNull(),
    reviewStatus: text("review_status", {
      enum: ["accepted", "pending", "rejected", "superseded"],
    }).notNull(),
    observedAt: observedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.pullRequestId, t.repositoryId],
      foreignColumns: [pullRequests.id, pullRequests.repositoryId],
      name: "concept_evidence_pull_request_repository_fk",
    }),
    index("concept_evidence_repository_concept").on(t.repositoryId, t.conceptId),
    index("concept_evidence_pull_request").on(t.pullRequestId),
    check(
      "concept_evidence_source_kind_valid",
      sql`${t.sourceKind} in ('topic', 'manifest', 'readme', 'pull_request')`,
    ),
    check("concept_evidence_method_valid", sql`${t.method} in ('deterministic', 'llm')`),
    check("concept_evidence_support_valid", sql`${t.supportLevel} in ('explicit', 'inferred')`),
    check(
      "concept_evidence_review_valid",
      sql`${t.reviewStatus} in ('accepted', 'pending', 'rejected', 'superseded')`,
    ),
    check(
      "concept_evidence_scope_valid",
      sql`(${t.sourceKind} = 'pull_request') = (${t.pullRequestId} is not null)`,
    ),
  ],
);

export const syncState = ingest.table(
  "sync_state",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    resource: text("resource").notNull(),
    cursor: text("cursor"),
    etag: text("etag"),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    status: text("status", { enum: ["pending", "partial", "complete", "failed"] }).notNull(),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    recordsFetched: integer("records_fetched").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
  },
  (t) => [
    unique("sync_state_scope_resource_unique").on(t.scope, t.resource),
    check(
      "sync_state_status_valid",
      sql`${t.status} in ('pending', 'partial', 'complete', 'failed')`,
    ),
    check(
      "sync_state_counts_nonnegative",
      sql`${t.pagesFetched} >= 0 and ${t.recordsFetched} >= 0`,
    ),
  ],
);

export const searchRequests = operations.table(
  "search_requests",
  {
    id: text("id").primaryKey(),
    clientHash: text("client_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome"),
    runtimeRequestId: text("runtime_request_id"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("search_requests_client_time").on(t.clientHash, t.createdAt),
    index("search_requests_time").on(t.createdAt),
  ],
);

export const captures = ingest.table("captures", {
  id: text("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  sha256: text("sha256").notNull(),
  apiVersion: text("api_version").notNull(),
  recordCount: integer("record_count").notNull(),
  coverage: jsonb("coverage").notNull(),
});

export const schema = {
  accounts,
  repositories,
  publicMemberships,
  pullRequests,
  pullRequestReviews,
  repositoryLanguages,
  concepts,
  conceptEvidence,
  syncState,
  searchRequests,
  captures,
};
