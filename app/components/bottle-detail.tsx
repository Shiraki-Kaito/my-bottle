import { BottleArt } from "./bottle-art";
import { BackIcon, GlassIcon } from "./icons";
import { RatingStars } from "./rating-stars";
import type { Bottle } from "../lib/types";

type BottleDetailProps = {
  bottle: Bottle;
  onBack: () => void;
  onUpdate: (bottle: Bottle) => void;
  onDrinkAgain: () => void;
};

export function BottleDetail({
  bottle,
  onBack,
  onUpdate,
  onDrinkAgain,
}: BottleDetailProps) {
  return (
    <main className="subpage detail-page">
      <div className="subpage-heading">
        <button className="icon-button" onClick={onBack} type="button">
          <BackIcon />
          <span className="visually-hidden">棚へ戻る</span>
        </button>
        <div>
          <p className="section-kicker">BOTTLE DETAIL</p>
          <h1>ボトルの記録</h1>
        </div>
      </div>

      <section className="detail-hero">
        <div className="detail-image-frame">
          <BottleArt
            alt={`${bottle.name}のボトル`}
            className="detail-bottle-art"
            image={bottle.image}
            priority
          />
        </div>
        <div className="detail-product-copy">
          <span className="category-tag">{bottle.category}</span>
          <h2>{bottle.name}</h2>
          <p>{bottle.brand}</p>
          <dl className="product-facts">
            <div>
              <dt>アルコール度数</dt>
              <dd>{bottle.alcoholPercentage}%</dd>
            </div>
            <div>
              <dt>飲んだ回数</dt>
              <dd>{bottle.drinkCount}回</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="record-card" aria-labelledby="record-title">
        <div className="record-card-heading">
          <div>
            <p className="section-kicker">MY NOTE</p>
            <h2 id="record-title">味わいの記録</h2>
          </div>
          <span className="autosave-label">自動保存</span>
        </div>

        <div className="field-group">
          <span className="field-label">評価</span>
          <RatingStars
            onChange={(rating) => onUpdate({ ...bottle, rating })}
            value={bottle.rating}
          />
        </div>

        <label className="field-group" htmlFor="bottle-memo">
          <span className="field-label">メモ</span>
          <textarea
            id="bottle-memo"
            onChange={(event) =>
              onUpdate({ ...bottle, memo: event.target.value })
            }
            placeholder="香りや味、合わせた料理など"
            rows={5}
            value={bottle.memo}
          />
        </label>

        <button
          className="primary-button drink-again-button"
          onClick={onDrinkAgain}
          type="button"
        >
          <GlassIcon size={22} />
          もう一度飲んだ
        </button>
      </section>
    </main>
  );
}
