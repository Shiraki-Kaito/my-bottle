type RatingStarsProps = {
  value: number;
  onChange: (value: number) => void;
};

export function RatingStars({ value, onChange }: RatingStarsProps) {
  return (
    <div className="rating-stars" aria-label={`5段階中${value}の評価`}>
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          aria-label={`${rating}つ星にする`}
          className={rating <= value ? "star is-active" : "star"}
          key={rating}
          onClick={() => onChange(rating)}
          type="button"
        >
          ★
        </button>
      ))}
    </div>
  );
}
