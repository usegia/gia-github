import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSearchService } from "../../packages/search/src/server.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for actual Gia query integration`);
  return value;
};
const databaseUrl = required("DATABASE_URL");
const readOnlyDatabaseUrl = required("GIA_DATABASE_URL");
const pool = new pg.Pool({ connectionString: readOnlyDatabaseUrl, max: 2 });
const service = createSearchService({
  databaseUrl,
  readOnlyDatabaseUrl,
  projectDirectory: path.resolve(process.env.GIA_PROJECT_DIR ?? "."),
  runtimeUrl: process.env.GIA_API_URL ?? "http://127.0.0.1:8798",
  runtimeApiKey: process.env.GIA_API_KEY ?? "",
  profileId: process.env.GIA_ACTIVE_PROFILE ?? "github-dev",
  maximumDailySearches: z.coerce
    .number()
    .int()
    .min(100)
    .max(1000)
    .parse(process.env.GIA_GOLDEN_DAILY_LIMIT ?? 100),
  maximumSearchesPerMinute: 30,
});
const repetitions = z.coerce
  .number()
  .int()
  .min(1)
  .max(5)
  .parse(process.env.GIA_GOLDEN_REPETITIONS ?? 1);
const evidenceDirectory = process.env.GIA_GOLDEN_EVIDENCE_DIR;
const idRows = z.array(z.object({ id: z.string().regex(/^[1-9]\d*$/), login: z.string() }));
const publicVercel = `EXISTS (SELECT 1 FROM github.public_memberships m JOIN github.accounts o ON o.id=m.organization_id WHERE m.person_id=a.id AND m.currently_public AND lower(o.login)='vercel')`;
const merged = `EXISTS (SELECT 1 FROM github.pull_requests p WHERE p.author_id=a.id AND p.merged_at IS NOT NULL)`;
const reranking = `EXISTS (SELECT 1 FROM github.pull_requests p JOIN github.concept_evidence e ON e.pull_request_id=p.id JOIN github.concepts c ON c.id=e.concept_id WHERE p.author_id=a.id AND p.merged_at IS NOT NULL AND c.slug='reranking' AND e.review_status='accepted')`;
const selectPeople = (condition: string) =>
  `SELECT a.id::text,a.login FROM github.accounts a WHERE a.account_type='User' AND (${condition}) ORDER BY a.id`;

