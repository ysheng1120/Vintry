import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLot, makeWine, resetDatabase } from "../../db/testing";
import { runReadTool } from "./readTools";

describe("show_bottles", () => {
  beforeEach(resetDatabase);

  it("keeps the given order once per wine, counting open lots, and drops deleted or empty wines", async () => {
    const first = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    const second = makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null });
    const deleted = makeWine({ producer: "Gone", deletedAt: "2026-09-01T00:00:00.000Z" });
    const empty = makeWine({ producer: "Empty" });
    await db.wines.bulkAdd([first, second, deleted, empty]);
    await db.lots.bulkAdd([
      makeLot({ wineId: first.id, quantity: 2 }),
      makeLot({ wineId: first.id, quantity: 3 }),
      makeLot({ wineId: second.id, quantity: 1 }),
      makeLot({ wineId: deleted.id, quantity: 4 }),
      makeLot({ wineId: empty.id, quantity: 0 }),
    ]);

    const outcome = await runReadTool("show_bottles", {
      wineIds: [second.id, deleted.id, first.id, empty.id, second.id],
    });

    expect(outcome.isError).toBe(false);
    expect(outcome.wineIds).toEqual([second.id, first.id]);
    expect(JSON.parse(outcome.content)).toEqual({
      shown: [
        { wineId: second.id, wine: "Krug Grande Cuvée NV", bottles: 1 },
        { wineId: first.id, wine: "Ridge Monte Bello 2019", bottles: 5 },
      ],
    });
  });
});
