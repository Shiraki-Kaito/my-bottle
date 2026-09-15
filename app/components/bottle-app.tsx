"use client";

import { useState, useSyncExternalStore } from "react";
import { AddBottleFlow } from "./add-bottle-flow";
import { BottleDetail } from "./bottle-detail";
import { HomeView, type BottleFilter } from "./home-view";
import {
  createProductKey,
  getBottleServerSnapshot,
  getBottleSnapshot,
  saveBottles,
  subscribeToBottles,
} from "../lib/storage-service";
import type { Bottle, BottleDraft } from "../lib/types";
import { useBottleTools } from "../lib/use-bottle-tools";

type AppView = "home" | "add" | "detail";

export function BottleApp() {
  const bottles = useSyncExternalStore(
    subscribeToBottles,
    getBottleSnapshot,
    getBottleServerSnapshot,
  );
  const [view, setView] = useState<AppView>("home");
  const [activeFilter, setActiveFilter] = useState<BottleFilter>("すべて");
  const [selectedBottleId, setSelectedBottleId] = useState<string>("");
  const [notification, setNotification] = useState("");
  useBottleTools(setNotification);

  const persistBottles = (nextBottles: Bottle[], message?: string) => {
    try {
      saveBottles(nextBottles);
      if (message) setNotification(message);
      return true;
    } catch {
      setNotification(
        "保存できませんでした。ブラウザの保存容量を確認してください。",
      );
      return false;
    }
  };

  const handleRegister = (draft: BottleDraft) => {
    const draftKey = createProductKey(draft.name, draft.brand);
    const existing = bottles.find(
      (bottle) => createProductKey(bottle.name, bottle.brand) === draftKey,
    );
    const now = new Date().toISOString();

    if (existing) {
      const nextBottles = bottles.map((bottle) =>
        bottle.id === existing.id
          ? {
              ...bottle,
              drinkCount: bottle.drinkCount + 1,
              updatedAt: now,
            }
          : bottle,
      );

      if (
        persistBottles(
          nextBottles,
          `${existing.name}の「飲んだ回数」を増やしました。`,
        )
      ) {
        setView("home");
        setActiveFilter("すべて");
      }
      return;
    }

    const newBottle: Bottle = {
      ...draft,
      id: crypto.randomUUID(),
      rating: 0,
      memo: "",
      drinkCount: 1,
      createdAt: now,
      updatedAt: now,
    };

    if (
      persistBottles(
        [...bottles, newBottle],
        `${newBottle.name}を棚に追加しました。`,
      )
    ) {
      setView("home");
      setActiveFilter("すべて");
    }
  };

  const handleUpdate = (updatedBottle: Bottle) => {
    persistBottles(
      bottles.map((bottle) =>
        bottle.id === updatedBottle.id
          ? { ...updatedBottle, updatedAt: new Date().toISOString() }
          : bottle,
      ),
    );
  };

  const handleDrinkAgain = () => {
    const selected = bottles.find((bottle) => bottle.id === selectedBottleId);
    if (!selected) return;

    persistBottles(
      bottles.map((bottle) =>
        bottle.id === selected.id
          ? {
              ...bottle,
              drinkCount: bottle.drinkCount + 1,
              updatedAt: new Date().toISOString(),
            }
          : bottle,
      ),
      `${selected.name}を飲んだ記録を追加しました。`,
    );
  };

  const selectedBottle = bottles.find(
    (bottle) => bottle.id === selectedBottleId,
  );

  const goHome = () => {
    setView("home");
    setSelectedBottleId("");
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand-button" onClick={goHome} type="button">
          <span className="brand-monogram">MB</span>
          <span>
            <strong>My Bottle Shelf</strong>
            <small>私だけの酒棚</small>
          </span>
        </button>
      </header>

      {view === "home" && (
        <HomeView
          activeFilter={activeFilter}
          bottles={bottles}
          onAdd={() => {
            setNotification("");
            setView("add");
          }}
          onFilterChange={setActiveFilter}
          onSelectBottle={(id) => {
            setSelectedBottleId(id);
            setNotification("");
            setView("detail");
          }}
        />
      )}

      {view === "add" && (
        <AddBottleFlow onCancel={goHome} onRegister={handleRegister} />
      )}

      {view === "detail" && selectedBottle && (
        <BottleDetail
          bottle={selectedBottle}
          onBack={goHome}
          onDrinkAgain={handleDrinkAgain}
          onUpdate={handleUpdate}
        />
      )}

      {notification && (
        <div className="toast" role="status">
          <span>{notification}</span>
          <button
            aria-label="通知を閉じる"
            onClick={() => setNotification("")}
            type="button"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
