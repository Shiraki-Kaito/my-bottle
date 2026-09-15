import "server-only";

import { createHash } from "node:crypto";
import type {
  BottleCategory,
  BottleSearchDetails,
  SearchCandidate,
} from "../types";
import { createCandidateToken, type CandidateTokenPayload } from "./candidate-token";
import {
  downloadProductImage,
  fetchProductPageMetadata,
  type ProductPageMetadata,
} from "./product-page";

const MAX_CANDIDATES = 3;
const MAX_PAGE_CANDIDATES = 6;
const MAX_THUMBNAIL_SIZE = 250_000;
const THUMBNAIL_TIMEOUT_MS = 5_000;
const MAX_EVIDENCE_TEXTS = 120;

const COMMERCE_TEXT_PATTERN =
  /(?:通販|オンライン(?:ショップ|ストア)|公式(?:通販|サイト|ストア)|商品(?:詳細|情報|ページ)|販売(?:店|中)?|価格比較|お取り寄せ|送料無料|在庫|購入|カート|ふるさと納税|楽天(?:市場)?|amazon|yahoo!?\s*ショッピング|au\s*pay\s*マーケット|メルカリ|ヤフオク|\b(?:shop|store)\b)/i;
const TITLE_SEPARATOR_PATTERN = /\s*(?:\||｜)\s*|\s+[-–—]\s+|\s+[:：]\s+/;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function normalizeFieldKey(value: string): string {
  return normalizeKey(value).replace(/[\s_-]+/g, "");
}

function normalizeComparable(value: string): string {
  return normalizeKey(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function isSourceSegment(segment: string, source: string): boolean {
  const normalizedSegment = normalizeComparable(segment);
  const normalizedSource = normalizeComparable(source);
  if (normalizedSegment.length < 3 || normalizedSource.length < 3) return false;
  return (
    normalizedSegment.includes(normalizedSource) ||
    normalizedSource.includes(normalizedSegment)
  );
}

function cleanProductTitle(value: unknown, source = ""): string | null {
  const original = cleanText(value, 300);
  if (!original) return null;

  const withoutPromotions = original.replace(
    /[【\[]([^】\]]+)[】\]]/g,
    (match, content: string) =>
      COMMERCE_TEXT_PATTERN.test(content) ||
      /(?:お一人様|ポイント\d+倍|クーポン|セール)/i.test(content)
        ? " "
        : match,
  );
  const segments = withoutPromotions
    .split(TITLE_SEPARATOR_PATTERN)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const productSegments = segments.filter(
    (segment) =>
      !COMMERCE_TEXT_PATTERN.test(segment) &&
      !isSourceSegment(segment, source) &&
      !/^(?:新品|中古|予約商品|\p{Sc}\s*[\d,.]+|[\d,.]+\s*円)$/iu.test(segment),
  );

  const selected = productSegments.length > 0 ? productSegments : segments;
  const cleaned = selected
    .join(" ")
    .replace(/^(?:商品(?:詳細|情報)|製品(?:詳細|情報))\s*[:：-]?\s*/i, "")
    .replace(
      /\s*(?:を?通販(?:で.*)?|の(?:公式)?オンライン(?:ショップ|ストア)|の商品(?:詳細|情報)|価格比較).*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .replace(/^[\s|｜:：\-–—]+|[\s|｜:：\-–—]+$/g, "")
    .trim();

  return cleaned ? cleaned.slice(0, 200) : original.slice(0, 200);
}

function characterSimilarity(left: string, right: string): number {
  const first = normalizeComparable(left);
  const second = normalizeComparable(right);
  if (!first || !second) return 0;
  if (first === second) return 1;

  const shorter = first.length <= second.length ? first : second;
  const longer = first.length > second.length ? first : second;
  if (longer.includes(shorter)) {
    return 0.45 + 0.55 * (shorter.length / longer.length);
  }
  if (first.length < 2 || second.length < 2) return 0;

  const firstPairs = new Map<string, number>();
  for (let index = 0; index < first.length - 1; index += 1) {
    const pair = first.slice(index, index + 2);
    firstPairs.set(pair, (firstPairs.get(pair) ?? 0) + 1);
  }

  let matches = 0;
  for (let index = 0; index < second.length - 1; index += 1) {
    const pair = second.slice(index, index + 2);
    const count = firstPairs.get(pair) ?? 0;
    if (count > 0) {
      matches += 1;
      firstPairs.set(pair, count - 1);
    }
  }
  return (2 * matches) / (first.length + second.length - 2);
}

function extractAlcoholPercentage(texts: string[]): number | null {
  const patterns = [
    /(?:アルコール(?:分|度数|度)?|度数)\s*(?:[:=]|は)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|度)/i,
    /(?:アルコール度数|度数)\s*(?:[:=]|は)\s*(\d{1,3}(?:\.\d+)?)(?=\s|$)/i,
    /(?:ABV|alc(?:ohol)?(?:\s+(?:by\s+volume|content|percentage))?|vol(?:ume)?)\.?\s*(?:[:=]|は)?\s*(\d{1,3}(?:\.\d+)?)\s*%?/i,
    /(\d{1,3}(?:\.\d+)?)\s*(?:%|度)\s*(?:ABV|alc(?:ohol)?(?:\s+by\s+volume)?|アルコール(?:分|度数|度)?)/i,
    /(\d{1,3}(?:\.\d+)?)\s*%\s*vol\.?/i,
  ];

  for (const original of texts) {
    const text = original.normalize("NFKC");
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      const matchEnd = (match.index ?? 0) + match[0].length;
      if (/^\s*(?:off|割引)/i.test(text.slice(matchEnd, matchEnd + 10))) {
        continue;
      }
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0 && value <= 100) return value;
    }
  }
  return null;
}

