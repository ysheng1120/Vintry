import { beforeEach, describe, expect, it } from "vitest";
import { exportBackup, parseBackup } from "../../db/backup";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { WineSchema } from "../types";
import { undoBatch } from "../undo";
import { CommandError } from "./core";
import { setWineCritics } from "./wineCritics";
import { addBottles } from "./wines";

const CRITICS = {
  consensus: "Critics agree the 2019 is fresh and long.",
  points: [
    {
      text: "Long, cool and savoury",
      sources: [{ url: "https://www.jancisrobinson.com/x", title: "Jancis" }],
    },
  ],
  scores: [
    {
      critic: "Jancis Robinson",
      publication: "JancisRobinson.com",
      score: "17.5",
      scale: "20",
      source: { url: "https://www.jancisrobinson.com/x", title: "Jancis" },
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
        lots: [{ quantity: 1 }],
      },
    ],
  });
  return (await db.wines.toArray())[0]!;
}

describe("setWineCritics", () => {
  beforeEach(resetDatabase);

  it("saves what critics say on the wine", async () => {
    const wine = await seedWine();
    const result = await setWineCritics({ wineId: wine.id, critics: CRITICS });
    expect(await db.wines.get(wine.id)).toMatchObject({ critics: CRITICS });
    expect(result.summary).toBe("Found what critics say about Ridge Monte Bello 2019");
  });

  it("says so when no reviews were found", async () => {
    const wine = await seedWine();
    const result = await setWineCritics({
      wineId: wine.id,
      critics: { ...CRITICS, consensus: "", points: [], scores: [], found: false },
    });
    expect(result.summary).toBe("No critic reviews found for Ridge Monte Bello 2019");
  });

  it("removes it with critics: null, and undo brings it back", async () => {
    const wine = await seedWine();
    await setWineCritics({ wineId: wine.id, critics: CRITICS });
    const result = await setWineCritics({ wineId: wine.id, critics: null });
    expect((await db.wines.get(wine.id))?.critics).toBeNull();
    expect(result.summary).toBe("Removed what critics say about Ridge Monte Bello 2019");
    expect(await undoBatch(result.batchId!)).toMatchObject({ ok: true });
    expect((await db.wines.get(wine.id))?.critics).toEqual(CRITICS);
  });

  it("undo restores the wine to before the summary was saved", async () => {
    const wine = await seedWine();
    const result = await setWineCritics({ wineId: wine.id, critics: CRITICS });
    expect(await undoBatch(result.batchId!)).toMatchObject({ ok: true });
    expect((await db.wines.get(wine.id))?.critics).toBeUndefined();
  });

  it("refuses a deleted or missing wine", async () => {
    const wine = await seedWine();
    await db.wines.update(wine.id, { deletedAt: "2026-09-01T00:00:00Z" });
    await expect(setWineCritics({ wineId: wine.id, critics: CRITICS })).rejects.toThrow(
      CommandError,
    );
    await expect(setWineCritics({ wineId: "missing", critics: CRITICS })).rejects.toThrow(
      CommandError,
    );
  });

  it("old rows without critics still parse", async () => {
    const wine = await seedWine();
    const row: Record<string, unknown> = { ...wine };
    delete row.critics;
    expect(WineSchema.parse(row).critics).toBeUndefined();
  });

  it("round-trips through a backup, and older backups without critics still parse", async () => {
    const wine = await seedWine();
    await setWineCritics({ wineId: wine.id, critics: CRITICS });
    const file = await exportBackup();
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok && parsed.backup.data.wines[0]).toMatchObject({ critics: CRITICS });

    const older = structuredClone(file);
    for (const row of older.data.wines as Record<string, unknown>[]) delete row.critics;
    const parsedOld = parseBackup(older);
    expect(parsedOld.ok).toBe(true);
    expect(parsedOld.ok && parsedOld.backup.data.wines[0]?.critics).toBeUndefined();
  });
});
