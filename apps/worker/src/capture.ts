import { createHash } from "node:crypto";
import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime({ offset: true });
export const accountSchema = z.object({
  id,
  node_id: z.string().min(1),
  login: z.string().min(1),
  type: z.enum(["User", "Organization", "Bot"]),
  html_url: z.url(),
  avatar_url: z.url().optional(),
});
export const profileSchema = accountSchema.extend({
  name: z.string().nullable(),
  bio: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  followers: z.number().int().nonnegative(),
  public_repos: z.number().int().nonnegative(),
});
export const repositorySchema = z.object({
  id,
  node_id: z.string().min(1),
  name: z.string().min(1),
  full_name: z.string().min(3),
  owner: accountSchema,
  html_url: z.url(),
  description: z.string().nullable(),
  topics: z.array(z.string()),
  default_branch: z.string().min(1),
  stargazers_count: z.number().int().nonnegative(),
  fork: z.boolean(),
  archived: z.boolean(),
  pushed_at: timestamp.nullable(),
  visibility: z.literal("public"),
});
export const pullRequestSchema = z.object({
  id,
  node_id: z.string().min(1),
  number: z.number().int().positive(),
  user: accountSchema.nullable(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  created_at: timestamp,
  updated_at: timestamp,
  merged_at: timestamp.nullable(),
  html_url: z.url(),
  head: z.object({ sha: z.string().min(1) }),
});
export const reviewSchema = z.object({
  id,
  user: accountSchema.nullable(),
  body: z.string(),
  state: z.string().min(1),
  submitted_at: timestamp.nullable(),
  html_url: z.url(),
  commit_id: z.string().min(1),
});
export const contentSchema = z.object({
  encoding: z.literal("base64"),
  content: z.string(),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  path: z.string().min(1),
  html_url: z.url(),
  git_url: z.url(),
});
export const fileSchema = z.object({
  sha: z.string(),
  filename: z.string(),
  status: z.string(),
  patch: z.string().nullable().optional(),
  blob_url: z.url(),
});
const repositoryScope = { repositoryId: id, repository: z.string().min(3) };
export const captureSchema = z.object({
  version: z.literal(1),
  sourceUrl: z.url().refine((value) => new URL(value).hostname === "api.github.com"),
  observedAt: timestamp,
  apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  etag: z.string().nullable(),
  coverage: z.object({
    status: z.enum(["complete", "partial"]),
    page: z.number().int().positive(),
    nextCursor: z.string().nullable(),
    windowStart: timestamp.nullable(),
    windowEnd: timestamp.nullable(),
  }),
  payload: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("repositories"), records: z.array(repositorySchema) }),
    z.object({ kind: z.literal("profiles"), records: z.array(profileSchema) }),
    z.object({
      kind: z.literal("memberships"),
      organization: accountSchema,
      records: z.array(accountSchema),
    }),
    z.object({
      kind: z.literal("pull_requests"),
      ...repositoryScope,
      records: z.array(pullRequestSchema),
    }),
    z.object({
      kind: z.literal("reviews"),
      ...repositoryScope,
      pullRequestId: id,
      records: z.array(reviewSchema),
    }),
    z.object({
      kind: z.literal("languages"),
      ...repositoryScope,
      records: z.record(z.string(), z.number().int().nonnegative()),
    }),
    z.object({ kind: z.literal("readme"), ...repositoryScope, content: contentSchema }),
    z.object({ kind: z.literal("manifest"), ...repositoryScope, content: contentSchema }),
    z.object({
      kind: z.literal("pull_request_files"),
      ...repositoryScope,
      pullRequestId: id,
      headSha: z.string().min(1),
      records: z.array(fileSchema),
    }),
  ]),
});
export type Capture = z.infer<typeof captureSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Profile = z.infer<typeof profileSchema>;
export const fixtureManifestSchema = z.object({
  version: z.literal(1),
  description: z.string(),
  files: z.array(
    z.object({
      path: z.string().regex(/^[a-zA-Z0-9_.-]+\.json$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function captureScope(capture: Capture): { scope: string; resource: string } {
  const payload = capture.payload;
  switch (payload.kind) {
    case "repositories":
      return { scope: "repositories", resource: capture.sourceUrl };
    case "profiles":
      return { scope: "profiles", resource: capture.sourceUrl };
    case "memberships":
      return { scope: `organization:${payload.organization.id}`, resource: "public_members" };
    case "reviews":
    case "pull_request_files":
      return { scope: `pull_request:${payload.pullRequestId}`, resource: payload.kind };
    default:
      return {
        scope: `repository:${payload.repositoryId}`,
        resource: payload.kind === "manifest" ? `manifest:${payload.content.path}` : payload.kind,
      };
  }
}
export function recordCount(capture: Capture): number {
  const payload = capture.payload;
  if (payload.kind === "readme" || payload.kind === "manifest") return 1;
  return Array.isArray(payload.records)
    ? payload.records.length
    : Object.keys(payload.records).length;
}
