"use client";

import Image from "next/image";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { BottleArt } from "./bottle-art";
import {
  BackIcon,
  CameraIcon,
  CheckIcon,
  SearchIcon,
  UploadIcon,
} from "./icons";
import { prepareImageFile } from "../lib/image-utils";
import { bottleSearchService } from "../lib/search-service";
import {
  BOTTLE_CATEGORIES,
  type BottleDraft,
  type SearchCandidate,
} from "../lib/types";

type AddBottleFlowProps = {
  onCancel: () => void;
  onRegister: (draft: BottleDraft) => void;
};

type AddStage = "upload" | "results" | "confirm";

export function AddBottleFlow({
  onCancel,
  onRegister,
}: AddBottleFlowProps) {
  const [stage, setStage] = useState<AddStage>("upload");
  const [preview, setPreview] = useState<string>("");
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [draft, setDraft] = useState<BottleDraft | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError("");
    try {
      setPreview(await prepareImageFile(file));
      setCandidates([]);
      setSelectedCandidateId("");
      setStage("upload");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "画像を読み込めませんでした。",
      );
    }
  };

  const handleSearch = async () => {
    if (!preview) return;
    setError("");
    setIsSearching(true);

    try {
      const results = await bottleSearchService.searchSimilar(preview);
      setCandidates(results);
      setSelectedCandidateId(results[0]?.id ?? "");
      setStage("results");
    } catch {
      setError("候補を取得できませんでした。もう一度お試しください。");
    } finally {
      setIsSearching(false);
    }
  };

  const handleContinue = () => {
    const selected = candidates.find(
      (candidate) => candidate.id === selectedCandidateId,
    );
    if (!selected) return;

    setDraft({
      name: selected.name,
      brand: selected.brand,
      category: selected.category,
      alcoholPercentage: selected.alcoholPercentage,
      image: { ...selected.image },
    });
    setStage("confirm");
  };

  const goBack = () => {
    if (stage === "confirm") {
      setStage("results");
      return;
    }
    if (stage === "results") {
      setStage("upload");
      return;
    }
    onCancel();
  };

  return (
    <main className="subpage add-page">
      <div className="subpage-heading">
        <button className="icon-button" onClick={goBack} type="button">
          <BackIcon />
          <span className="visually-hidden">前の画面へ戻る</span>
        </button>
        <div>
          <p className="section-kicker">
            {stage === "confirm" ? "FINAL CHECK" : "ADD A BOTTLE"}
          </p>
          <h1>
            {stage === "upload" && "お酒を追加"}
            {stage === "results" && "似ているお酒"}
            {stage === "confirm" && "登録内容の確認"}
          </h1>
        </div>
        <span className="step-indicator">
          {stage === "upload" ? "1" : stage === "results" ? "2" : "3"} / 3
        </span>
      </div>

      {stage === "upload" && (
        <section className="flow-card upload-card">
          <div className={preview ? "upload-preview has-image" : "upload-preview"}>
            {preview ? (
              <Image
                alt="選択したお酒の画像"
                fill
                sizes="(max-width: 640px) 90vw, 560px"
                src={preview}
                unoptimized
              />
            ) : (
              <div className="upload-placeholder">
                <CameraIcon size={38} />
                <strong>ボトルを正面から撮影</strong>
                <span>ラベル全体が入るように撮ると見つけやすくなります</span>
              </div>
            )}
          </div>

          <div className="upload-actions">
            <label className="secondary-button" htmlFor="camera-input">
              <CameraIcon />
              カメラで撮る
              <input
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                id="camera-input"
                onChange={handleImageChange}
                type="file"
              />
            </label>
            <label className="secondary-button" htmlFor="file-input">
              <UploadIcon />
              写真を選ぶ
              <input
                accept="image/*"
                className="visually-hidden"
                id="file-input"
                onChange={handleImageChange}
                type="file"
              />
            </label>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button
            className="primary-button full-button"
            disabled={!preview || isSearching}
            onClick={handleSearch}
            type="button"
          >
            <SearchIcon />
            {isSearching ? "画像を確認しています…" : "画像を検索する"}
          </button>
          <p className="demo-note">
            MVPでは画像を送信せず、デモ用の商品候補を表示します。
          </p>
        </section>
      )}

      {stage === "results" && (
        <section className="flow-card results-card">
          <p className="flow-lead">近い商品を3件見つけました。</p>
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
                    name="candidate"
                    onChange={() => setSelectedCandidateId(candidate.id)}
                    type="radio"
                    value={candidate.id}
                  />
                  <span className="candidate-image-frame">
                    <BottleArt
                      alt={`${candidate.name}のボトル`}
                      className="candidate-bottle-art"
                      image={candidate.image}
                    />
                  </span>
                  <span className="candidate-copy">
                    <span className="candidate-type">{candidate.category}</span>
                    <strong>{candidate.name}</strong>
                    <span>{candidate.brand}</span>
                    <span className="candidate-abv">
                      アルコール {candidate.alcoholPercentage}%
                    </span>
                  </span>
                  <span className="candidate-check" aria-hidden="true">
                    {isSelected && <CheckIcon size={16} />}
                  </span>
                </label>
              );
            })}
          </div>
          <button
            className="primary-button full-button"
            disabled={!selectedCandidateId}
            onClick={handleContinue}
            type="button"
          >
            選択した商品を確認
          </button>
        </section>
      )}

      {stage === "confirm" && draft && (
        <ConfirmationForm
          draft={draft}
          onDraftChange={setDraft}
          onRegister={onRegister}
        />
      )}
    </main>
  );
}

