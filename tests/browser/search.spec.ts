import { catalogSchema, personSchema, searchOutcomeSchema } from "@gia-github/search/contracts";
import { expect, test } from "@playwright/test";

const memberQuestion =
  "Find human GitHub accounts who are public members of Vercel and authored a merged pull request in an indexed repository from June 12, 2026 inclusive to September 11, 2026 exclusive. Return each person once.";

test("restores a question and reads real collection data without submitting a search", async ({
  page,
}) => {
  const searchRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/search")
      searchRequests.push(request.url());
  });
  const catalogResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/catalog",
  );
  await page.goto(`/?q=${encodeURIComponent(memberQuestion)}`);
  const catalog = catalogSchema.parse(await (await catalogResponse).json());
  expect(catalog.coverage.people).toBeGreaterThan(100);
  expect(catalog.coverage.repositories).toBeGreaterThan(0);
  expect(catalog.coverage.pullRequests).toBeGreaterThan(0);
  await expect(page.getByLabel("Describe the people you want to find")).toHaveValue(memberQuestion);
  await expect(page.getByRole("heading", { name: "Inside the collection" })).toBeVisible();
  await expect(page.locator("#collection dd").first()).toHaveText(String(catalog.coverage.people));
  expect(searchRequests).toHaveLength(0);
  const example = page.locator(".example-query").first();
  await expect(example).toBeVisible();
  await example.click();
  await expect(page.getByLabel("Describe the people you want to find")).toBeFocused();
  expect(searchRequests).toHaveLength(0);
});

test("searches actual membership and contribution records, then opens source context", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.getByLabel("Describe the people you want to find").fill(memberQuestion);
  const result = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/search",
  );
  await page.getByLabel("Describe the people you want to find").press("Enter");
  const outcome = searchOutcomeSchema.parse(await (await result).json());
  expect(outcome.kind, JSON.stringify(outcome)).toBe("matches");
  if (outcome.kind !== "matches")
    throw new Error("Real Gia did not produce a completed match result");
  expect(outcome.people.map((person) => person.login)).toEqual(
    expect.arrayContaining(["n1ckoates", "HugoRCD"]),
  );
  expect(new Set(outcome.people.map((person) => person.id)).size).toBe(outcome.people.length);
  const card = page.locator('[data-testid="person-card"][data-login="n1ckoates"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("Public member:");
  await card.getByRole("button", { name: "Public activity", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("do not, by themselves, explain why a search matched");
  const sourceLinks = sheet.locator('.activity-item a[href^="https://github.com/"]');
  await expect(sourceLinks.first()).toBeVisible();
  expect(await sourceLinks.count()).toBeGreaterThan(0);
  await expect(sheet).toContainText("Observed");
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(card.getByRole("button", { name: "Public activity", exact: true })).toBeFocused();
  await card.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/people\/n1ckoates$/);
  await expect(page.getByRole("heading", { name: "Collected public activity" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/n1ckoates",
  );
});

test("shows a supported empty result without implying missing public work", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page
    .getByLabel("Describe the people you want to find")
    .fill(
      "Find human GitHub accounts whose login is n1ckoates and who have more than one billion followers.",
    );
  const result = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/search",
  );
  await page.getByRole("button", { name: "Find people", exact: true }).click();
  const outcome = searchOutcomeSchema.parse(await (await result).json());
  expect(outcome.kind, JSON.stringify(outcome)).toBe("matches");
  if (outcome.kind !== "matches")
    throw new Error("Expected Gia to evaluate the supported empty query");
  expect(outcome.people).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "No people matched in this collection" }),
  ).toBeVisible();
  await expect(
    page.getByText("Missing collection coverage does not mean the work never happened.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("person-card")).toHaveCount(0);
});

test("rejects invalid, oversized, and cross-origin requests before search admission", async ({
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Browser integration requires the real application's baseURL");
  const origin = new URL(baseURL).origin;
  const invalid = await request.post("/api/search", {
    headers: { Origin: origin },
    data: { question: "a" },
  });
  expect(invalid.status()).toBe(400);
  const invalidOutcome = searchOutcomeSchema.parse(await invalid.json());
  expect(invalidOutcome.kind).toBe("failed");
  const oversized = await request.post("/api/search", {
    headers: { Origin: origin },
    data: { question: "a".repeat(13_000) },
  });
  expect(oversized.status()).toBe(413);
  const crossOrigin = await request.post("/api/search", {
    headers: { Origin: "https://example.org" },
    data: { question: memberQuestion },
  });
  expect(crossOrigin.status()).toBe(403);
  const malformed = await request.post("/api/search", {
    headers: { Origin: origin, "Content-Type": "application/json" },
    data: "{",
  });
  expect(malformed.status()).toBe(400);
  const wrongMediaType = await request.post("/api/search", {
    headers: { Origin: origin, "Content-Type": "application/jsonp" },
    data: JSON.stringify({ question: memberQuestion }),
  });
  expect(wrongMediaType.status()).toBe(415);
});

test("renders an actual profile on mobile and distinguishes an uncollected profile", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/people/n1ckoates");
  expect(response.status()).toBe(200);
  const person = personSchema.parse(await response.json());
  expect(person.login).toBe("n1ckoates");
  expect(person.context.length).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/people/n1ckoates");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(person.name || person.login);
  await expect(page.getByText(`@${person.login}`, { exact: true })).toBeVisible();
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflowing).toBe(false);
  await page.goto("/people/gia-github-uncollected-profile");
  await expect(page.getByRole("heading", { name: "This page is not in our index." })).toBeVisible();
  await expect(
    page.getByText("A missing profile means we have not collected it.", { exact: false }),
  ).toBeVisible();
});
