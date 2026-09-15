export const BOTTLE_CATEGORIES = [
  "ウイスキー",
  "ジン",
  "日本酒",
  "ワイン",
  "ラム",
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

export interface SearchCandidate extends BottleDraft {
  id: string;
}
