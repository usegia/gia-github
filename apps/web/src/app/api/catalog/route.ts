import { catalogSchema } from "@gia-github/search/contracts";
import { failureResponse } from "@/lib/http";
import { getSearchService } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const catalog = catalogSchema.parse(await getSearchService().catalog());
    return Response.json(catalog, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return failureResponse(
      503,
      "CATALOG_UNAVAILABLE",
      "Collection details are temporarily unavailable.",
    );
  }
}
