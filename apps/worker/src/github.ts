import { Octokit } from "octokit";
import { z } from "zod";

export const GITHUB_API_VERSION = "2022-11-28";
export class GitHubCollectionError extends Error {
  constructor(
    readonly code: "request_budget" | "rate_limit" | "http_error",
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`GitHub collection stopped: ${code}${status === null ? "" : ` (HTTP ${status})`}`);
    this.name = "GitHubCollectionError";
  }
}
type ResponseMetadata = {
  sourceUrl: string;
  observedAt: string;
  etag: string | null;
  nextUrl: string | null;
};
export type GitHubResponse =
  | (ResponseMetadata & { kind: "data"; data: unknown })
  | (ResponseMetadata & { kind: "not_modified" | "missing" });

export function createGitHubClient(config: {
  token: string;
  maximumRequests: number;
  signal?: AbortSignal;
}) {
  if (
    !Number.isInteger(config.maximumRequests) ||
    config.maximumRequests < 1 ||
    config.maximumRequests > 5_000
  )
    throw new Error("GitHub request budget must be between 1 and 5000");
  const octokit = new Octokit({
    auth: config.token,
    userAgent: "gia-github/0.1",
    retry: { enabled: false },
    throttle: { enabled: false },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  let requests = 0;
  let remaining: number | null = null;
  return {
    metrics: () => ({ requests, remaining }),
    async get(pathOrUrl: string, etag?: string | null): Promise<GitHubResponse> {
      const url = new URL(pathOrUrl, "https://api.github.com");
      if (url.origin !== "https://api.github.com")
        throw new Error("GitHub request URL must use api.github.com");
      if (requests >= config.maximumRequests)
        throw new GitHubCollectionError("request_budget", null);
      requests += 1;
      const observedAt = new Date().toISOString();
      try {
        const result = await octokit.request(`GET ${url.href}`, {
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": GITHUB_API_VERSION,
            ...(etag ? { "if-none-match": etag } : {}),
          },
          request: { timeout: 30_000, ...(config.signal ? { signal: config.signal } : {}) },
        });
        const budget = result.headers["x-ratelimit-remaining"];
        remaining = budget === undefined ? remaining : Number(budget);
        const nextUrl = /<([^>]+)>; rel="next"/.exec(result.headers.link ?? "")?.[1] ?? null;
        return {
          kind: "data",
          data: result.data,
          sourceUrl: url.href,
          observedAt,
          etag: result.headers.etag ?? null,
          nextUrl,
        };
      } catch (error: unknown) {
        const parsed = z
          .object({
            status: z.number(),
            response: z.object({ headers: z.record(z.string(), z.unknown()) }).optional(),
          })
          .safeParse(error);
        if (!parsed.success) throw new GitHubCollectionError("http_error", null);
        const status = parsed.data.status;
        const metadata = { sourceUrl: url.href, observedAt, etag: etag ?? null, nextUrl: null };
        if (status === 304) return { ...metadata, kind: "not_modified" };
        if (status === 404) return { ...metadata, kind: "missing" };
        const retry = parsed.data.response?.headers["retry-after"];
        const retryAfter = typeof retry === "string" && /^\d+$/.test(retry) ? Number(retry) : null;
        throw new GitHubCollectionError(
          status === 403 || status === 429 ? "rate_limit" : "http_error",
          status,
          retryAfter,
        );
      }
    },
  };
}
export type GitHubClient = ReturnType<typeof createGitHubClient>;
