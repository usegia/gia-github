import { personSchema } from "@gia-github/search/contracts";
import { z } from "zod";
import { failureResponse } from "@/lib/http";
import { getSearchService } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ login: string }> }) {
  const login = z
    .string()
    .regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i)
    .safeParse((await params).login);
  if (!login.success) return failureResponse(400, "INVALID_LOGIN", "Use a valid GitHub username.");
  try {
    const person = await getSearchService().person(login.data);
    if (!person)
      return failureResponse(
        404,
        "PERSON_NOT_COLLECTED",
        "This profile is not in the current collection.",
      );
    return Response.json(personSchema.parse(person), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return failureResponse(503, "PROFILE_UNAVAILABLE", "This profile is temporarily unavailable.");
  }
}
