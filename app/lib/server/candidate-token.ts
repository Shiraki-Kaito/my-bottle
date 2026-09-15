import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getSerpApiKey, SerpApiError } from "./serpapi-client";

const TOKEN_LIFETIME_MS = 10 * 60 * 1000;
const MAX_TOKEN_LENGTH = 4_096;

export type CandidateTokenPayload = {
  title: string;
  source: string;
  expiresAt: number;
};

function createSignature(encodedPayload: string): Buffer {
  return createHmac("sha256", getSerpApiKey())
    .update(`my-bottle-candidate-v1.${encodedPayload}`)
    .digest();
}

export function createCandidateToken(title: string, source: string): string {
  const payload: CandidateTokenPayload = {
    title,
    source,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = createSignature(encodedPayload).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyCandidateToken(token: string): CandidateTokenPayload {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    throw new SerpApiError("invalid_request", false);
  }

  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) {
    throw new SerpApiError("invalid_request", false);
  }

  const actualSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = createSignature(encodedPayload);
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new SerpApiError("invalid_request", false);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    throw new SerpApiError("invalid_request", false);
  }

  const candidate = payload as Partial<CandidateTokenPayload>;
  if (
    typeof candidate.title !== "string" ||
    candidate.title.length < 1 ||
    candidate.title.length > 300 ||
    typeof candidate.source !== "string" ||
    candidate.source.length > 160 ||
    typeof candidate.expiresAt !== "number" ||
    candidate.expiresAt < Date.now()
  ) {
    throw new SerpApiError("invalid_request", false);
  }

  return candidate as CandidateTokenPayload;
}
