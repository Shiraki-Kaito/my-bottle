import "server-only";

import { loadBuffer, type CheerioAPI } from "cheerio";
import { fetchSafeRemoteResource } from "./safe-remote-resource";

const MAX_HTML_SIZE = 1_500_000;
const MAX_IMAGE_SIZE = 500_000;
const PAGE_TIMEOUT_MS = 5_500;
const IMAGE_TIMEOUT_MS = 4_000;
const MAX_JSON_LD_NODES = 1_000;

const HTML_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type UnknownRecord = Record<string, unknown>;

export type ProductPageMetadata = {
  additionalTexts: string[];
  brand: string | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  manufacturerLocation: string | null;
  name: string | null;
  namePriority: number;
  productionLocation: string | null;
  schemaProductFound: boolean;
  sourceSite: string | null;
  sourceUrl: string;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function cleanString(value: unknown, maxLength = 600): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function valueText(value: unknown, maxLength = 160): string | null {
  const direct = cleanString(value, maxLength);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = valueText(item, maxLength);
      if (result) return result;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  return (
    valueText(record.name, maxLength) ??
    valueText(record.value, maxLength) ??
    valueText(record["@value"], maxLength)
  );
}

function normalizeType(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    const text = cleanString(item, 160);
    return text
      ? text
          .split(/[\s,]+/)
          .map((part) => part.toLocaleLowerCase("en-US").replace(/\/$/, ""))
      : [];
  });
}

function isProductType(value: unknown): boolean {
  return normalizeType(value).some(
    (type) => type === "product" || type.endsWith("schema.org/product"),
  );
}

