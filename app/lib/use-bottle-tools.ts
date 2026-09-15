"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { getBottleSnapshot, saveBottles } from "./storage-service";

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (input: unknown) => unknown | Promise<unknown>;
};

declare global {
  interface Document {
    readonly modelContext?: {
      registerTool: (
        tool: WebMcpTool,
        options?: { signal?: AbortSignal },
      ) => void | Promise<void>;
    };
  }
}

function readBottleId(input: unknown): string {
  if (!input || typeof input !== "object") {
    throw new Error("bottleIdが必要です。");
  }

  const bottleId = (input as { bottleId?: unknown }).bottleId;
  if (typeof bottleId !== "string" || bottleId.length === 0) {
    throw new Error("bottleIdが必要です。");
  }
  return bottleId;
}

export function useBottleTools(
  setNotification: Dispatch<SetStateAction<string>>,
) {
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const options = { signal: lifecycle.signal };

    const registrations = [
      context.registerTool(
        {
          name: "list_bottle_shelf",
          title: "酒棚の一覧を取得",
          description:
            "My Bottle Shelfに登録されているお酒と飲んだ回数を一覧で取得します。",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: true,
          },
          execute: () => ({
            bottles: getBottleSnapshot().map((bottle) => ({
              id: bottle.id,
              name: bottle.name,
              brand: bottle.brand,
              category: bottle.category,
              drinkCount: bottle.drinkCount,
            })),
          }),
        },
        options,
      ),
      context.registerTool(
        {
          name: "record_bottle_drink",
          title: "飲んだ記録を追加",
          description:
            "指定したボトルの『飲んだ回数』を1回増やし、画面にも反映します。",
          inputSchema: {
            type: "object",
            properties: {
              bottleId: { type: "string" },
            },
            required: ["bottleId"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: true,
          },
          execute: (input) => {
            const bottleId = readBottleId(input);
            const bottles = getBottleSnapshot();
            const target = bottles.find((bottle) => bottle.id === bottleId);
            if (!target) throw new Error("指定したボトルが見つかりません。");

            const nextBottles = bottles.map((bottle) =>
              bottle.id === bottleId
                ? {
                    ...bottle,
                    drinkCount: bottle.drinkCount + 1,
                    updatedAt: new Date().toISOString(),
                  }
                : bottle,
            );
            saveBottles(nextBottles);
            setNotification(`${target.name}を飲んだ記録を追加しました。`);
            return {
              id: target.id,
              name: target.name,
              drinkCount: target.drinkCount + 1,
            };
          },
        },
        options,
      ),
    ];

    registrations.forEach((registration) => {
      void Promise.resolve(registration).catch(() => undefined);
    });

    return () => lifecycle.abort();
  }, [setNotification]);
}
