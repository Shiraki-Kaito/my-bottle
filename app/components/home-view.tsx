import { BottleArt } from "./bottle-art";
import { PlusIcon } from "./icons";
import type { Bottle, BottleCategory } from "../lib/types";

type BottleFilter = "すべて" | BottleCategory;

type HomeViewProps = {
  bottles: Bottle[];
  activeFilter: BottleFilter;
  onFilterChange: (filter: BottleFilter) => void;
  onAdd: () => void;
  onSelectBottle: (id: string) => void;
};

export function HomeView({
  bottles,
  activeFilter,
  onFilterChange,
  onAdd,
  onSelectBottle,
}: HomeViewProps) {
  const availableCategories = Array.from(
    new Set(bottles.map((bottle) => bottle.category)),
  );
  const filters: BottleFilter[] = ["すべて", ...availableCategories];
  const visibleBottles =
    activeFilter === "すべて"
      ? bottles
      : bottles.filter((bottle) => bottle.category === activeFilter);

  return (
    <main className="home-view">
      <section className="collection-summary" aria-labelledby="collection-title">
        <div>
          <p className="eyebrow">MY COLLECTION</p>
          <h1 id="collection-title">
            <strong>{bottles.length}</strong>
            <span>本のボトル</span>
          </h1>
          <p className="summary-copy">お気に入りの一杯を、ここに。</p>
        </div>
        <button className="primary-button add-button" onClick={onAdd} type="button">
          <PlusIcon size={21} />
          お酒を追加
        </button>
      </section>

      <section className="shelf-section" aria-labelledby="shelf-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">BOTTLE SHELF</p>
            <h2 id="shelf-title">わたしの酒棚</h2>
          </div>
          <span>{visibleBottles.length}本</span>
        </div>

        <div className="filter-list" aria-label="お酒の種類で絞り込む">
          {filters.map((filter) => (
            <button
              aria-pressed={activeFilter === filter}
              className="filter-chip"
              key={filter}
              onClick={() => onFilterChange(filter)}
              type="button"
            >
              {filter}
            </button>
          ))}
        </div>

        {visibleBottles.length > 0 ? (
          <div className="wood-cabinet">
            <div className="shelf-grid">
              {visibleBottles.map((bottle) => (
                <button
                  className="bottle-card"
                  key={bottle.id}
                  onClick={() => onSelectBottle(bottle.id)}
                  type="button"
                >
                  <span className="bottle-stage">
                    <BottleArt
                      alt={`${bottle.name}のボトル`}
                      className="shelf-bottle-art"
                      image={bottle.image}
                    />
                    <span className="drink-badge">{bottle.drinkCount}回</span>
                  </span>
                  <span className="bottle-card-copy">
                    <strong>{bottle.name}</strong>
                    <span>{bottle.category}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-shelf">
            <p>この種類のボトルはまだありません。</p>
            <button className="text-button" onClick={onAdd} type="button">
              棚に追加する
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

export type { BottleFilter };
