import "server-only";

const SERPAPI_ORIGIN = "https://serpapi.com";

export type SerpApiErrorCode =
  | "invalid_request"
  | "not_configured"
  | "no_results"
  | "rate_limited"
  | "upstream_error";

export class SerpApiError extends Error {
  constructor(
    readonly code: SerpApiErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "SerpApiError";
  }
}

type SerpApiResponse = {
  error?: unknown;
  search_metadata?: {
    status?: unknown;
  };
};

export function isSerpApiConfigured(): boolean {
  return Boolean(process.env.SERPAPI_KEY?.trim());
}

export function getSerpApiKey(): string {
  const key = process.env.SERPAPI_KEY?.trim();
  if (!key) {
    throw new SerpApiError("not_configured", false);
  }
  return key;
}

function classifyError(status: number, message: string): SerpApiError {
  if (status === 429) return new SerpApiError("rate_limited", true);
  if (/hasn['’]t returned any results|no results/i.test(message)) {
    return new SerpApiError("no_results", true);
  }
  if (status === 400) return new SerpApiError("invalid_request", false);
  if (status === 401 || status === 403) {
    return new SerpApiError("upstream_error", false);
  }
  return new SerpApiError("upstream_error", status >= 500 || status === 0);
}

async function fetchJson<T>(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    const serpPayload = (payload ?? {}) as SerpApiResponse;
    const message =
      typeof serpPayload.error === "string" ? serpPayload.error : "";

    const searchFailed = serpPayload.search_metadata?.status === "Error";
    if (!response.ok || message || searchFailed) {
      const effectiveStatus = response.ok && (message || searchFailed)
        ? 503
        : response.status;
      throw classifyError(effectiveStatus, message);
    }

    return payload as T;
  } catch (cause) {
    if (cause instanceof SerpApiError) throw cause;
    throw new SerpApiError("upstream_error", true);
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadImageToSerpApi(image: Blob): Promise<string> {
  const formData = new FormData();
  const extension =
    image.type === "image/png"
      ? "png"
      : image.type === "image/webp"
        ? "webp"
        : "jpg";
  formData.append("image", image, `bottle.${extension}`);
  formData.append("api_key", getSerpApiKey());

  const payload = await fetchJson<{ image_id?: unknown }>(
    `${SERPAPI_ORIGIN}/image`,
    { body: formData, method: "POST" },
    15_000,
  );

  if (typeof payload.image_id !== "string" || !payload.image_id) {
    throw new SerpApiError("upstream_error", true);
  }
  return payload.image_id;
}

export async function searchGoogleLens(imageId: string): Promise<unknown> {
  const url = new URL("/search.json", SERPAPI_ORIGIN);
  url.searchParams.set("api_key", getSerpApiKey());
  url.searchParams.set("engine", "google_lens");
  url.searchParams.set("image_id", imageId);
  url.searchParams.set("type", "products");
  url.searchParams.set("hl", "ja");
  url.searchParams.set("country", "jp");
  url.searchParams.set("safe", "active");
  url.searchParams.set("auto_crop", "false");
  url.searchParams.set(
    "json_restrictor",
    "error,search_metadata.status,visual_matches[0:10].{position,title,source,link,thumbnail}",
  );

  return fetchJson<unknown>(url, { method: "GET" }, 25_000);
}

export async function searchGoogleProduct(query: string): Promise<unknown> {
  const url = new URL("/search.json", SERPAPI_ORIGIN);
  url.searchParams.set("api_key", getSerpApiKey());
  url.searchParams.set("engine", "google");
  url.searchParams.set(
    "q",
    `${query} 商品情報 ブランド メーカー 種類 アルコール度数 ABV`,
  );
  url.searchParams.set("google_domain", "google.co.jp");
  url.searchParams.set("hl", "ja");
  url.searchParams.set("gl", "jp");
  url.searchParams.set("safe", "active");
  url.searchParams.set(
    "json_restrictor",
    "error,search_metadata.status,knowledge_graph,answer_box,product_result.{title},shopping_results[0:5].{title,source,snippet,extensions},product_sites[0:5].{title,source},organic_results[0:8].{title,source,snippet,extensions,rich_snippet}",
  );

  return fetchJson<unknown>(url, { method: "GET" }, 20_000);
}
