import { createSearchCandidates } from "@/app/lib/server/bottle-search";
import {
  errorResponse,
  isSameOriginRequest,
  noStoreJson,
} from "@/app/lib/server/route-response";
import {
  searchGoogleLens,
  SerpApiError,
  uploadImageToSerpApi,
} from "@/app/lib/server/serpapi-client";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 500_000;
const MAX_REQUEST_SIZE = 600_000;

function detectImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) {
      throw new SerpApiError("invalid_request", false);
    }
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      throw new SerpApiError("invalid_request", false);
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
      throw new SerpApiError("invalid_request", false);
    }

    const formData = await request.formData();
    const image = formData.get("image");
    if (!(image instanceof File) || image.size < 1 || image.size >= MAX_IMAGE_SIZE) {
      throw new SerpApiError("invalid_request", false);
    }

    const bytes = new Uint8Array(await image.arrayBuffer());
    const contentType = detectImageType(bytes);
    if (!contentType) throw new SerpApiError("invalid_request", false);

    const safeImage = new Blob([bytes], { type: contentType });
    const imageId = await uploadImageToSerpApi(safeImage);
    const lensResult = await searchGoogleLens(imageId);
    const candidates = await createSearchCandidates(lensResult);
    if (candidates.length === 0) {
      throw new SerpApiError("no_results", true);
    }

    return noStoreJson({ candidates });
  } catch (cause) {
    return errorResponse(cause);
  }
}
