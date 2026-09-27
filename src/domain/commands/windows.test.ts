import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { setDrinkingWindow } from "./windows";
import { addBottles } from "./wines";

async function seedWine(window?: {
  windowFrom: number;
  windowTo: number;
  windowSource: "user" | "ai";
}) {
  await addBottles({
    drafts: [
      {
        producer: "Ridge",
        name: "Monte Bello",
        vintage: 2019,
        colour: "red",
        ...window,
        lots: [{ quantity: 1 }],
      },
    ],
  });
  return (await db.wines.toArray())[0]!;
}

describe("setDrinkingWindow", () => {
  beforeEach(resetDatabase);

  it("records a sommelier window as an AI estimate even when it asks for user", async () => {
    const wine = await seedWine();
    await setDrinkingWindow(
      { wineId: wine.id, from: 2028, to: 2045, source: "user" },
      { source: "ai-chat" },
    );
    expect((await db.wines.get(wine.id))?.windowSource).toBe("ai");
  });

  it("still refuses to replace the collector's window when a sommelier change asks as user", async () => {
    const wine = await seedWine({ windowFrom: 2025, windowTo: 2030, windowSource: "user" });
    await expect(
      setDrinkingWindow(
        { wineId: wine.id, from: 2028, to: 2045, source: "user" },
        { source: "ai-chat" },
      ),
    ).rejects.toThrow(/set this wine's drinking window yourself/);
    expect(await db.wines.get(wine.id)).toMatchObject({ windowFrom: 2025, windowSource: "user" });
  });

  it("applies an AI estimate to a wine with no window", async () => {
    const wine = await seedWine();
    const result = await setDrinkingWindow(
      { wineId: wine.id, from: 2028, to: 2045, source: "ai", note: "Needs time" },
      { source: "ai-chat" },
    );
    expect(await db.wines.get(wine.id)).toMatchObject({
      windowFrom: 2028,
      windowTo: 2045,
      windowSource: "ai",
      windowNote: "Needs time",
    });
    expect(result.summary).toBe("Set drinking window for Ridge Monte Bello 2019 to 2028–2045");
  });

  it("requires the overwrite flag to replace a window the user set", async () => {
    const wine = await seedWine({ windowFrom: 2025, windowTo: 2040, windowSource: "user" });
    await expect(
      setDrinkingWindow({ wineId: wine.id, from: 2028, to: 2045, source: "ai" }),
    ).rejects.toThrow("You set this wine's drinking window yourself. Confirm to replace it.");
    expect((await db.wines.get(wine.id))?.windowFrom).toBe(2025);

    await setDrinkingWindow({
      wineId: wine.id,
      from: 2028,
      to: 2045,
      source: "ai",
      overwrite: true,
    });
    expect(await db.wines.get(wine.id)).toMatchObject({ windowFrom: 2028, windowSource: "ai" });
  });

  it("lets an AI estimate replace an earlier AI estimate, and the user replace anything", async () => {
    const wine = await seedWine({ windowFrom: 2025, windowTo: 2040, windowSource: "ai" });
    await setDrinkingWindow({ wineId: wine.id, from: 2026, to: 2041, source: "ai" });
    await setDrinkingWindow({ wineId: wine.id, from: 2030, to: 2050, source: "user" });
    expect(await db.wines.get(wine.id)).toMatchObject({ windowFrom: 2030, windowSource: "user" });
  });

  it("clears the window when both years are null", async () => {
    const wine = await seedWine({ windowFrom: 2025, windowTo: 2040, windowSource: "user" });
    await setDrinkingWindow({ wineId: wine.id, from: null, to: null, source: "user" });
    expect(await db.wines.get(wine.id)).toMatchObject({
      windowFrom: null,
      windowTo: null,
      windowSource: null,
    });
  });

  it("rejects a window that ends before it starts", async () => {
    const wine = await seedWine();
    await expect(
      setDrinkingWindow({ wineId: wine.id, from: 2040, to: 2030, source: "user" }),
    ).rejects.toThrow(/before/);
  });
});
