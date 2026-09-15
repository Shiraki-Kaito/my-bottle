import { DEMO_BOTTLES } from "./demo-data";
import type { Bottle } from "./types";

const STORAGE_KEY = "my-bottle-shelf:bottles:v1";
const listeners = new Set<() => void>();

let cachedRaw: string | null | undefined;
let cachedBottles: Bottle[] = DEMO_BOTTLES;

function isBottle(value: unknown): value is Bottle {
  if (!value || typeof value !== "object") return false;
  const bottle = value as Partial<Bottle>;
  return (
    typeof bottle.id === "string" &&
    typeof bottle.name === "string" &&
    typeof bottle.brand === "string" &&
    typeof bottle.category === "string" &&
    typeof bottle.alcoholPercentage === "number" &&
    typeof bottle.drinkCount === "number" &&
    typeof bottle.image?.src === "string"
  );
}

function parseBottles(raw: string | null): Bottle[] {
  if (!raw) return DEMO_BOTTLES;

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isBottle)
      ? parsed
      : DEMO_BOTTLES;
  } catch {
    return DEMO_BOTTLES;
  }
}

export function getBottleSnapshot(): Bottle[] {
  if (typeof window === "undefined") return DEMO_BOTTLES;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedBottles;

  cachedRaw = raw;
  cachedBottles = parseBottles(raw);
  return cachedBottles;
}

export function getBottleServerSnapshot(): Bottle[] {
  return DEMO_BOTTLES;
}

export function subscribeToBottles(listener: () => void): () => void {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cachedRaw = undefined;
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function saveBottles(bottles: Bottle[]): void {
  const serialized = JSON.stringify(bottles);
  window.localStorage.setItem(STORAGE_KEY, serialized);
  cachedRaw = serialized;
  cachedBottles = bottles;
  listeners.forEach((listener) => listener());
}

export function createProductKey(name: string, brand: string): string {
  const normalize = (value: string) =>
    value.trim().normalize("NFKC").toLocaleLowerCase("ja-JP");

  return `${normalize(brand)}::${normalize(name)}`;
}
