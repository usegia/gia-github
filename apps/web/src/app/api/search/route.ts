import { searchInputSchema, searchOutcomeSchema } from "@gia-github/search/contracts";
import { failureResponse, RequestBodyError, readSearchBody } from "@/lib/http";
import { getSearchService } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (
    origin !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return failureResponse(403, "ORIGIN_REJECTED", "Submit searches from this application.");
  }
  try {
    const input = searchInputSchema.safeParse(await readSearchBody(request));
    if (!input.success) {
      return failureResponse(
        400,
        "INVALID_SEARCH",
        "Use a question of 3–2,000 characters and a result limit between 1 and 50.",
      );
    }
    const outcome = searchOutcomeSchema.parse(
      await getSearchService().search({
        ...input.data,
        // A shared admission bucket is conservative on deployments without a verified proxy identity.
        clientKey: "public-web",
        signal: request.signal,
      }),
    );
    return Response.json(outcome, {
      status: outcome.kind === "failed" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (request.signal.aborted) {
      return failureResponse(499, "SEARCH_CANCELLED", "The search was cancelled.");
    }
    if (error instanceof RequestBodyError) {
      return failureResponse(error.status, "INVALID_REQUEST", error.message);
    }
    return failureResponse(
      503,
      "SEARCH_UNAVAILABLE",
      "Search is unavailable right now. Please try again shortly.",
    );
  }
}