function extractCategory(texts: string[]): BottleCategory | null {
  for (const value of texts) {
    const text = normalizeKey(value);
    if (/ウイスキー|whisk(?:e)?y|bourbon|scotch|single\s*malt|blended\s*malt/.test(text)) {
      return "ウイスキー";
    }
    if (/ジン|\bgin\b/.test(text)) return "ジン";
    if (/日本酒|清酒|純米|大吟醸|吟醸|本醸造|\bsake\b/.test(text)) {
      return "日本酒";
    }
    if (/ワイン|シャンパン|シャンパーニュ|\bwine\b|\bchampagne\b|\bprosecco\b/.test(text)) {
      return "ワイン";
    }
    if (/ラム酒|\brum\b/.test(text)) return "ラム";
    if (/ウォッカ|\bvodka\b/.test(text)) return "ウォッカ";
    if (/焼酎|芋焼酎|麦焼酎|米焼酎|\bshochu\b/.test(text)) return "焼酎";
    if (/ビール|発泡酒|\bbeer\b|\bale\b|\blager\b/.test(text)) return "ビール";
    if (/リキュール|\bliqueur\b|\bcordial\b/.test(text)) return "リキュール";
    if (/テキーラ|\btequila\b/.test(text)) return "その他";
  }
  return null;
}

function extractVolume(texts: string[]): string | null {
  const labeledPattern =
    /(?:内容量|容量|正味量|net\s*(?:content|volume)|volume|size)\s*(?:[:=]|は)?\s*(\d+(?:\.\d+)?)\s*(ml|cl|l|ミリリットル|センチリットル|リットル)(?=$|[\s)）×xX*,/])/i;
  const plainPattern =
    /(?:^|[\s(（,/])((?:\d+(?:\.\d+)?)\s*(?:ml|cl|l|ミリリットル|センチリットル|リットル))(?=$|[\s)）×xX*,/])/i;

  for (const original of texts) {
    const text = original.normalize("NFKC");
    const labeled = labeledPattern.exec(text);
    if (labeled) return normalizeVolume(labeled[1], labeled[2]);
  }
  for (const original of texts) {
    const text = original.normalize("NFKC");
    const plain = plainPattern.exec(text)?.[1];
    if (!plain) continue;
    const match = /(\d+(?:\.\d+)?)\s*(ml|cl|l|ミリリットル|センチリットル|リットル)/i.exec(
      plain,
    );
    if (match) return normalizeVolume(match[1], match[2]);
  }
  return null;
}

