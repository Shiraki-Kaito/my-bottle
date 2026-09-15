import type { BottleSearchDetails, SearchCandidate } from "./types";

export type BottleSearchErrorCode =
  | "invalid_request"
  | "not_configured"
  | "no_results"
  | "rate_limited"
  | "upstream_error";

type ErrorPayload = {
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
};

export class BottleSearchError extends Error {
  constructor(
    message: string,
    readonly code: BottleSearchErrorCode,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BottleSearchError";
  }
}

export interface BottleSearchService {
  getAvailability(signal?: AbortSignal): Promise<boolean>;
  searchSimilar(image: Blob): Promise<SearchCandidate[]>;
  searchDetails(lookupToken: string): Promise<BottleSearchDetails>;
}

function isErrorCode(value: unknown): value is BottleSearchErrorCode {
  return (
    value === "invalid_request" ||
    value === "not_configured" ||
    value === "no_results" ||
    value === "rate_limited" ||
    value === "upstream_error"
  );
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload ?? {}) as ErrorPayload;
    const code = isErrorCode(error.code) ? error.code : "upstream_error";
    const message =
      typeof error.message === "string"
        ? error.message
        : "画像検索を完了できませんでした。";
    throw new BottleSearchError(message, code, error.retryable === true);
  }

  return payload as T;
}

class ApiBottleSearchService implements BottleSearchService {
  async getAvailability(signal?: AbortSignal): Promise<boolean> {
    const response = await fetch("/api/bottle-search/status", {
      cache: "no-store",
      signal,
    });
    const payload = await readResponse<{ available?: unknown }>(response);
    return payload.available === true;
  }

  async searchSimilar(image: Blob): Promise<SearchCandidate[]> {
    const formData = new FormData();
    formData.append("image", image, "bottle.jpg");

    const response = await fetch("/api/bottle-search/candidates", {
      body: formData,
      method: "POST",
    });
    const payload = await readResponse<{ candidates?: unknown }>(response);

    if (!Array.isArray(payload.candidates)) {
      throw new BottleSearchError(
        "候補の形式が正しくありません。",
        "upstream_error",
        true,
      );
    }

    return payload.candidates as SearchCandidate[];
  }

  async searchDetails(lookupToken: string): Promise<BottleSearchDetails> {
    const response = await fetch("/api/bottle-search/details", {
      body: JSON.stringify({ lookupToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return readResponse<BottleSearchDetails>(response);
  }
}

export const bottleSearchService: BottleSearchService =
  new ApiBottleSearchService();
