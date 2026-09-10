import type pg from "pg";
import { z } from "zod";
import {
  type Catalog,
  type Coverage,
  catalogSchema,
  coverageSchema,
  type Person,
  personSchema,
} from "./contracts.ts";

const timestamp = z.coerce.date().transform((value) => value.toISOString());
const contextRowSchema = z.object({
  kind: z.enum(["repository", "pull_request", "review", "concept", "membership"]),
  title: z.string(),
  url: z.url(),
  repository: z.string().nullable(),
  excerpt: z.string().nullable(),
  observedAt: timestamp,
  occurredAt: timestamp.nullable(),
  sourceRevision: z.string().nullable(),
});
const personRowSchema = personSchema.omit({ observedAt: true, context: true }).extend({
  observedAt: timestamp,
  context: z.array(contextRowSchema),
});

const personProjection = `
SELECT a.id::text AS id, a.login, a.name, a.bio,
  a.avatar_url AS "avatarUrl", a.profile_url AS "profileUrl", a.location_raw AS location,
  a.company_raw AS company, a.followers_count AS followers, a.observed_at AS "observedAt",
  COALESCE((SELECT jsonb_agg(o.login ORDER BY o.login)
    FROM github.public_memberships m JOIN github.accounts o ON o.id=m.organization_id
    WHERE m.person_id=a.id AND m.currently_public), '[]'::jsonb) AS organizations,
  COALESCE((SELECT jsonb_agg(r.full_name ORDER BY r.full_name) FROM github.repositories r
    WHERE r.owner_id=a.id OR EXISTS(SELECT 1 FROM github.pull_requests p WHERE p.repository_id=r.id AND p.author_id=a.id)
    OR EXISTS(SELECT 1 FROM github.pull_request_reviews v JOIN github.pull_requests p ON p.id=v.pull_request_id WHERE p.repository_id=r.id AND v.reviewer_id=a.id)), '[]'::jsonb) AS repositories,
  COALESCE((SELECT jsonb_agg(DISTINCT c.label ORDER BY c.label) FROM github.concepts c
    JOIN github.concept_evidence e ON e.concept_id=c.id AND e.review_status='accepted'
    WHERE EXISTS(SELECT 1 FROM github.pull_requests p WHERE p.author_id=a.id AND p.repository_id=e.repository_id)), '[]'::jsonb) AS concepts,
  COALESCE((SELECT jsonb_agg(to_jsonb(context) ORDER BY context."observedAt" DESC) FROM (
    (SELECT 'pull_request'::text AS kind, p.title, p.pull_request_url AS url, r.full_name AS repository,
      left(p.body_text, 600) AS excerpt, p.observed_at AS "observedAt", p.merged_at AS "occurredAt", p.head_sha AS "sourceRevision"
      FROM github.pull_requests p JOIN github.repositories r ON r.id=p.repository_id WHERE p.author_id=a.id
      ORDER BY p.updated_at DESC LIMIT 6)
    UNION ALL
    (SELECT 'membership', 'Public member of ' || o.login, m.source_url, NULL::text, NULL::text,
      m.last_checked_at, NULL::timestamptz, NULL::text
      FROM github.public_memberships m JOIN github.accounts o ON o.id=m.organization_id
      WHERE m.person_id=a.id AND m.currently_public ORDER BY o.login LIMIT 4)
    UNION ALL
    (SELECT 'review', 'Reviewed: ' || p.title, v.review_url, r.full_name, left(v.body_text,600),
      v.observed_at, v.submitted_at, v.commit_sha
      FROM github.pull_request_reviews v JOIN github.pull_requests p ON p.id=v.pull_request_id
      JOIN github.repositories r ON r.id=p.repository_id WHERE v.reviewer_id=a.id
      ORDER BY v.submitted_at DESC NULLS LAST LIMIT 4)
  ) context), '[]'::jsonb) AS context
FROM github.accounts a`;

export async function hydratePeople(pool: pg.Pool, ids: readonly string[]): Promise<Person[]> {
  if (ids.length === 0) return [];
  const result = await pool.query(
    `${personProjection} WHERE a.id=ANY($1::bigint[]) AND a.account_type='User' ORDER BY array_position($1::bigint[], a.id)`,
    [ids],
  );
  const people = result.rows.map((row: unknown) => personRowSchema.parse(row));
  if (people.length !== ids.length || people.some((person, index) => person.id !== ids[index])) {
    throw new Error("Gia identity result does not match the local public-human records");
  }
  return people;
}

export async function findPerson(pool: pg.Pool, login: string): Promise<Person | null> {
  const valid = z
    .string()
    .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/)
    .safeParse(login);
  if (!valid.success) return null;
  const result = await pool.query(
    `${personProjection} WHERE lower(a.login)=lower($1) AND a.account_type='User'`,
    [valid.data],
  );
  if (result.rows.length === 0) return null;
  return personRowSchema.parse(result.rows[0]);
}

export async function readCoverage(pool: pg.Pool): Promise<Coverage> {
  const result = await pool.query(`SELECT
    (SELECT count(*)::integer FROM github.accounts WHERE account_type='User') AS people,
    (SELECT count(*)::integer FROM github.repositories) AS repositories,
    (SELECT count(*)::integer FROM github.pull_requests) AS "pullRequests",
    (SELECT count(*)::integer FROM github.pull_request_reviews) AS reviews,
    (SELECT max(observed_at) FROM github.accounts) AS "observedAt",
    (SELECT count(*)::integer FROM ingest.sync_state WHERE status='complete') AS "completeSources",
    (SELECT count(*)::integer FROM ingest.sync_state WHERE status<>'complete') AS "partialSources"`);
  const row = coverageSchema
    .omit({ notice: true, observedAt: true })
    .extend({ observedAt: timestamp.nullable() })
    .parse(result.rows[0]);
  return {
    ...row,
    notice:
      "Results cover only indexed public sources. Missing or partial collection is unknown, not evidence of no activity. Public membership does not establish employment. Repository technologies describe projects, not personal proficiency.",
  };
}

export async function readCatalog(pool: pg.Pool): Promise<Catalog> {
  const [coverage, concepts] = await Promise.all([
    readCoverage(pool),
    pool.query("SELECT slug, label FROM github.concepts ORDER BY label"),
  ]);
  return catalogSchema.parse({
    coverage,
    concepts: concepts.rows,
    examples: [
      {
        label: "AI contributors",
        question: "Find people with merged pull requests in AI projects.",
      },
      {
        label: "Public Vercel members",
        question: "Find public Vercel members who contributed to AI repositories.",
      },
      {
        label: "Reviewers",
        question: "Find people who reviewed other people's pull requests in AI repositories.",
      },
      {
        label: "Across projects",
        question: "Find people with merged pull requests in at least two repositories.",
      },
    ],
  });
}
