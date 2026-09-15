import "server-only";

import { SerpApiError, type SerpApiErrorCode } from "./serpapi-client";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

const ERROR_RESPONSES: Record<
  SerpApiErrorCode,
  { message: string; retryable: boolean; status: number }
> = {
  invalid_request: {
    message: "送信内容を確認してください。",
    retryable: false,
    status: 400,
  },
  not_configured: {
    message: "画像検索を利用できません。手入力で登録してください。",
    retryable: false,
    status: 503,
  },
  no_results: {
    message: "商品候補が見つかりませんでした。",
    retryable: true,
    status: 404,
  },
  rate_limited: {
    message: "検索の利用上限に達しました。時間をおいて試すか、手入力してください。",
    retryable: false,
    status: 429,
  },
  upstream_error: {
    message: "画像検索を完了できませんでした。",
    retryable: true,
    status: 502,
  },
};

export function noStoreJson(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { ...RESPONSE_HEADERS, ...init?.headers },
  });
}

export function errorResponse(cause: unknown): Response {
  const code =
    cause instanceof SerpApiError ? cause.code : ("upstream_error" as const);
  const definition = ERROR_RESPONSES[code];
  return noStoreJson(
    {
      code,
      message: definition.message,
      retryable:
        cause instanceof SerpApiError
          ? definition.retryable && cause.retryable
          : definition.retryable,
    },
    { status: definition.status },
  );
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