function normalizeVolume(amount: string, rawUnit: string): string {
  const normalizedUnit = normalizeKey(rawUnit);
  const unit =
    normalizedUnit === "ml" || normalizedUnit === "ミリリットル"
      ? "mL"
      : normalizedUnit === "cl" || normalizedUnit === "センチリットル"
        ? "cL"
        : "L";
  return `${Number(amount)}${unit}`;
}

function extractProductionLocation(texts: string[]): string | null {
  const pattern =
    /(?:製造国|原産国|生産国|原産地|製造地|製造場所|蒸留地|醸造地|産地|country\s+of\s+origin|made\s+in|produced\s+in|distilled\s+in)\s*(?:[:=]|は)?\s*([^|｜,，。;；/]{2,80})/i;
  for (const original of texts) {
    const text = original.normalize("NFKC");
    const captured = pattern.exec(text)?.[1]?.replace(
      /\s+(?:内容量|容量|品目|種類|アルコール(?:分|度数|度)?|度数)\s*[:=].*$/i,
      "",
    ).replace(/\s+(?:with|and|using)\b.*$/i, "");
    const value = cleanShortField(captured, 80);
    if (value) return value;
  }
  return null;
}

function cleanShortField(value: unknown, maxLength = 80): string | null {
  const cleaned = cleanText(value, maxLength + 1);
  if (
    !cleaned ||
    cleaned.length > maxLength ||
    COMMERCE_TEXT_PATTERN.test(cleaned) ||
    /https?:\/\/|[<>]|(?:です|ます)[。.!！]/i.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

function cleanSourceSite(value: unknown): string | null {
  const cleaned = cleanText(value, 161);
  if (
    !cleaned ||
    cleaned.length > 160 ||
    /https?:\/\/|[<>]|(?:です|ます)[。.!！]/i.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

function extractFormalProductName(
  value: unknown,
  source: string,
  priority: number,
): string | null {
  const title = cleanProductTitle(value, source);
  if (!title) return null;
  const cleaned = title
    .replace(
      /[（(][^）)]*(?:送料無料|価格|\d+(?:\.\d+)?\s*(?:ml|cl|l)|\d+\s*(?:本|個|缶|ケース|セット|パック))[^）)]*[）)]/giu,
      " ",
    )
    .replace(/(?:￥|¥|\p{Sc})\s*[\d,.]+(?:\s*円)?/gu, " ")
    .replace(/[\d,.]+\s*円/g, " ")
    .replace(
      /\d+(?:\.\d+)?\s*(?:ml|cl|l|ミリリットル|センチリットル|リットル)\s*(?:瓶|ボトル)?(?=$|[\s×xX*,/])/giu,
      " ",
    )
    .replace(/(?:×|x|X|\*)\s*\d+\s*(?:本|個|缶|ケース|セット|パック)?/g, " ")
    .replace(/\d+\s*(?:本|個|缶|ケース|セット|パック)(?:入り)?/g, " ")
    .replace(/\d{1,3}(?:\.\d+)?\s*(?:%|度)(?:\s*(?:ABV|alc\.?))?/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,，・:：\-/]+|[\s,，・:：\-/]+$/g, "")
    .trim();

  if (
    cleaned.length < 2 ||
    cleaned.length > 120 ||
    /[<>]/.test(cleaned) ||
    COMMERCE_TEXT_PATTERN.test(cleaned) ||
    /(?:について|をご紹介|おすすめ\d+選|選び方|ランキング)/.test(cleaned) ||
    (priority >= 5 && (cleaned.length > 80 || (cleaned.match(/[。.!！]/g)?.length ?? 0) > 0))
  ) {
    return null;
  }
  return cleaned;
}

function extractLabeledBrand(texts: string[]): string | null {
  const pattern =
    /(?:ブランド(?:名)?|メーカー(?:名)?(?!希望)|製造(?:者|元|所)|販売者|生産者|醸造元|蔵元|蒸[留溜]所|brand(?:\s+name)?|manufacturer(?:\s+name)?|producer|maker|distillery|winery|brewery)\s*(?:[:=]|は)\s*([^|｜,，。;；/]{1,80})/i;
  for (const original of texts) {
    const text = original.normalize("NFKC");
    const captured = pattern.exec(text)?.[1]?.replace(
      /\s+(?:所在地|住所|販売者|輸入者|原産国|生産国|内容量|容量|品目|種類|アルコール(?:分|度数|度)?|度数)\s*[:=].*$/i,
      "",
    );
    const value = cleanText(captured, 60);
    if (
      value &&
      !COMMERCE_TEXT_PATTERN.test(value) &&
      !/[<>]/.test(value) &&
      !/^(?:\p{Sc}|\d+[,.]?\d*\s*(?:円|ml|l|%|度))/iu.test(value)
    ) {
      return value;
    }
  }
  return null;
}

function findValueByKey(value: unknown, keys: Set<string>, depth = 0): string | null {
  if (depth > 4) return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const result = findValueByKey(child, keys, depth + 1);
      if (result) return result;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;

  for (const [key, child] of Object.entries(record)) {
    if (keys.has(normalizeFieldKey(key))) {
      const childRecord = asRecord(child);
      const result =
        cleanText(child, 80) ??
        cleanText(childRecord?.name, 80) ??
        cleanText(childRecord?.value, 80) ??
        (Array.isArray(child)
          ? child.map((item) => cleanText(item, 80)).find(Boolean) ?? null
          : null);
      if (result) return result;
    }
  }

  for (const child of Object.values(record)) {
    const result = findValueByKey(child, keys, depth + 1);
    if (result) return result;
  }
  return null;
}

function collectPrimitiveTexts(
  value: unknown,
  texts: string[],
  depth = 0,
): void {
  if (depth > 5 || texts.length >= MAX_EVIDENCE_TEXTS) return;
  const text = cleanText(value, 600);
  if (text) {
    texts.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      collectPrimitiveTexts(child, texts, depth + 1);
      if (texts.length >= MAX_EVIDENCE_TEXTS) return;
    }
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === "string" || typeof child === "number") {
      const label = key
        .replace(/([a-z\d])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ");
      const labeledText = cleanText(`${label}: ${String(child)}`, 600);
      if (labeledText) texts.push(labeledText);
    } else {
      collectPrimitiveTexts(child, texts, depth + 1);
    }
    if (texts.length >= MAX_EVIDENCE_TEXTS) return;
  }
}

