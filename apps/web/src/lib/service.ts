import "server-only";

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SearchService } from "@gia-github/search/contracts";
import { createSearchService } from "@gia-github/search/server";
import { config as loadEnvironment } from "dotenv";
import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  GIA_DATABASE_URL: z.url(),
  GIA_PROJECT_DIR: z.string().default("."),
  GIA_API_URL: z.url().default("http://127.0.0.1:8798"),
  GIA_API_KEY: z.string().default(""),
  GIA_ACTIVE_PROFILE: z.string().min(1).default("github-dev"),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(180_000).default(120_000),
  SEARCH_MAXIMUM_DAILY_SEARCHES: z.coerce.number().int().min(1).max(10_000).default(100),
});

function repositoryRoot() {
  let directory = process.cwd();
  while (!existsSync(resolve(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) return process.cwd();
    directory = parent;
  }
  return directory;
}

let service: SearchService | undefined;
let environmentRoot: string | undefined;

function loadWebEnvironment() {
  if (environmentRoot) return environmentRoot;
  const root = repositoryRoot();
  loadEnvironment({ path: resolve(root, ".env"), quiet: true });
  environmentRoot = root;
  return root;
}

export function getExpectedOrigin(request: Request): string {
  loadWebEnvironment();
  if (process.env.APP_ORIGIN) {
    const origin = new URL(process.env.APP_ORIGIN);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      throw new Error("APP_ORIGIN must be an HTTP or HTTPS origin without credentials or a path");
    }
    return origin.origin;
  }
  const url = new URL(request.url);
  // Next may normalize Request.url to its bind address. Host retains the direct request authority.
  return new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`).origin;
}

export function getSearchService(): SearchService {
  if (service) return service;
  const root = loadWebEnvironment();
  const environment = environmentSchema.parse(process.env);
  const created: SearchService = createSearchService({
    databaseUrl: environment.DATABASE_URL,
    readOnlyDatabaseUrl: environment.GIA_DATABASE_URL,
    projectDirectory: resolve(root, environment.GIA_PROJECT_DIR),
    runtimeUrl: environment.GIA_API_URL,
    runtimeApiKey: environment.GIA_API_KEY,
    profileId: environment.GIA_ACTIVE_PROFILE,
    timeoutMs: environment.SEARCH_TIMEOUT_MS,
    maximumDailySearches: environment.SEARCH_MAXIMUM_DAILY_SEARCHES,
  });
  service = created;
  return created;
}
