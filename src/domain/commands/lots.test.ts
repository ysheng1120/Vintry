import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { createLocation } from "./locations";
import { adjustQuantity, moveBottles } from "./lots";
import { addBottles } from "./wines";

async function seed() {
  await createLocation({ name: "Kitchen rack" });
  await createLocation({ name: "EuroCave A" });
  const [kitchen, cave] = await db.locations.orderBy("name").reverse().toArray();
  await addBottles({
    drafts: [
      {
        producer: "Ridge",
        name: "Monte Bello",
        vintage: 2019,
        colour: "red",
        lots: [
          {
            quantity: 6,
            locationId: kitchen!.id,
            pricePerBottle: 250,
            currency: "USD",
            purchaseDate: "2024-03-01",
            store: "K&L",
          },
        ],
      },
    ],
  });
  const lot = (await db.lots.toArray())[0]!;
  return { kitchen: kitchen!, cave: cave!, lot };
}

describe("moveBottles", () => {
  beforeEach(resetDatabase);

  it("moving 2 from a lot of 6 splits a new lot of 2 at the target and leaves 4", async () => {
    const { cave, lot } = await seed();
    const result = await moveBottles({
      lotId: lot.id,
      quantity: 2,
      toLocationId: cave.id,
      bin: "B3",
    });

    expect((await db.lots.get(lot.id))?.quantity).toBe(4);
    const split = (await db.lots.toArray()).find((l) => l.id !== lot.id);
    expect(split).toMatchObject({
      wineId: lot.wineId,
      quantity: 2,
      locationId: cave.id,
      bin: "B3",
      splitFromLotId: lot.id,
      pricePerBottle: 250,
      currency: "USD",
      purchaseDate: "2024-03-01",
      store: "K&L",
      closedAt: null,
    });
    expect(result.summary).toBe("Moved 2 bottles of Ridge Monte Bello 2019 to EuroCave A");
    expect(result.touched.lotIds.sort()).toEqual([lot.id, split!.id].sort());
  });

  it("moving the whole lot changes its location without splitting", async () => {
    const { cave, lot } = await seed();
    await moveBottles({ lotId: lot.id, quantity: 6, toLocationId: cave.id });
    expect(await db.lots.count()).toBe(1);
    expect((await db.lots.get(lot.id))?.locationId).toBe(cave.id);
  });

  it("refuses to move more bottles than the lot holds", async () => {
    const { cave, lot } = await seed();
    await expect(
      moveBottles({ lotId: lot.id, quantity: 7, toLocationId: cave.id }),
    ).rejects.toThrow("Only 6 bottles left in this lot.");
  });

  it("refuses an unknown target location", async () => {
    const { lot } = await seed();
    await expect(moveBottles({ lotId: lot.id, quantity: 1, toLocationId: "nope" })).rejects.toThrow(
      /location/i,
    );
  });
});

describe("adjustQuantity", () => {
  beforeEach(resetDatabase);

  it("sets a new count, closing the lot at zero and reopening it above zero", async () => {
    const { lot } = await seed();
    const result = await adjustQuantity({ lotId: lot.id, quantity: 0 });
    expect(await db.lots.get(lot.id)).toMatchObject({ quantity: 0 });
    expect((await db.lots.get(lot.id))?.closedAt).toBeTruthy();
    expect(result.summary).toBe("Set Ridge Monte Bello 2019 to 0 bottles");

    await adjustQuantity({ lotId: lot.id, quantity: 5 });
    expect(await db.lots.get(lot.id)).toMatchObject({ quantity: 5, closedAt: null });
    expect(await db.consumptions.count()).toBe(0);
  });
});
