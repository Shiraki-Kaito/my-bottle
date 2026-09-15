import Image from "next/image";
import { CheckIcon } from "./icons";
import type { SearchCandidate } from "../lib/types";

type SearchCandidateListProps = {
  candidates: SearchCandidate[];
  disabled?: boolean;
  selectedCandidateId: string;
  onSelect: (id: string) => void;
};

export function SearchCandidateList({
  candidates,
  disabled = false,
  selectedCandidateId,
  onSelect,
}: SearchCandidateListProps) {
  return (
    <div className="candidate-list" role="radiogroup" aria-label="商品候補">
      {candidates.map((candidate) => {
        const isSelected = selectedCandidateId === candidate.id;
        return (
          <label
            className={
              isSelected ? "candidate-card is-selected" : "candidate-card"
            }
            key={candidate.id}
          >
            <input
              checked={isSelected}
              className="visually-hidden"
              disabled={disabled}
              name="candidate"
              onChange={() => onSelect(candidate.id)}
              type="radio"
              value={candidate.id}
            />
            <span className="candidate-image-frame">
              {candidate.imageDataUrl ? (
                <Image
                  alt={candidate.name ? `${candidate.name}の商品画像` : "候補の商品画像"}
                  fill
                  sizes="100px"
                  src={candidate.imageDataUrl}
                  unoptimized
                />
              ) : (
                <span className="candidate-image-placeholder">画像なし</span>
              )}
            </span>
            <span className="candidate-copy">
              <span className="candidate-type">
                {candidate.category ?? "種類：未取得"}
              </span>
              <strong>{candidate.name ?? "商品名：未取得"}</strong>
              <span>ブランド：{candidate.brand ?? "未取得"}</span>
              <span className="candidate-abv">
                アルコール度数：
                {candidate.alcoholPercentage === null
                  ? "未取得"
                  : `${candidate.alcoholPercentage}%`}
              </span>
              <span>
                製造国・場所：{candidate.productionLocation ?? "未取得"}
              </span>
              <span>容量：{candidate.volume ?? "未取得"}</span>
              <span>情報元：{candidate.sourceSite || "未取得"}</span>
              <span className="candidate-source-url" title={candidate.sourceUrl}>
                {candidate.sourceUrl}
              </span>
            </span>
            <span className="candidate-check" aria-hidden="true">
              {isSelected && <CheckIcon size={16} />}
            </span>
          </label>
        );
      })}
    </div>
  );
}