type GoldenCase = {
  name: string;
  questions: readonly string[];
  sql: string;
  requiredLogins: readonly string[];
  empty?: true;
};
const cases: readonly GoldenCase[] = [
  {
    name: "public organization membership and dated merged AI work",
    questions: [
      "Find public Vercel members who authored a merged pull request from June 12, 2026 inclusive to September 11, 2026 exclusive in a repository with accepted repository-level ai concept evidence. Evidence may be explicit or inferred.",
      "Among people publicly listed as members of the vercel organization, who authored an AI-repository pull request merged between 2026-06-12 inclusive and 2026-09-11 exclusive? Use accepted repository-level concept ai, including inferred evidence.",
    ],
    sql: selectPeople(
      `${publicVercel} AND EXISTS(SELECT 1 FROM github.pull_requests p WHERE p.author_id=a.id AND p.merged_at>='2026-06-12T00:00:00Z' AND p.merged_at<'2026-09-11T00:00:00Z' AND EXISTS(SELECT 1 FROM github.concept_evidence e JOIN github.concepts c ON c.id=e.concept_id WHERE e.repository_id=p.repository_id AND e.pull_request_id IS NULL AND c.slug='ai' AND e.review_status='accepted'))`,
    ),
    requiredLogins: ["n1ckoates", "HugoRCD"],
  },
  {
    name: "specific PR capability evidence rather than repository inheritance",
    questions: [
      "Who authored merged pull requests with accepted PR-level reranking concept evidence? Inferred text or patch mentions count; repository-level evidence alone does not count.",
    ],
    sql: selectPeople(reranking),
    requiredLogins: ["anbuzin"],
  },
  {
    name: "distinct reviews of other authors",
    questions: [
      "Who reviewed at least two distinct pull requests authored by other people? Multiple reviews of the same pull request count once; exclude self-reviews.",
    ],
    sql: selectPeople(
      `(SELECT count(DISTINCT v.pull_request_id) FROM github.pull_request_reviews v JOIN github.pull_requests p ON p.id=v.pull_request_id WHERE v.reviewer_id=a.id AND p.author_id<>a.id)>=2`,
    ),
    requiredLogins: ["gr2m"],
  },
  {
    name: "AI SDK and PostgreSQL on the same repository",
    questions: [
      "Find authors of merged pull requests in a repository having both accepted repository-level npm:ai and postgresql concepts. Both concepts must belong to the same repository; either support level counts.",
    ],
    sql: selectPeople(
      `EXISTS(SELECT 1 FROM github.pull_requests p WHERE p.author_id=a.id AND p.merged_at IS NOT NULL AND EXISTS(SELECT 1 FROM github.concept_evidence e JOIN github.concepts c ON c.id=e.concept_id WHERE e.repository_id=p.repository_id AND e.pull_request_id IS NULL AND e.review_status='accepted' AND c.slug='npm:ai') AND EXISTS(SELECT 1 FROM github.concept_evidence e JOIN github.concepts c ON c.id=e.concept_id WHERE e.repository_id=p.repository_id AND e.pull_request_id IS NULL AND e.review_status='accepted' AND c.slug='postgresql'))`,
    ),
    requiredLogins: [],
  },
  {
    name: "contributions across distinct repositories",
    questions: [
      "Find people who authored merged pull requests in at least two distinct indexed repositories.",
      "Which contributors have merged PRs under their own authorship across two or more different repositories in this dataset?",
    ],
    sql: selectPeople(
      `(SELECT count(DISTINCT p.repository_id) FROM github.pull_requests p WHERE p.author_id=a.id AND p.merged_at IS NOT NULL)>=2`,
    ),
    requiredLogins: ["CahidArda", "n1ckoates"],
  },
  {
    name: "profile absence does not substitute for PR evidence",
    questions: [
      "Find authors of merged pull requests with accepted PR-level reranking evidence whose biography has no case-insensitive literal substring AI. A null biography satisfies the biography condition. Inferred reranking evidence counts.",
    ],
    sql: selectPeople(`${reranking} AND (a.bio IS NULL OR a.bio NOT ILIKE '%AI%')`),
    requiredLogins: [],
    empty: true,
  },
  {
    name: "current archive state and popularity constrain project evidence",
    questions: [
      "Find people who authored a merged PR in a non-archived repository with more than 100 stars and accepted repository-level postgresql concept evidence. Inferred evidence counts. Archived repositories do not qualify.",
    ],
    sql: selectPeople(
      `EXISTS(SELECT 1 FROM github.pull_requests p JOIN github.repositories r ON r.id=p.repository_id WHERE p.author_id=a.id AND p.merged_at IS NOT NULL AND NOT r.is_archived AND r.stars_count>100 AND EXISTS(SELECT 1 FROM github.concept_evidence e JOIN github.concepts c ON c.id=e.concept_id WHERE e.repository_id=r.id AND e.pull_request_id IS NULL AND e.review_status='accepted' AND c.slug='postgresql'))`,
    ),
    requiredLogins: [],
  },
  {
    name: "known follower counts with repeated cross-project work",
    questions: [
      "Find people with a known follower count below 500 who authored merged pull requests in at least two distinct repositories. Unknown follower counts do not qualify.",
    ],
    sql: selectPeople(
      `a.followers_count<500 AND (SELECT count(DISTINCT p.repository_id) FROM github.pull_requests p WHERE p.author_id=a.id AND p.merged_at IS NOT NULL)>=2`,
    ),
    requiredLogins: ["n1ckoates"],
  },
  {
    name: "explicit disjunction across public affiliation and PR evidence",
    questions: [
      "Find people satisfying either condition: they are a public Vercel member with at least one authored merged PR, OR they authored a merged PR with accepted PR-level reranking evidence. Include inferred evidence. This is OR, not AND.",
    ],
    sql: selectPeople(`(${publicVercel} AND ${merged}) OR ${reranking}`),
    requiredLogins: ["n1ckoates", "HugoRCD", "anbuzin"],
  },
  {
    name: "unknown location cannot satisfy an explicit location filter",
    questions: [
      "Find people whose normalized location_city equals Berlin and who authored at least one merged pull request. Missing or unknown locations do not qualify, and do not infer locations from organizations.",
    ],
    sql: selectPeople(`a.location_city='Berlin' AND ${merged}`),
    requiredLogins: [],
    empty: true,
  },
];

