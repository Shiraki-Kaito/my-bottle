import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestOptions,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 2_048;
const DNS_TIMEOUT_MS = 2_000;
const BLOCKED_HOSTNAME_PATTERN = /(?:^|\.)(?:localhost|local|internal)$/i;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export type SafeRemoteResource = {
  body: Buffer;
  contentType: string;
  finalUrl: URL;
};

type FetchSafeRemoteResourceOptions = {
  accept: string;
  allowedContentTypes: ReadonlySet<string>;
  maxBytes: number;
  timeoutMs: number;
};

type SingleResponse = {
  body?: Buffer;
  contentType?: string;
  headers: IncomingHttpHeaders;
  status: number;
};

function createRemoteUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  if (
    url.href.length > MAX_URL_LENGTH ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    (url.protocol === "http:" && url.port && url.port !== "80") ||
    (url.protocol === "https:" && url.port && url.port !== "443") ||
    !url.hostname ||
    BLOCKED_HOSTNAME_PATTERN.test(url.hostname)
  ) {
    throw new Error("unsafe remote URL");
  }
  return url;
}

function isBlockedAddress(address: string, family: number): boolean {
  return blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

async function createPinnedLookup(url: URL): Promise<LookupFunction> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  let addresses: Array<{ address: string; family: number }>;
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      addresses = await Promise.race([
        dnsLookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("DNS lookup timed out")),
            DNS_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => isBlockedAddress(address, family))
  ) {
    throw new Error("blocked remote address");
  }

  const selected = addresses[0];
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [selected]);
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

function requestOnce(
  url: URL,
  lookup: LookupFunction,
  options: FetchSafeRemoteResourceOptions,
): Promise<SingleResponse> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (cause?: Error, response?: SingleResponse) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (cause) reject(cause);
      else if (response) resolve(response);
    };
    const requestOptions: RequestOptions = {
      headers: {
        Accept: options.accept,
        "Accept-Encoding": "identity",
        Connection: "close",
        "User-Agent": "MyBottleShelf/1.0 product-metadata-fetcher",
      },
      lookup,
      maxHeaderSize: 16_384,
      method: "GET",
    };
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requester(url, requestOptions, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        finish(undefined, { headers: response.headers, status });
        return;
      }
      if (status !== 200) {
        response.destroy();
        finish(new Error("remote response failed"));
        return;
      }

      const contentEncoding = response.headers["content-encoding"];
      if (contentEncoding && contentEncoding !== "identity") {
        response.destroy();
        finish(new Error("encoded response is not allowed"));
        return;
      }
      const contentType = String(response.headers["content-type"] ?? "")
        .split(";", 1)[0]
        .trim()
        .toLocaleLowerCase("en-US");
      if (!options.allowedContentTypes.has(contentType)) {
        response.destroy();
        finish(new Error("remote content type is not allowed"));
        return;
      }
      const contentLength = Number(response.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
        response.destroy();
        finish(new Error("remote response is too large"));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > options.maxBytes) {
          response.destroy();
          finish(new Error("remote response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        finish(undefined, {
          body: Buffer.concat(chunks, total),
          contentType,
          headers: response.headers,
          status,
        });
      });
      response.once("aborted", () => finish(new Error("remote response aborted")));
      response.once("error", (cause) => finish(cause));
    });
    const timer = setTimeout(
      () => request.destroy(new Error("remote request timed out")),
      options.timeoutMs,
    );
    request.once("error", (cause) => finish(cause));
    request.end();
  });
}

export async function fetchSafeRemoteResource(
  input: string | URL,
  options: FetchSafeRemoteResourceOptions,
): Promise<SafeRemoteResource> {
  let currentUrl = createRemoteUrl(input);
  const visited = new Set<string>();

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (visited.has(currentUrl.href)) throw new Error("redirect loop");
    visited.add(currentUrl.href);

    const pinnedLookup = await createPinnedLookup(currentUrl);
    const response = await requestOnce(currentUrl, pinnedLookup, options);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error("invalid remote redirect");
      }
      currentUrl = createRemoteUrl(new URL(location, currentUrl));
      continue;
    }

    if (!response.body || !response.contentType) {
      throw new Error("empty remote response");
    }
    return {
      body: response.body,
      contentType: response.contentType,
      finalUrl: currentUrl,
    };
  }

  throw new Error("too many redirects");
}