type SearchSection = {
  record: UnknownRecord;
  title: string | null;
  cleanedTitle: string | null;
  trust: number;
};

function collectSearchSections(
  payload: UnknownRecord,
  candidateTitle: string,
): SearchSection[] {
  const sections: SearchSection[] = [];
  const add = (value: unknown, trust: number, allowMissingTitle = false) => {
    const record = asRecord(value);
    if (!record) return;
    const title = cleanText(record.title, 300);
    const source = cleanText(record.source, 160) ?? "";
    const cleanedTitle = cleanProductTitle(title, source);
    if (
      !allowMissingTitle &&
      (!cleanedTitle || characterSimilarity(candidateTitle, cleanedTitle) < 0.22)
    ) {
      return;
    }
    sections.push({ record, title, cleanedTitle, trust });
  };

  add(payload.product_result, 4);
  add(payload.knowledge_graph, 3);
  add(payload.answer_box, 2, true);

  const addArray = (value: unknown, trust: number, limit: number) => {
    if (!Array.isArray(value)) return;
    for (const item of value.slice(0, limit)) add(item, trust);
  };
  addArray(payload.shopping_results, 2.6, 5);
  addArray(payload.product_sites, 2.4, 5);
  addArray(payload.organic_results, 2, 8);
  return sections;
}