function collectJsonLdProducts(
  value: unknown,
  products: UnknownRecord[],
  state: { count: number },
  depth = 0,
): void {
  if (depth > 10 || state.count >= MAX_JSON_LD_NODES) return;
  state.count += 1;
  if (Array.isArray(value)) {
    for (const child of value) {
      collectJsonLdProducts(child, products, state, depth + 1);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  if (isProductType(record["@type"])) products.push(record);
  for (const child of Object.values(record)) {
    if (typeof child === "object" && child !== null) {
      collectJsonLdProducts(child, products, state, depth + 1);
    }
  }
}

function parseJsonLdProducts($: CheerioAPI): UnknownRecord[] {
  const products: UnknownRecord[] = [];
  const state = { count: 0 };
  $('script[type*="ld+json"]')
    .slice(0, 30)
    .each((_, element) => {
      const source = $(element)
        .text()
        .trim()
        .replace(/^<!--\s*/, "")
        .replace(/\s*-->$/, "")
        .replace(/;\s*$/, "");
      if (!source) return;
      try {
        collectJsonLdProducts(JSON.parse(source), products, state);
      } catch {
        // 壊れたJSON-LDは無視し、次の抽出方法へ進む。
      }
    });
  return products;
}

function propertyValue(record: UnknownRecord, key: string): string | null {
  return valueText(record[key]);
}

function imageValue(value: unknown): string | null {
  const direct = cleanString(value, 2_000);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = imageValue(item);
      if (result) return result;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  return (
    imageValue(record.url) ??
    imageValue(record.contentUrl) ??
    imageValue(record.thumbnailUrl)
  );
}

function extractAddress(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return cleanString(value, 120);
  const address = asRecord(record.address) ?? record;
  const parts = [
    valueText(address.addressCountry, 60),
    valueText(address.addressRegion, 60),
    valueText(address.addressLocality, 60),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? [...new Set(parts)].join(" ").slice(0, 120) : null;
}

function extractAdditionalTexts(product: UnknownRecord): string[] {
  const properties = product.additionalProperty;
  const values = Array.isArray(properties) ? properties : [properties];
  const texts: string[] = [];
  for (const value of values) {
    const record = asRecord(value);
    if (!record) continue;
    const name = valueText(record.name, 80) ?? valueText(record.propertyID, 80);
    const property = valueText(record.value, 160) ?? valueText(record.valueReference, 160);
    if (name && property) texts.push(`${name}: ${property}`);
  }
  return texts.slice(0, 30);
}

function scoreProduct(product: UnknownRecord, pageTitle: string | null): number {
  const completeness = [
    propertyValue(product, "name"),
    valueText(product.brand),
    valueText(product.manufacturer),
    imageValue(product.image),
    propertyValue(product, "category"),
    valueText(product.countryOfOrigin),
    propertyValue(product, "description"),
  ].filter(Boolean).length;
  const productName = propertyValue(product, "name");
  if (!productName || !pageTitle) return completeness;
  const normalizedProductName = productName
    .toLocaleLowerCase("ja-JP")
    .replace(/[^\p{L}\p{N}]/gu, "");
  const normalizedPageTitle = pageTitle
    .toLocaleLowerCase("ja-JP")
    .replace(/[^\p{L}\p{N}]/gu, "");
  const shorter =
    normalizedProductName.length <= normalizedPageTitle.length
      ? normalizedProductName
      : normalizedPageTitle;
  const longer =
    normalizedProductName.length > normalizedPageTitle.length
      ? normalizedProductName
      : normalizedPageTitle;
  const titleScore =
    shorter.length >= 4 && longer.includes(shorter)
      ? 5 * (shorter.length / longer.length)
      : 0;
  return completeness + titleScore;
}

function getMeta(
  $: CheerioAPI,
  selector: string,
  maxLength = 600,
): string | null {
  return cleanString($(selector).first().attr("content"), maxLength);
}

function getStructuredProperty(
  $: CheerioAPI,
  scope: ReturnType<CheerioAPI>,
  property: string,
  maxLength = 600,
): string | null {
  const element = scope.find(`[itemprop~="${property}"], [property~="${property}"]`).first();
  if (element.length === 0) return null;
  const nestedName = element
    .find('[itemprop~="name"], [property~="name"]')
    .first();
  return (
    cleanString(element.attr("content"), maxLength) ??
    cleanString(element.attr("href"), maxLength) ??
    cleanString(element.attr("src"), maxLength) ??
    cleanString(nestedName.attr("content"), maxLength) ??
    cleanString(nestedName.text(), maxLength) ??
    cleanString(element.text(), maxLength)
  );
}

function extractStructuredAdditionalTexts(
  $: CheerioAPI,
  scope: ReturnType<CheerioAPI>,
): string[] {
  const texts: string[] = [];
  scope
    .find('[itemprop~="additionalProperty"], [property~="additionalProperty"]')
    .slice(0, 30)
    .each((_, element) => {
      const property = $(element);
      const nameElement = property
        .find('[itemprop~="name"], [property~="name"]')
        .first();
      const valueElement = property
        .find('[itemprop~="value"], [property~="value"]')
        .first();
      const name = cleanString(
        nameElement.attr("content") ?? nameElement.text(),
        80,
      );
      const value = cleanString(
        valueElement.attr("content") ?? valueElement.text(),
        160,
      );
      if (name && value) texts.push(`${name}: ${value}`);
    });
  return texts;
}

function resolveHttpUrl(value: string | null, baseUrl: URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.href.length > 2_048
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export async function fetchProductPageMetadata(
  sourceUrl: string,
): Promise<ProductPageMetadata> {
  const response = await fetchSafeRemoteResource(sourceUrl, {
    accept: "text/html,application/xhtml+xml;q=0.9",
    allowedContentTypes: HTML_CONTENT_TYPES,
    maxBytes: MAX_HTML_SIZE,
    timeoutMs: PAGE_TIMEOUT_MS,
  });
  const $ = loadBuffer(response.body, {
    baseURI: response.finalUrl.href,
    scriptingEnabled: false,
  });

  const openGraphName = getMeta($, 'meta[property="og:title"]', 300);
  const metaName =
    getMeta($, 'meta[name="twitter:title"]', 300) ??
    cleanString($("title").first().text(), 300);
  const pageTitle = openGraphName ?? metaName;
  const jsonLdProducts = parseJsonLdProducts($).sort(
    (left, right) =>
      scoreProduct(right, pageTitle) - scoreProduct(left, pageTitle),
  );
  const product = jsonLdProducts[0] ?? null;
  const productScope = $(
    '[itemscope][itemtype*="schema.org/Product"], [typeof~="Product"], [typeof$=":Product"], [typeof*="schema.org/Product"]',
  ).first();

  const jsonLdName = product ? propertyValue(product, "name") : null;
  const structuredName = productScope.length
    ? getStructuredProperty($, productScope, "name", 300)
    : null;
  const name = jsonLdName ?? structuredName ?? openGraphName ?? metaName;
  const namePriority = jsonLdName
    ? 1
    : structuredName
      ? 2
      : openGraphName
        ? 3
        : metaName
          ? 4
          : 0;

  const jsonLdBrand = product
    ? valueText(product.brand) ?? valueText(product.manufacturer)
    : null;
  const structuredBrand = productScope.length
    ? getStructuredProperty($, productScope, "brand", 120) ??
      getStructuredProperty($, productScope, "manufacturer", 120)
    : null;
  const metaBrand =
    getMeta($, 'meta[property="product:brand"]', 120) ??
    getMeta($, 'meta[name="brand"]', 120);

  const jsonLdDescription = product
    ? propertyValue(product, "description")
    : null;
  const structuredDescription = productScope.length
    ? getStructuredProperty($, productScope, "description")
    : null;
  const openGraphDescription = getMeta(
    $,
    'meta[property="og:description"]',
  );
  const metaDescription = getMeta($, 'meta[name="description"]');
  const description =
    jsonLdDescription ??
    structuredDescription ??
    openGraphDescription ??
    metaDescription;

  const jsonLdImage = product ? imageValue(product.image) : null;
  const structuredImage = productScope.length
    ? getStructuredProperty($, productScope, "image", 2_000)
    : null;
  const openGraphImage =
    getMeta($, 'meta[property="og:image:secure_url"]', 2_000) ??
    getMeta($, 'meta[property="og:image"]', 2_000);
  const metaImage = getMeta($, 'meta[name="twitter:image"]', 2_000);

  const countryOfOrigin = product ? valueText(product.countryOfOrigin) : null;
  const manufacturerLocation = product
    ? extractAddress(asRecord(product.manufacturer)?.address)
    : null;
  const structuredCountry = productScope.length
    ? getStructuredProperty($, productScope, "countryOfOrigin", 120)
    : null;
  const structuredManufacturer = productScope.length
    ? productScope
        .find('[itemprop~="manufacturer"], [property~="manufacturer"]')
        .first()
    : productScope;
  const structuredManufacturerLocation = structuredManufacturer.length
    ? [
        getStructuredProperty($, structuredManufacturer, "addressCountry", 60),
        getStructuredProperty($, structuredManufacturer, "addressRegion", 60),
        getStructuredProperty($, structuredManufacturer, "addressLocality", 60),
      ]
        .filter((part): part is string => Boolean(part))
        .join(" ") || null
    : null;
  const structuredAdditionalTexts = productScope.length
    ? extractStructuredAdditionalTexts($, productScope)
    : [];

  return {
    additionalTexts: [
      ...(product ? extractAdditionalTexts(product) : []),
      ...structuredAdditionalTexts,
    ].slice(0, 30),
    brand: jsonLdBrand ?? structuredBrand ?? metaBrand,
    category:
      (product ? propertyValue(product, "category") : null) ??
      (productScope.length
        ? getStructuredProperty($, productScope, "category", 160)
        : null) ??
      getMeta($, 'meta[property="product:category"]', 160),
    description,
    imageUrl: resolveHttpUrl(
      jsonLdImage ?? structuredImage ?? openGraphImage ?? metaImage,
      response.finalUrl,
    ),
    manufacturerLocation:
      manufacturerLocation ?? structuredManufacturerLocation,
    name,
    namePriority,
    productionLocation: countryOfOrigin ?? structuredCountry,
    schemaProductFound: Boolean(product || productScope.length),
    sourceSite:
      getMeta($, 'meta[property="og:site_name"]', 160) ??
      response.finalUrl.hostname,
    sourceUrl: response.finalUrl.href,
  };
}

export async function downloadProductImage(
  imageUrl: string,
): Promise<string | null> {
  try {
    const response = await fetchSafeRemoteResource(imageUrl, {
      accept: "image/jpeg,image/png,image/webp",
      allowedContentTypes: IMAGE_CONTENT_TYPES,
      maxBytes: MAX_IMAGE_SIZE,
      timeoutMs: IMAGE_TIMEOUT_MS,
    });
    return `data:${response.contentType};base64,${response.body.toString("base64")}`;
  } catch {
    return null;
  }
}
