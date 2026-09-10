CREATE SCHEMA "github";
--> statement-breakpoint
CREATE SCHEMA "ingest";
--> statement-breakpoint
CREATE SCHEMA "operations";
--> statement-breakpoint
CREATE TABLE "github"."accounts" (
	"id" bigint PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"login" text NOT NULL,
	"account_type" text NOT NULL,
	"name" text,
	"bio" text,
	"company_raw" text,
	"location_raw" text,
	"location_city" text,
	"location_country" text,
	"location_normalization" text,
	"avatar_url" text NOT NULL,
	"profile_url" text NOT NULL,
	"followers_count" integer,
	"public_repos_count" integer,
	"search_text" text DEFAULT '' NOT NULL,
	"profile_fetched_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "accounts_node_id_unique" UNIQUE("node_id"),
	CONSTRAINT "accounts_kind_valid" CHECK ("github"."accounts"."account_type" in ('User', 'Organization', 'Bot')),
	CONSTRAINT "accounts_followers_nonnegative" CHECK ("github"."accounts"."followers_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ingest"."captures" (
	"id" text PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"sha256" text NOT NULL,
	"api_version" text NOT NULL,
	"record_count" integer NOT NULL,
	"coverage" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github"."concept_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" bigint NOT NULL,
	"pull_request_id" bigint,
	"concept_id" bigint NOT NULL,
	"source_kind" text NOT NULL,
	"method" text NOT NULL,
	"source_url" text NOT NULL,
	"source_revision" text NOT NULL,
	"excerpt" text NOT NULL,
	"extractor_version" text NOT NULL,
	"support_level" text NOT NULL,
	"review_status" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "concept_evidence_source_kind_valid" CHECK ("github"."concept_evidence"."source_kind" in ('topic', 'manifest', 'readme', 'pull_request')),
	CONSTRAINT "concept_evidence_method_valid" CHECK ("github"."concept_evidence"."method" in ('deterministic', 'llm')),
	CONSTRAINT "concept_evidence_support_valid" CHECK ("github"."concept_evidence"."support_level" in ('explicit', 'inferred')),
	CONSTRAINT "concept_evidence_review_valid" CHECK ("github"."concept_evidence"."review_status" in ('accepted', 'pending', 'rejected', 'superseded')),
	CONSTRAINT "concept_evidence_scope_valid" CHECK (("github"."concept_evidence"."source_kind" = 'pull_request') = ("github"."concept_evidence"."pull_request_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "github"."concepts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "concepts_slug_unique" UNIQUE("slug"),
	CONSTRAINT "concepts_kind_valid" CHECK ("github"."concepts"."kind" in ('domain', 'capability', 'technology'))
);
--> statement-breakpoint
CREATE TABLE "github"."public_memberships" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"person_id" bigint NOT NULL,
	"organization_id" bigint NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"currently_public" boolean NOT NULL,
	"source_url" text NOT NULL,
	CONSTRAINT "public_memberships_pair_unique" UNIQUE("person_id","organization_id"),
	CONSTRAINT "public_memberships_distinct_accounts" CHECK ("github"."public_memberships"."person_id" <> "github"."public_memberships"."organization_id")
);
--> statement-breakpoint
CREATE TABLE "github"."pull_request_reviews" (
	"id" bigint PRIMARY KEY NOT NULL,
	"pull_request_id" bigint NOT NULL,
	"reviewer_id" bigint,
	"state" text NOT NULL,
	"body_text" text,
	"submitted_at" timestamp with time zone,
	"review_url" text NOT NULL,
	"commit_sha" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github"."pull_requests" (
	"id" bigint PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"repository_id" bigint NOT NULL,
	"author_id" bigint,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body_text" text,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone,
	"pull_request_url" text NOT NULL,
	"head_sha" text NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pull_requests_repo_number_unique" UNIQUE("repository_id","number"),
	CONSTRAINT "pull_requests_id_repository_unique" UNIQUE("id","repository_id"),
	CONSTRAINT "pull_requests_number_positive" CHECK ("github"."pull_requests"."number" > 0),
	CONSTRAINT "pull_requests_state_valid" CHECK ("github"."pull_requests"."state" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "github"."repositories" (
	"id" bigint PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"owner_id" bigint NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"description" text,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_branch" text NOT NULL,
	"readme_text" text,
	"readme_sha" text,
	"stars_count" integer NOT NULL,
	"is_fork" boolean NOT NULL,
	"is_archived" boolean NOT NULL,
	"repository_url" text NOT NULL,
	"pushed_at" timestamp with time zone,
	"search_text" text DEFAULT '' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repositories_stars_nonnegative" CHECK ("github"."repositories"."stars_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "github"."repository_languages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"repository_id" bigint NOT NULL,
	"language" text NOT NULL,
	"bytes" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repository_languages_pair_unique" UNIQUE("repository_id","language"),
	CONSTRAINT "repository_languages_bytes_nonnegative" CHECK ("github"."repository_languages"."bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operations"."search_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"client_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"runtime_request_id" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "ingest"."sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"cursor" text,
	"etag" text,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"status" text NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"records_fetched" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_code" text,
	CONSTRAINT "sync_state_scope_resource_unique" UNIQUE("scope","resource"),
	CONSTRAINT "sync_state_status_valid" CHECK ("ingest"."sync_state"."status" in ('pending', 'partial', 'complete', 'failed')),
	CONSTRAINT "sync_state_counts_nonnegative" CHECK ("ingest"."sync_state"."pages_fetched" >= 0 and "ingest"."sync_state"."records_fetched" >= 0)
);
--> statement-breakpoint
ALTER TABLE "github"."concept_evidence" ADD CONSTRAINT "concept_evidence_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "github"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."concept_evidence" ADD CONSTRAINT "concept_evidence_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "github"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."concept_evidence" ADD CONSTRAINT "concept_evidence_pull_request_repository_fk" FOREIGN KEY ("pull_request_id","repository_id") REFERENCES "github"."pull_requests"("id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."public_memberships" ADD CONSTRAINT "public_memberships_person_id_accounts_id_fk" FOREIGN KEY ("person_id") REFERENCES "github"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."public_memberships" ADD CONSTRAINT "public_memberships_organization_id_accounts_id_fk" FOREIGN KEY ("organization_id") REFERENCES "github"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "github"."pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_reviewer_id_accounts_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "github"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "github"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."pull_requests" ADD CONSTRAINT "pull_requests_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "github"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."repositories" ADD CONSTRAINT "repositories_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "github"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github"."repository_languages" ADD CONSTRAINT "repository_languages_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "github"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_login_unique" ON "github"."accounts" USING btree (lower("login"));--> statement-breakpoint
CREATE INDEX "concept_evidence_repository_concept" ON "github"."concept_evidence" USING btree ("repository_id","concept_id");--> statement-breakpoint
CREATE INDEX "concept_evidence_pull_request" ON "github"."concept_evidence" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "public_memberships_org" ON "github"."public_memberships" USING btree ("organization_id","currently_public");--> statement-breakpoint
CREATE INDEX "reviews_reviewer_submitted" ON "github"."pull_request_reviews" USING btree ("reviewer_id","submitted_at");--> statement-breakpoint
CREATE INDEX "reviews_pull_request" ON "github"."pull_request_reviews" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "pull_requests_author_merged" ON "github"."pull_requests" USING btree ("author_id","merged_at");--> statement-breakpoint
CREATE INDEX "pull_requests_repo_merged" ON "github"."pull_requests" USING btree ("repository_id","merged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_full_name_unique" ON "github"."repositories" USING btree (lower("full_name"));--> statement-breakpoint
CREATE INDEX "repositories_owner" ON "github"."repositories" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "search_requests_client_time" ON "operations"."search_requests" USING btree ("client_hash","created_at");--> statement-breakpoint
CREATE INDEX "search_requests_time" ON "operations"."search_requests" USING btree ("created_at");