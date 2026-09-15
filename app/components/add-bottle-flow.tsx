"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { BottleArt } from "./bottle-art";
import { SearchCandidateList } from "./search-candidate-list";
import {
  BackIcon,
  CameraIcon,
  CheckIcon,
  SearchIcon,
  UploadIcon,
} from "./icons";
import {
  prepareImageFile,
  type PreparedImage,
} from "../lib/image-utils";
import {
  BottleSearchError,
  bottleSearchService,
} from "../lib/search-service";
import {
  BOTTLE_CATEGORIES,
  type BottleDraft,
  type BottleFormDraft,
  type BottleSearchDetails,
  type SearchCandidate,
} from "../lib/types";

type AddBottleFlowProps = {
  onCancel: () => void;
  onRegister: (draft: BottleDraft) => void;
};

type AddStage = "upload" | "results" | "confirm";
type SearchAvailability = "checking" | "available" | "unavailable";
type FlowFailure = { message: string; retryable: boolean };

export function AddBottleFlow({
  onCancel,
  onRegister,
}: AddBottleFlowProps) {
  const [stage, setStage] = useState<AddStage>("upload");
  const [preparedImage, setPreparedImage] = useState<PreparedImage | null>(null);
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [draft, setDraft] = useState<BottleFormDraft | null>(null);
  const [availability, setAvailability] =
    useState<SearchAvailability>("checking");
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchingDetails, setIsSearchingDetails] = useState(false);
  const [imageError, setImageError] = useState("");
  const [searchFailure, setSearchFailure] = useState<FlowFailure | null>(null);
  const [detailsFailure, setDetailsFailure] = useState<FlowFailure | null>(null);
  const searchLock = useRef(false);
  const detailsLock = useRef(false);
  const detailsCache = useRef(new Map<string, BottleSearchDetails>());
  const preview = preparedImage?.previewDataUrl ?? "";

  useEffect(() => {
    const controller = new AbortController();
    bottleSearchService
      .getAvailability(controller.signal)
      .then((available) =>
        setAvailability(available ? "available" : "unavailable"),
      )
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setAvailability("unavailable");
      });
    return () => controller.abort();
  }, []);

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImageError("");
    setSearchFailure(null);
    try {
      setPreparedImage(await prepareImageFile(file));
      setCandidates([]);
      setSelectedCandidateId("");
      detailsCache.current.clear();
      setStage("upload");
    } catch (cause) {
      setImageError(
        cause instanceof Error ? cause.message : "画像を読み込めませんでした。",
      );
    }
  };

  const handleSearch = async () => {
    if (
      !preparedImage ||
      availability !== "available" ||
      searchLock.current
    ) {
      return;
    }
    searchLock.current = true;
    setSearchFailure(null);
    setIsSearching(true);

    try {
      const results = await bottleSearchService.searchSimilar(
        preparedImage.uploadBlob,
      );
      setCandidates(results.slice(0, 3));
      setSelectedCandidateId(results[0]?.id ?? "");
      setDetailsFailure(null);
      setStage("results");
    } catch (cause) {
      if (cause instanceof BottleSearchError && cause.code === "not_configured") {
        setAvailability("unavailable");
      }
      setSearchFailure({
        message:
          cause instanceof BottleSearchError
            ? cause.message
            : "候補を取得できませんでした。",
        retryable:
          cause instanceof BottleSearchError ? cause.retryable : true,
      });
    } finally {
      setIsSearching(false);
      searchLock.current = false;
    }
  };

  const createFormDraft = (
    candidate?: SearchCandidate,
    details?: BottleSearchDetails,
  ): BottleFormDraft => ({
    name: candidate?.name ?? details?.name ?? "",
    brand: candidate?.brand ?? details?.brand ?? "",
    category: candidate?.category ?? details?.category ?? "",
    alcoholPercentage:
      (candidate?.alcoholPercentage ?? details?.alcoholPercentage)?.toString() ??
      "",
    image: preview ? { src: preview, crop: "full" } : { src: "", crop: "full" },
  });

  const handleManualEntry = (candidate?: SearchCandidate) => {
    setDraft(createFormDraft(candidate));
    setStage("confirm");
  };

  const handleContinue = async () => {
    const selected = candidates.find(
      (candidate) => candidate.id === selectedCandidateId,
    );
    if (!selected || detailsLock.current) return;

    const cachedDetails = detailsCache.current.get(selected.id);
    if (cachedDetails) {
      setDraft(createFormDraft(selected, cachedDetails));
      setStage("confirm");
      return;
    }

    detailsLock.current = true;
    setDetailsFailure(null);
    setIsSearchingDetails(true);
    try {
      const details = await bottleSearchService.searchDetails(
        selected.lookupToken,
      );
      detailsCache.current.set(selected.id, details);
      setDraft(createFormDraft(selected, details));
      setStage("confirm");
    } catch (cause) {
      setDetailsFailure({
        message:
          cause instanceof BottleSearchError
            ? cause.message
            : "商品情報を取得できませんでした。",
        retryable:
          cause instanceof BottleSearchError ? cause.retryable : true,
      });
    } finally {
      setIsSearchingDetails(false);
      detailsLock.current = false;
    }
  };

  const goBack = () => {
    if (stage === "confirm") {
      setStage(candidates.length > 0 ? "results" : "upload");
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
                disabled={isSearching}
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
                disabled={isSearching}
                id="file-input"
                onChange={handleImageChange}
                type="file"
              />
            </label>
          </div>

          {imageError && <p className="form-error" role="alert">{imageError}</p>}

          {availability === "unavailable" ? (
            <div className="search-message" role="status">
              <strong>画像検索を利用できません</strong>
              <span>商品情報を手入力して登録できます。</span>
              <button
                className="secondary-button full-button"
                onClick={() => handleManualEntry()}
                type="button"
              >
                手入力で登録する
              </button>
            </div>
          ) : searchFailure ? (
            <div className="search-message is-error">
              <p className="form-error" role="alert">{searchFailure.message}</p>
              <div className="error-actions">
                {searchFailure.retryable && (
                  <button
                    className="secondary-button"
                    disabled={isSearching}
                    onClick={handleSearch}
                    type="button"
                  >
                    もう一度試す
                  </button>
                )}
                <button
                  className="secondary-button"
                  onClick={() => handleManualEntry()}
                  type="button"
                >
                  手入力で登録する
                </button>
              </div>
            </div>
          ) : (
            <button
              className="primary-button full-button"
              disabled={
                !preparedImage || isSearching || availability === "checking"
              }
              onClick={handleSearch}
              type="button"
            >
              <SearchIcon />
              {availability === "checking"
                ? "画像検索を確認しています…"
                : isSearching
                  ? "商品情報を整理しています…"
                  : "画像を検索する"}
            </button>
          )}
          {availability !== "unavailable" && (
            <p className="demo-note">
              画像検索時は、圧縮した画像をSerpAPIとGoogle Lensへ送信します。
            </p>
          )}
        </section>
      )}

      {stage === "results" && (
        <section className="flow-card results-card">
          <p className="flow-lead">
            近い商品を{candidates.length}件見つけました。
          </p>
          <SearchCandidateList
            candidates={candidates}
            disabled={isSearchingDetails}
            onSelect={(id) => {
              setSelectedCandidateId(id);
              setDetailsFailure(null);
            }}
            selectedCandidateId={selectedCandidateId}
          />
          {detailsFailure && (
            <div className="search-message is-error">
              <p className="form-error" role="alert">{detailsFailure.message}</p>
              <div className="error-actions">
                {detailsFailure.retryable && (
                  <button
                    className="secondary-button"
                    disabled={isSearchingDetails}
                    onClick={handleContinue}
                    type="button"
                  >
                    もう一度試す
                  </button>
                )}
                <button
                  className="secondary-button"
                  onClick={() => {
                    const selected = candidates.find(
                      (candidate) => candidate.id === selectedCandidateId,
                    );
                    handleManualEntry(selected);
                  }}
                  type="button"
                >
                  手入力で確認する
                </button>
              </div>
            </div>
          )}
          <button
            className="primary-button full-button"
            disabled={!selectedCandidateId || isSearchingDetails}
            onClick={handleContinue}
            type="button"
          >
            {isSearchingDetails ? "商品情報を検索しています…" : "選択した商品を確認"}
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
  draft: BottleFormDraft;
  onDraftChange: (draft: BottleFormDraft) => void;
  onRegister: (draft: BottleDraft) => void;
};

function ConfirmationForm({
  draft,
  onDraftChange,
  onRegister,
}: ConfirmationFormProps) {
  const [imageError, setImageError] = useState("");
  const [formError, setFormError] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const alcoholPercentage = Number(draft.alcoholPercentage);
    if (
      !draft.category ||
      !draft.alcoholPercentage.trim() ||
      !Number.isFinite(alcoholPercentage) ||
      alcoholPercentage < 0 ||
      alcoholPercentage > 100
    ) {
      setFormError("種類と0〜100のアルコール度数を入力してください。");
      return;
    }
    setFormError("");
    onRegister({
      name: draft.name.trim(),
      brand: draft.brand.trim(),
      category: draft.category,
      alcoholPercentage,
      image: { ...draft.image },
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
      const image = await prepareImageFile(file);
      onDraftChange({
        ...draft,
        image: { src: image.previewDataUrl, crop: "full" },
      });
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
                  category: event.target.value as BottleFormDraft["category"],
                })
              }
              required
              value={draft.category}
            >
              <option value="">選択してください</option>
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
                    alcoholPercentage: event.target.value,
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

        {formError && <p className="form-error" role="alert">{formError}</p>}

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