type ConfirmationFormProps = {
  draft: BottleDraft;
  onDraftChange: (draft: BottleDraft) => void;
  onRegister: (draft: BottleDraft) => void;
};

function ConfirmationForm({
  draft,
  onDraftChange,
  onRegister,
}: ConfirmationFormProps) {
  const [imageError, setImageError] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRegister({
      ...draft,
      name: draft.name.trim(),
      brand: draft.brand.trim(),
    });
  };

  const handleReplacementImage = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImageError("");
    try {
      const src = await prepareImageFile(file);
      onDraftChange({ ...draft, image: { src, crop: "full" } });
    } catch (cause) {
      setImageError(
        cause instanceof Error ? cause.message : "画像を読み込めませんでした。",
      );
    }
  };

  return (
    <form className="flow-card confirmation-form" onSubmit={handleSubmit}>
      <div className="confirmation-image-column">
        <div className="confirmation-image-frame">
          <BottleArt
            alt={`${draft.name}のボトル`}
            className="confirmation-bottle-art"
            image={draft.image}
          />
        </div>
        <label className="text-button image-change-button" htmlFor="replace-image-input">
          画像を差し替える
          <input
            accept="image/*"
            className="visually-hidden"
            id="replace-image-input"
            onChange={handleReplacementImage}
            type="file"
          />
        </label>
        {imageError && <p className="form-error" role="alert">{imageError}</p>}
      </div>

      <div className="confirmation-fields">
        <label className="field-group" htmlFor="product-name">
          <span className="field-label">商品名</span>
          <input
            id="product-name"
            onChange={(event) =>
              onDraftChange({ ...draft, name: event.target.value })
            }
            required
            type="text"
            value={draft.name}
          />
        </label>

        <label className="field-group" htmlFor="product-brand">
          <span className="field-label">ブランド</span>
          <input
            id="product-brand"
            onChange={(event) =>
              onDraftChange({ ...draft, brand: event.target.value })
            }
            required
            type="text"
            value={draft.brand}
          />
        </label>

        <div className="field-row">
          <label className="field-group" htmlFor="product-category">
            <span className="field-label">種類</span>
            <select
              id="product-category"
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  category: event.target.value as BottleDraft["category"],
                })
              }
              value={draft.category}
            >
              {BOTTLE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="field-group" htmlFor="product-abv">
            <span className="field-label">アルコール度数</span>
            <span className="input-with-unit">
              <input
                id="product-abv"
                max="100"
                min="0"
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    alcoholPercentage: Number(event.target.value),
                  })
                }
                required
                step="0.1"
                type="number"
                value={draft.alcoholPercentage}
              />
              <span>%</span>
            </span>
          </label>
        </div>

        <button className="primary-button full-button" type="submit">
          <CheckIcon />
          この内容で棚へ登録
        </button>
        <p className="duplicate-note">
          同じ商品が棚にある場合は、ボトルを増やさず飲んだ回数を加算します。
        </p>
      </div>
    </form>
  );
}
