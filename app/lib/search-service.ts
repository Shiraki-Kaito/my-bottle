import { DEMO_SEARCH_CANDIDATES } from "./demo-data";
import type { SearchCandidate } from "./types";

export interface BottleSearchService {
  searchSimilar(imageDataUrl: string): Promise<SearchCandidate[]>;
}

class DemoBottleSearchService implements BottleSearchService {
  async searchSimilar(imageDataUrl: string): Promise<SearchCandidate[]> {
    void imageDataUrl;
    // 実際の画像検索らしい待ち時間を再現する。将来はこの実装だけをAPI接続へ差し替える。
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    return DEMO_SEARCH_CANDIDATES.map((candidate) => ({
      ...candidate,
      image: { ...candidate.image },
    }));
  }
}

export const bottleSearchService: BottleSearchService =
  new DemoBottleSearchService();
