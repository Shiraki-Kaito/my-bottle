export const BOTTLE_CATEGORIES = [
  "ウイスキー",
  "ジン",
  "ラム",
  "ウォッカ",
  "日本酒",
  "焼酎",
  "ビール",
  "ワイン",
  "リキュール",
  "その他",
] as const;

export type BottleCategory = (typeof BOTTLE_CATEGORIES)[number];

export type BottleImageCrop = "left" | "center" | "right" | "full";

export interface BottleImage {
  src: string;
  crop: BottleImageCrop;
}

export interface BottleDraft {
  name: string;
  brand: string;
  category: BottleCategory;
  alcoholPercentage: number;
  image: BottleImage;
}

export interface Bottle extends BottleDraft {
  id: string;
  rating: number;
  memo: string;
  drinkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SearchCandidate {
  id: string;
  name: string | null;
  brand: string | null;
  category: BottleCategory | null;
  alcoholPercentage: number | null;
  productionLocation: string | null;
  volume: string | null;
  imageDataUrl: string | null;
  sourceSite: string;
  sourceUrl: string;
  lookupToken: string;
}

export interface BottleSearchDetails {
  name: string;
  brand: string | null;
  category: BottleCategory | null;
  alcoholPercentage: number | null;
}

export interface BottleFormDraft {
  name: string;
  brand: string;
  category: BottleCategory | "";
  alcoholPercentage: string;
  image: BottleImage;
}