beforeAll(async () => {
  const corpus = await pool.query(
    "SELECT count(*)::integer AS people FROM github.accounts WHERE account_type='User'",
  );
  expect(corpus.rows[0].people, "The actual public GitHub corpus must be loaded").toBeGreaterThan(
    100,
  );
  expect(
    (
      await pool.query(
        "SELECT count(*)::integer AS value FROM github.concept_evidence WHERE review_status='accepted'",
      )
    ).rows[0].value,
  ).toBeGreaterThan(100);
});
afterAll(async () => {
  await service.close();
  await pool.end();
});

describe("real Gia golden questions over frozen public GitHub observations", () => {
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const [caseIndex, testCase] of cases.entries()) {
      for (const [variant, question] of testCase.questions.entries()) {
        it(`${testCase.name}, wording ${variant + 1}, sample ${repetition}`, async () => {
          const expected = idRows.parse((await pool.query(testCase.sql)).rows);
          expect(expected.length, "Golden result must fit the requested limit").toBeLessThanOrEqual(
            50,
          );
          if (testCase.empty) expect(expected).toHaveLength(0);
          else
            expect(
              expected.length,
              "Every positive golden has an independent populated control",
            ).toBeGreaterThan(0);
          for (const login of testCase.requiredLogins)
            expect(expected.map((person) => person.login)).toContain(login);
          const startedAt = new Date().toISOString();
          const output = await service.search({
            question,
            limit: 50,
            clientKey: `golden-${randomUUID()}`,
            signal: AbortSignal.timeout(180_000),
          });
          if (evidenceDirectory) {
            await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
            const authority = z
              .object({ candidateSnapshotId: z.string().regex(/^[a-f0-9]{64}$/) })
              .parse(
                JSON.parse(
                  await readFile(
                    path.join(process.env.GIA_PROJECT_DIR ?? ".", "gia/client-authority.json"),
                    "utf8",
                  ),
                ),
              );
            await writeFile(
              path.join(evidenceDirectory, `${caseIndex + 1}-${variant + 1}-${repetition}.json`),
              `${JSON.stringify(
                {
                  name: testCase.name,
                  variant: variant + 1,
                  repetition,
                  question,
                  startedAt,
                  finishedAt: new Date().toISOString(),
                  snapshotId: authority.candidateSnapshotId,
                  requestId: output.requestId,
                  kind: output.kind,
                  expectedIds: expected.map((person) => person.id),
                  ...(output.kind === "matches"
                    ? {
                        actualIds: output.people.map((person) => person.id),
                        interpretation: output.interpretation,
                        truncated: output.truncated,
                      }
                    : output.kind === "failed"
                      ? { code: output.code }
                      : { explanation: output.explanation }),
                },
                null,
                2,
              )}\n`,
              { mode: 0o600, flag: "wx" },
            );
          }
          expect(output.kind, JSON.stringify(output)).toBe("matches");
          if (output.kind !== "matches") throw new Error("Gia did not produce a verified answer");
          expect(output.truncated).toBe(false);
          expect(output.people.map((person) => person.id).sort()).toEqual(
            expected.map((person) => person.id).sort(),
          );
          expect(new Set(output.people.map((person) => person.id)).size).toBe(output.people.length);
          expect(output.people.some((person) => person.login === "vercel")).toBe(false);
          expect(output.coverage.partialSources).toBeGreaterThan(0);
        });
      }
    }
  }

  it("returns a World-scoped unsupported outcome for unavailable private intentions", async () => {
    const output = await service.search({
      question:
        "Find people who privately intend to leave their current employer next month. I require verified private intentions; public GitHub activity or profile text is not evidence of that intention.",
      limit: 20,
      clientKey: `unsupported-${randomUUID()}`,
      signal: AbortSignal.timeout(180_000),
    });
    expect(output.kind, JSON.stringify(output)).toBe("unsupported");
    if (output.kind !== "unsupported")
      throw new Error("Private intention must remain unanswerable");
    expect(output.explanation.length).toBeGreaterThan(20);
  });
});
