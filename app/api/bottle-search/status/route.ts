import {
  isSerpApiConfigured,
} from "@/app/lib/server/serpapi-client";
import { noStoreJson } from "@/app/lib/server/route-response";

export const dynamic = "force-dynamic";

export function GET() {
  return noStoreJson({ available: isSerpApiConfigured() });
}