function chooseProductName(
  candidateTitle: string,
  sections: SearchSection[],
): string {
  const options = [
    { name: candidateTitle, trust: 2, baseline: true },
    ...sections.flatMap((section) =>
      section.cleanedTitle
        ? [{ name: section.cleanedTitle, trust: section.trust, baseline: false }]
        : [],
    ),
  ];
  const searchableOptions = options.filter(
    (option) =>
      option.baseline ||
      (normalizeComparable(option.name).length >= 4 &&
        characterSimilarity(candidateTitle, option.name) >= 0.38),
  );

  let selected = candidateTitle;
  let selectedScore = 5;
  for (const option of searchableOptions) {
    if (option.baseline) continue;
    const relevance = characterSimilarity(candidateTitle, option.name);
    const supportingResults = searchableOptions.filter(
      (other) =>
        !other.baseline &&
        other !== option &&
        characterSimilarity(option.name, other.name) >= 0.62,
    ).length;
    const score =
      option.trust + relevance * 3 + Math.min(supportingResults, 3) * 0.7;
    if (score > selectedScore) {
      selected = option.name;
      selectedScore = score;
    }
  }
  return selected;
}

function collectEvidenceTexts(
  candidateTitle: string,
  productName: string,
  sections: SearchSection[],
): string[] {
  const texts = [productName, candidateTitle];
  for (const section of sections) {
    collectPrimitiveTexts(section.record, texts);
    if (texts.length >= MAX_EVIDENCE_TEXTS) break;
  }
  return [...new Set(texts)];
}

function isAllowedThumbnailUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  const isGoogleThumbnail = /^encrypted-tbn\d+\.gstatic\.com$/i.test(
    url.hostname,
  );
  const isSerpApiThumbnail =
    url.hostname === "serpapi.com" &&
    (url.pathname.startsWith("/searches/") || url.pathname.startsWith("/images/"));
  return isGoogleThumbnail || isSerpApiThumbnail ? url : null;
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("missing body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_THUMBNAIL_SIZE) {
      await reader.cancel();
      throw new Error("thumbnail too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function downloadThumbnail(value: string | null): Promise<string | null> {
  if (!value) return null;
  const url = isAllowedThumbnailUrl(value);
  if (!url) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), THUMBNAIL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "image/jpeg,image/png,image/webp" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_THUMBNAIL_SIZE) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (
      contentType !== "image/jpeg" &&
      contentType !== "image/png" &&
      contentType !== "image/webp"
    ) {
      return null;
    }

    const bytes = await readLimitedBody(response);
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type LensCandidate = {
  lensPosition: number;
  link: string;
  source: string;
  thumbnail: string | null;
  title: string;
};

type RankedCandidate = SearchCandidate & {
  imageUrl: string | null;
  lensPosition: number;
  namePriority: number;
  qualityScore: number;
  schemaProductFound: boolean;
  thumbnail: string | null;
};

function normalizeCandidateUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|gclid|fbclid|yclid|ref|referrer)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}

