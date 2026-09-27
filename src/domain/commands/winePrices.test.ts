import { beforeEach, describe, expect, it } from "vitest";
import { exportBackup, parseBackup } from "../../db/backup";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { WineSchema } from "../types";
import { undoBatch } from "../undo";
import { CommandError } from "./core";
import { setWinePrices } from "./winePrices";
import { addBottles } from "./wines";

const PRICES = {
  summary: "Offers from a UK merchant.",
  points: [
    {
      price: "£210.00",
      amount: 210,
      currency: "GBP",
      bottleSize: null,
      kind: "retail" as const,
      source: { url: "https://www.bbr.com/x", title: "Berry Bros. & Rudd" },
    },
  ],
  found: true,
  generatedAt: "2026-09-26T12:00:00.000Z",
  model: "claude-opus-5",
};

async function seedWine() {
  await addBottles({
    drafts: [
      {
        producer: "Ridge",
        name: "Monte Bello",
        vintage: 2019,
        colour: "red",
        lots: [{ quantity: 1, pricePerBottle: 120, currency: "GBP" }],
      },
    ],
  });
  return (await db.wines.toArray())[0]!;
}

describe("setWinePrices", () => {
  beforeEach(resetDatabase);

  it("saves the prices on the wine and nothing else", async () => {
    const wine = await seedWine();
    const lotBefore = (await db.lots.toArray())[0];
    const result = await setWinePrices({ wineId: wine.id, prices: PRICES });
    const saved = await db.wines.get(wine.id);
    expect(saved).toMatchObject({ prices: PRICES, valuePerBottle: null, valueCurrency: null });
    expect((await db.lots.toArray())[0]).toEqual(lotBefore);
    expect(result.summary).toBe("Found prices for Ridge Monte Bello 2019");
  });

  it("says so when no prices were found", async () => {
    const wine = await seedWine();
    const result = await setWinePrices({
      wineId: wine.id,
      prices: { ...PRICES, summary: "", points: [], found: false },
    });
    expect(result.summary).toBe("No prices found for Ridge Monte Bello 2019");
  });

  it("refuses a price in a code that is not a currency", async () => {
    const wine = await seedWine();
    const bad = { ...PRICES, points: [{ ...PRICES.points[0]!, currency: "pounds" }] };
    await expect(setWinePrices({ wineId: wine.id, prices: bad })).rejects.toThrow();
  });

  it("removes them with prices: null, and undo brings them back", async () => {
    const wine = await seedWine();
    await setWinePrices({ wineId: wine.id, prices: PRICES });
    const result = await setWinePrices({ wineId: wine.id, prices: null });
    expect((await db.wines.get(wine.id))?.prices).toBeNull();
    expect(result.summary).toBe("Removed suggested prices for Ridge Monte Bello 2019");
    expect(await undoBatch(result.batchId!)).toMatchObject({ ok: true });
    expect((await db.wines.get(wine.id))?.prices).toEqual(PRICES);
  });

  it("undo restores the wine to before the prices were saved", async () => {
    const wine = await seedWine();
    const result = await setWinePrices({ wineId: wine.id, prices: PRICES });
    expect(await undoBatch(result.batchId!)).toMatchObject({ ok: true });
    expect((await db.wines.get(wine.id))?.prices).toBeUndefined();
  });

  it("refuses a deleted or missing wine", async () => {
    const wine = await seedWine();
    await db.wines.update(wine.id, { deletedAt: "2026-09-01T00:00:00Z" });
    await expect(setWinePrices({ wineId: wine.id, prices: PRICES })).rejects.toThrow(CommandError);
    await expect(setWinePrices({ wineId: "missing", prices: PRICES })).rejects.toThrow(
      CommandError,
    );
  });

  it("old rows without prices still parse", async () => {
    const wine = await seedWine();
    const row: Record<string, unknown> = { ...wine };
    delete row.prices;
    expect(WineSchema.parse(row).prices).toBeUndefined();
  });

  it("round-trips through a backup, and older backups without prices still parse", async () => {
    const wine = await seedWine();
    await setWinePrices({ wineId: wine.id, prices: PRICES });
    const file = await exportBackup();
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok && parsed.backup.data.wines[0]).toMatchObject({ prices: PRICES });

    const older = structuredClone(file);
    for (const row of older.data.wines as Record<string, unknown>[]) delete row.prices;
    const parsedOld = parseBackup(older);
    expect(parsedOld.ok).toBe(true);
    expect(parsedOld.ok && parsedOld.backup.data.wines[0]?.prices).toBeUndefined();
  });
});
