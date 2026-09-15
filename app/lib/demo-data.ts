import type { Bottle } from "./types";

const COLLECTION_IMAGE = "/bottle-collection.png";

export const DEMO_BOTTLES: Bottle[] = [
  {
    id: "demo-yamabuki",
    name: "山吹 ピュアモルト",
    brand: "山吹蒸溜所",
    category: "ウイスキー",
    alcoholPercentage: 43,
    image: { src: COLLECTION_IMAGE, crop: "left" },
    rating: 4,
    memo: "バニラと樽の香り。少量の加水で甘さが開く。",
    drinkCount: 6,
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-09-10T10:00:00.000Z",
  },
  {
    id: "demo-nagi",
    name: "凪 ドライジン",
    brand: "海風蒸溜所",
    category: "ジン",
    alcoholPercentage: 47,
    image: { src: COLLECTION_IMAGE, crop: "center" },
    rating: 5,
    memo: "柑橘の香りが爽やか。ソーダ割りに合う。",
    drinkCount: 3,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-09-08T10:00:00.000Z",
  },
  {
    id: "demo-yukiakari",
    name: "雪灯 純米吟醸",
    brand: "雪灯酒造",
    category: "日本酒",
    alcoholPercentage: 15.5,
    image: { src: COLLECTION_IMAGE, crop: "right" },
    rating: 4,
    memo: "冷やして。白桃のような香りと軽い余韻。",
    drinkCount: 4,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-12T10:00:00.000Z",
  },
];