function collectLensCandidates(matches: unknown[]): LensCandidate[] {
  const candidates: LensCandidate[] = [];
  const seenUrls = new Set<string>();
  const seenTitleSources = new Set<string>();

  for (const [index, value] of matches.entries()) {
    const match = asRecord(value);
    if (!match) continue;
    const link = cleanText(match.link, 1_000);
    const normalizedUrl = link ? normalizeCandidateUrl(link) : null;
    const title = cleanText(match.title, 300);
    if (!link || !normalizedUrl || !title || seenUrls.has(normalizedUrl)) continue;

    const source = cleanText(match.source, 160) ?? "";
    const normalizedTitle = normalizeComparable(
      cleanProductTitle(title, source) ?? title,
    );
    const titleSourceKey = `${normalizedTitle}\u0000${normalizeComparable(source)}`;
    if (normalizedTitle && seenTitleSources.has(titleSourceKey)) continue;
    seenUrls.add(normalizedUrl);
    if (normalizedTitle) seenTitleSources.add(titleSourceKey);

    const rawPosition = Number(match.position);
    candidates.push({
      lensPosition:
        Number.isInteger(rawPosition) && rawPosition > 0
          ? rawPosition
          : index + 1,
      link,
      source,
      thumbnail: cleanText(match.thumbnail, 2_000),
      title,
    });
    if (candidates.length === MAX_PAGE_CANDIDATES) break;
  }
  return candidates;
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function candidateQuality(candidate: RankedCandidate): number {
  const nameScore = candidate.name
    ? candidate.namePriority === 1
      ? 6
      : candidate.namePriority === 2
        ? 5
        : candidate.namePriority === 3
          ? 3.5
          : candidate.namePriority === 4
            ? 2.5
            : 1
    : 0;
  const lensRankScore = Math.max(0, 3 - (candidate.lensPosition - 1) * 0.4);
  return (
    (candidate.schemaProductFound ? 7 : 0) +
    nameScore +
    (candidate.brand ? 3 : 0) +
    (candidate.imageDataUrl ? 2 : 0) +
    (candidate.category ? 1.5 : 0) +
    (candidate.alcoholPercentage !== null ? 2 : 0) +
    (candidate.productionLocation ? 1 : 0) +
    (candidate.volume ? 1 : 0) +
    lensRankScore
  );
}

async function enrichLensCandidate(
  candidate: LensCandidate,
): Promise<RankedCandidate> {
  let page: ProductPageMetadata | null = null;
  try {
    page = await fetchProductPageMetadata(candidate.link);
  } catch {
    // 1件の取得失敗で候補全体を失敗させない。
  }

  const pageName = page
    ? extractFormalProductName(page.name, page.sourceSite ?? candidate.source, page.namePriority)
    : null;
  const lensName = extractFormalProductName(candidate.title, candidate.source, 5);
  const name = pageName ?? lensName;
  const namePriority = pageName ? page?.namePriority ?? 4 : lensName ? 5 : 0;
  const evidence = [
    ...(page?.additionalTexts ?? []),
    page?.category ?? "",
    page?.name ?? "",
    pageName ?? "",
    page?.description ?? "",
    candidate.title,
  ].filter(Boolean);
  const brand =
    cleanShortField(page?.brand, 60) ?? extractLabeledBrand(evidence);
  const productionLocation =
    cleanShortField(page?.productionLocation, 80) ??
    cleanShortField(page?.manufacturerLocation, 120) ??
    extractProductionLocation(evidence);
  const volume = extractVolume(evidence);
  const rawSourceUrl = page?.sourceUrl ?? candidate.link;
  const sourceUrl = normalizeCandidateUrl(rawSourceUrl) ?? rawSourceUrl;
  const sourceSite =
    cleanSourceSite(page?.sourceSite) ??
    cleanSourceSite(candidate.source) ??
    safeHostname(sourceUrl);
  const queryTitle = name ?? cleanProductTitle(candidate.title, candidate.source) ?? candidate.title;
  const normalizedName = name ? normalizeComparable(name) : "unknown";

  return {
    alcoholPercentage: extractAlcoholPercentage(evidence),
    brand,
    category: extractCategory(evidence),
    id: createHash("sha256")
      .update(`${normalizedName}\u0000${sourceUrl}`)
      .digest("hex")
      .slice(0, 16),
    imageDataUrl: null,
    imageUrl: page?.imageUrl ?? null,
    lensPosition: candidate.lensPosition,
    lookupToken: createCandidateToken(queryTitle, sourceSite),
    name,
    namePriority,
    productionLocation,
    qualityScore: 0,
    schemaProductFound: page?.schemaProductFound ?? false,
    sourceSite,
    sourceUrl,
    thumbnail: candidate.thumbnail,
    volume,
  };
}

function removeDuplicateProducts(candidates: RankedCandidate[]): RankedCandidate[] {
  const accepted: RankedCandidate[] = [];
  for (const candidate of candidates) {
    const normalizedName = candidate.name
      ? normalizeComparable(candidate.name)
      : null;
    const duplicate = accepted.some((existing) => {
      if (!normalizedName || !existing.name) {
        return (
          (normalizeCandidateUrl(existing.sourceUrl) ?? existing.sourceUrl) ===
          (normalizeCandidateUrl(candidate.sourceUrl) ?? candidate.sourceUrl)
        );
      }
      if (normalizeComparable(existing.name) !== normalizedName) return false;
      const sameBrand =
        !existing.brand ||
        !candidate.brand ||
        normalizeComparable(existing.brand) === normalizeComparable(candidate.brand);
      const sameVolume =
        !existing.volume ||
        !candidate.volume ||
        normalizeComparable(existing.volume) === normalizeComparable(candidate.volume);
      return sameBrand && sameVolume;
    });
    if (!duplicate) accepted.push(candidate);
  }
  return accepted;
}

export async function createSearchCandidates(
  payload: unknown,
): Promise<SearchCandidate[]> {
  const response = asRecord(payload);
  const matches = response?.visual_matches;
  if (!Array.isArray(matches)) return [];

  const lensCandidates = collectLensCandidates(matches);
  const enriched = await Promise.all(lensCandidates.map(enrichLensCandidate));
  const withImages = await Promise.all(
    enriched.map(async (candidate) => {
      const productImage = candidate.imageUrl
        ? await downloadProductImage(candidate.imageUrl)
        : null;
      const imageDataUrl =
        productImage ?? (await downloadThumbnail(candidate.thumbnail));
      const completed = { ...candidate, imageDataUrl };
      return { ...completed, qualityScore: candidateQuality(completed) };
    }),
  );

  return removeDuplicateProducts(
    withImages.sort(
      (left, right) =>
        right.qualityScore - left.qualityScore ||
        left.lensPosition - right.lensPosition,
    ),
  )
    .slice(0, MAX_CANDIDATES)
    .map((candidate) => ({
      alcoholPercentage: candidate.alcoholPercentage,
      brand: candidate.brand,
      category: candidate.category,
      id: candidate.id,
      imageDataUrl: candidate.imageDataUrl,
      lookupToken: candidate.lookupToken,
      name: candidate.name,
      productionLocation: candidate.productionLocation,
      sourceSite: candidate.sourceSite,
      sourceUrl: candidate.sourceUrl,
      volume: candidate.volume,
    }));
}

export function extractBottleDetails(
  payload: unknown,
  candidate: CandidateTokenPayload,
): BottleSearchDetails {
  const response = asRecord(payload) ?? {};
  const candidateTitle = cleanProductTitle(candidate.title) ?? candidate.title;
  const sections = collectSearchSections(response, candidateTitle);
  const productName = chooseProductName(candidateTitle, sections);
  const texts = collectEvidenceTexts(candidateTitle, productName, sections);
  const brandKeys = new Set(
    [
      "brand",
      "brand name",
      "manufacturer",
      "manufacturer name",
      "producer",
      "maker",
      "distillery",
      "winery",
      "brewery",
      "ブランド",
      "ブランド名",
      "メーカー",
      "メーカー名",
      "製造者",
      "製造元",
      "製造所",
      "販売者",
      "生産者",
      "醸造元",
      "蔵元",
      "蒸留所",
      "蒸溜所",
    ].map(normalizeFieldKey),
  );
  const structuredBrand = sections
    .map((section) => findValueByKey(section.record, brandKeys))
    .find((value): value is string => Boolean(value));

  return {
    name: productName,
    brand: structuredBrand ?? extractLabeledBrand(texts),
    category: extractCategory(texts),
    alcoholPercentage: extractAlcoholPercentage(texts),
  };
}
