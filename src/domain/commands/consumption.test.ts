import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { getCellarList } from "../selectors";
import { consumeBottles } from "./consumption";
import { addBottles } from "./wines";

async function seedLot(quantity: number) {
  await addBottles({
    drafts: [
      {
        producer: "Ridge",
        name: "Monte Bello",
        vintage: 2019,
        colour: "red",
        lots: [{ quantity }],
      },
    ],
  });
  return (await db.lots.toArray())[0]!;
}

describe("consumeBottles", () => {
  beforeEach(resetDatabase);

  it("drinking 2 from a lot of 3 leaves 1 and records one consumption with date and rating", async () => {
    const lot = await seedLot(3);
    const result = await consumeBottles({
      lotId: lot.id,
      quantity: 2,
      date: "2026-09-20",
      rating: 93,
      occasion: "Sunday lunch",
    });

    expect((await db.lots.get(lot.id))?.quantity).toBe(1);
    expect((await db.lots.get(lot.id))?.closedAt).toBeNull();
    const consumptions = await db.consumptions.toArray();
    expect(consumptions).toHaveLength(1);
    expect(consumptions[0]).toMatchObject({
      wineId: lot.wineId,
      lotId: lot.id,
      quantity: 2,
      date: "2026-09-20",
      rating: 93,
      occasion: "Sunday lunch",
    });
    expect(result.summary).toBe("Drank 2 bottles of Ridge Monte Bello 2019");
    expect(await db.tastingNotes.count()).toBe(0);
  });

  it("stores a note as a tasting note linked to the consumption", async () => {
    const lot = await seedLot(3);
    await consumeBottles({ lotId: lot.id, note: "Cassis, cedar, long finish", rating: 95 });
    const consumption = (await db.consumptions.toArray())[0]!;
    const notes = await db.tastingNotes.toArray();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      wineId: lot.wineId,
      consumptionId: consumption.id,
      text: "Cassis, cedar, long finish",
      rating: 95,
      date: consumption.date,
    });
    expect(consumption.quantity).toBe(1);
  });

  it("drinking the last bottle closes the lot and the wine shows under the Drunk filter", async () => {
    const lot = await seedLot(1);
    await consumeBottles({ lotId: lot.id, quantity: 1 });

    const stored = await db.lots.get(lot.id);
    expect(stored?.quantity).toBe(0);
    expect(stored?.closedAt).toBeTruthy();
    expect(await getCellarList({})).toHaveLength(0);
    const drunk = await getCellarList({ drunkOnly: true });
    expect(drunk.map((row) => row.wine.id)).toEqual([lot.wineId]);
    expect(await getCellarList({ includeDrunk: true })).toHaveLength(1);
  });

  it("drinking more than the lot holds fails and changes nothing", async () => {
    const lot = await seedLot(2);
    await expect(consumeBottles({ lotId: lot.id, quantity: 3 })).rejects.toThrow(
      "Only 2 bottles left in this lot.",
    );
    expect((await db.lots.get(lot.id))?.quantity).toBe(2);
    expect(await db.consumptions.count()).toBe(0);
    expect(await db.eventBatches.count()).toBe(1);
  });

  it("refuses when the lot no longer holds the expected quantity", async () => {
    const lot = await seedLot(2);
    await expect(
      consumeBottles({ lotId: lot.id, quantity: 1, expectedQuantity: 3 }),
    ).rejects.toThrow("This lot now holds 2 bottles, not 3.");
  });

  it("rejects a rating outside 0 to 100", async () => {
    const lot = await seedLot(2);
    await expect(consumeBottles({ lotId: lot.id, rating: 101 })).rejects.toThrow(/rating/);
  });
});
