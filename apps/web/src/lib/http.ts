import "server-only";

import { randomUUID } from "node:crypto";
import type { SearchOutcome } from "@gia-github/search/contracts";

export function failureResponse(status: number, code: string, message: string) {
  return Response.json(
    {
      kind: "failed",
      requestId: randomUUID(),
      code,
      message,
      retryable: status >= 500,
    } satisfies SearchOutcome,
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export class RequestBodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readSearchBody(request: Request): Promise<unknown> {
  const maximumBytes = 12_288;
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) {
    throw new RequestBodyError(415, "Send the search as application/json.");
  }
  if (Number(request.headers.get("content-length")) > maximumBytes) {
    throw new RequestBodyError(413, "The search request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError(400, "A search question is required.");
  let bytes = 0;
  let body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      request.signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyError(413, "The search request is too large.");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof RequestBodyError || request.signal.aborted) throw error;
    throw new RequestBodyError(400, "The search request must contain valid JSON.");
  } finally {
    reader.releaseLock();
  }
}
