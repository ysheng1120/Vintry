import { beforeEach, describe, expect, it } from "vitest";
import { exportBackup, parseBackup } from "../../db/backup";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { WinePriceCheckSchema, WineSchema, type WinePriceCheck } from "../types";
import { undoBatch } from "../undo";
import { CommandError } from "./core";
import { setWinePriceCheck } from "./winePriceCheck";
import { addBottles } from "./wines";

const SOURCE = { url: "https://www.bbr.com/x", title: "Berry Bros" };

const PRICE_CHECK: WinePriceCheck = {
  checkedFor: { producer: "Ridge", name: "Monte Bello", vintage: 2019, bottleSize: 750 },
  ranges: [{ currency: "GBP", low: 180, middle: 195, high: 210, count: 3, usable: true }],
  listings: [
    {
      amount: "£195",
      value: 195,
      currency: "£",
      merchant: "Berry Bros",
      unit: "bottle",
      sizeMl: 750,
      vintage: 2019,
      basis: "duty-paid retail",
      availability: "for sale",
      inRange: true,
      source: SOURCE,
    },
  ],
  found: true,
  generatedAt: "2026-10-01T12:00:00.000Z",
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
        lots: [{ quantity: 1 }],
      },
    ],
  });
  return (await db.wines.toArray())[0]!;
}

describe("setWinePriceCheck", () => {
  beforeEach(resetDatabase);

  it("saves the price check on the wine", async () => {
    const wine = await seedWine();
    const result = await setWinePriceCheck({ wineId: wine.id, priceCheck: PRICE_CHECK });
    expect(await db.wines.get(wine.id)).toMatchObject({ priceCheck: PRICE_CHECK });
    expect(result.summary).toBe("Found prices for Ridge Monte Bello 2019");
  });

  it("says so when no prices were found", async () => {
    const wine = await seedWine();
    const result = await setWinePriceCheck({
      wineId: wine.id,
      priceCheck: { ...PRICE_CHECK, ranges: [], listings: [], found: false },
    });
    expect(result.summary).toBe("No current prices found for Ridge Monte Bello 2019");
  });

  it("removes it with priceCheck: null, and undo brings it back", async () => {
    const wine = await seedWine();
    await setWinePriceCheck({ wineId: wine.id, priceCheck: PRICE_CHECK });
    const result = await setWinePriceCheck({ wineId: wine.id, priceCheck: null });
    expect((await db.wines.get(wine.id))?.priceCheck).toBeNull();
    expect(result.summary).toBe("Removed the price check for Ridge Monte Bello 2019");
    expect(await undoBatch(result.batchId!)).toMatchObject({ ok: true });
    expect((await db.wines.get(wine.id))?.priceCheck).toEqual(PRICE_CHECK);
  });

  it("undo restores the wine to before the result was saved", async () => {
    const wine = await seedWine();
    const before = await db.wines.get(wine.id);
    const result = await setWinePriceCheck({ wineId: wine.id, priceCheck: PRICE_CHECK });
    expect(await undoBatch(result.batchId!)).toMatchObject({ ok: true });
    // Undo restores every field; only the bookkeeping timestamp moves.
    expect({ ...(await db.wines.get(wine.id)), updatedAt: "" }).toEqual({
      ...before,
      updatedAt: "",
    });
    expect((await db.wines.get(wine.id))?.priceCheck).toBeUndefined();
  });

  it("replacing a result then undoing brings the earlier result back", async () => {
    const wine = await seedWine();
    await setWinePriceCheck({ wineId: wine.id, priceCheck: PRICE_CHECK });
    const next = { ...PRICE_CHECK, generatedAt: "2026-10-02T12:00:00.000Z" };
    const result = await setWinePriceCheck({ wineId: wine.id, priceCheck: next });
    expect((await db.wines.get(wine.id))?.priceCheck).toEqual(next);
    expect(await undoBatch(result.batchId!)).toMatchObject({ ok: true });
    expect((await db.wines.get(wine.id))?.priceCheck).toEqual(PRICE_CHECK);
  });

  it("refuses a deleted or missing wine", async () => {
    const wine = await seedWine();
    await db.wines.update(wine.id, { deletedAt: "2026-09-01T00:00:00Z" });
    await expect(setWinePriceCheck({ wineId: wine.id, priceCheck: PRICE_CHECK })).rejects.toThrow(
      CommandError,
    );
    await expect(setWinePriceCheck({ wineId: "missing", priceCheck: PRICE_CHECK })).rejects.toThrow(
      CommandError,
    );
  });

  it("rejects labels outside the allowed set", () => {
    const bad = {
      ...PRICE_CHECK,
      listings: [{ ...PRICE_CHECK.listings[0]!, unit: "pallet" }],
    };
    expect(WinePriceCheckSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps an unresolved currency symbol and a null size or vintage", () => {
    const parsed = WinePriceCheckSchema.parse({
      ...PRICE_CHECK,
      listings: [
        { ...PRICE_CHECK.listings[0]!, currency: "$", sizeMl: null, vintage: null, inRange: false },
      ],
    });
    expect(parsed.listings[0]).toMatchObject({ currency: "$", sizeMl: null, vintage: null });
  });

  it("old rows without priceCheck still parse", async () => {
    const wine = await seedWine();
    const row: Record<string, unknown> = { ...wine };
    delete row.priceCheck;
    expect(WineSchema.parse(row).priceCheck).toBeUndefined();
  });

  it("round-trips through a backup, and older backups without priceCheck still parse", async () => {
    const wine = await seedWine();
    await setWinePriceCheck({ wineId: wine.id, priceCheck: PRICE_CHECK });
    const file = await exportBackup();
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok && parsed.backup.data.wines[0]).toMatchObject({ priceCheck: PRICE_CHECK });

    const older = structuredClone(file);
    for (const row of older.data.wines as Record<string, unknown>[]) delete row.priceCheck;
    const parsedOld = parseBackup(older);
    expect(parsedOld.ok).toBe(true);
    expect(parsedOld.ok && parsedOld.backup.data.wines[0]?.priceCheck).toBeUndefined();
  });
});
