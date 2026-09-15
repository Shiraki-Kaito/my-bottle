import { extractBottleDetails } from "@/app/lib/server/bottle-search";
import { verifyCandidateToken } from "@/app/lib/server/candidate-token";
import {
  errorResponse,
  isSameOriginRequest,
  noStoreJson,
} from "@/app/lib/server/route-response";
import {
  searchGoogleProduct,
  SerpApiError,
} from "@/app/lib/server/serpapi-client";

export const runtime = "nodejs";

const MAX_REQUEST_SIZE = 8_192;

export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) {
      throw new SerpApiError("invalid_request", false);
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      throw new SerpApiError("invalid_request", false);
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
      throw new SerpApiError("invalid_request", false);
    }

    const body: unknown = await request.json();
    const lookupToken =
      body && typeof body === "object" && "lookupToken" in body
        ? (body as { lookupToken?: unknown }).lookupToken
        : null;
    if (typeof lookupToken !== "string") {
      throw new SerpApiError("invalid_request", false);
    }

    const candidate = verifyCandidateToken(lookupToken);
    const searchResult = await searchGoogleProduct(candidate.title);
    return noStoreJson(extractBottleDetails(searchResult, candidate));
  } catch (cause) {
    return errorResponse(cause);
  }
}
