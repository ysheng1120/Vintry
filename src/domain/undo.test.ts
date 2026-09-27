import { beforeEach, describe, expect, it } from "vitest";
import { restoreBackup, SNAPSHOTS_KEPT } from "../db/backup";
import type { BackupFile } from "../db/backup-schema";
import { CURRENT_SCHEMA_VERSION } from "../db/migrations";
import { db } from "../db/db";
import { makeWine, resetDatabase } from "../db/testing";
import { setClock } from "./clock";
import { consumeBottles } from "./commands/consumption";
import { createLocation, deleteLocation } from "./commands/locations";
import { moveBottles } from "./commands/lots";
import { addTastingNote } from "./commands/notes";
import { wipeAll } from "./commands/admin";
import { addBottles, deleteWine, purgeDeleted } from "./commands/wines";
import { checkUndo, checkUndoAll, undoBatch } from "./undo";

async function seedLotOfSix() {
  await createLocation({ name: "Kitchen rack" });
  await createLocation({ name: "EuroCave A" });
  const kitchen = (await db.locations.where("name").equals("Kitchen rack").first())!;
  const cave = (await db.locations.where("name").equals("EuroCave A").first())!;
  const added = await addBottles({
    drafts: [
      {
        producer: "Ridge",
        name: "Monte Bello",
        vintage: 2019,
        colour: "red",
        lots: [{ quantity: 6, locationId: kitchen.id }],
      },
    ],
  });
  const lot = (await db.lots.toArray())[0]!;
  return { kitchen, cave, lot, added };
}

describe("undoBatch", () => {
  beforeEach(resetDatabase);

  it("undoing a move restores one lot of 6 and removes the split lot", async () => {
    const { cave, lot } = await seedLotOfSix();
    const move = await moveBottles({ lotId: lot.id, quantity: 2, toLocationId: cave.id });

    const result = await undoBatch(move.batchId!);
    expect(result).toEqual({
      ok: true,
      summary: "Undid: Moved 2 bottles of Ridge Monte Bello 2019 to EuroCave A",
    });
    const lots = await db.lots.toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ id: lot.id, quantity: 6, locationId: lot.locationId });
    expect((await db.eventBatches.get(move.batchId!))?.undoneAt).toBeTruthy();
  });

  it("AE4: refuses to undo a move after a later drink from the same lot, naming the blocking change", async () => {
    const { cave, lot } = await seedLotOfSix();
    const move = await moveBottles({ lotId: lot.id, quantity: 2, toLocationId: cave.id });
    const drink = await consumeBottles({ lotId: lot.id, quantity: 1 });

    const refused = await undoBatch(move.batchId!);
    expect(refused).toMatchObject({
      ok: false,
      reason:
        "A later change touched this lot (Drank 1 bottle of Ridge Monte Bello 2019). Undo that first.",
    });
    if (!refused.ok) expect(refused.blockingBatch?.id).toBe(drink.batchId);
    expect((await db.lots.get(lot.id))?.quantity).toBe(3);

    // Undo the drink first, then the move: both succeed.
    expect(await undoBatch(drink.batchId!)).toMatchObject({ ok: true });
    expect((await db.lots.get(lot.id))?.quantity).toBe(4);
    expect(await db.consumptions.count()).toBe(0);
    expect(await undoBatch(move.batchId!)).toMatchObject({ ok: true });
    const lots = await db.lots.toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]?.quantity).toBe(6);
  });

  it("names the most recent blocking change when several later changes touched the record", async () => {
    const { cave, lot } = await seedLotOfSix();
    const move = await moveBottles({ lotId: lot.id, quantity: 2, toLocationId: cave.id });
    await consumeBottles({ lotId: lot.id, quantity: 1 });
    const second = await consumeBottles({ lotId: lot.id, quantity: 2 });
    const refused = await undoBatch(move.batchId!);
    if (refused.ok) throw new Error("expected a refusal");
    expect(refused.blockingBatch?.id).toBe(second.batchId);
  });

  it("writes a fresh updatedAt on the records it restores", async () => {
    setClock("2026-09-26T10:00:00Z");
    const { lot } = await seedLotOfSix();
    const drink = await consumeBottles({ lotId: lot.id });
    setClock("2026-09-26T11:00:00Z");
    await undoBatch(drink.batchId!);
    expect((await db.lots.get(lot.id))?.updatedAt).toBe("2026-09-26T11:00:00.000Z");
  });

  it("undoing a drink also removes its tasting note", async () => {
    const { lot } = await seedLotOfSix();
    const drink = await consumeBottles({ lotId: lot.id, note: "Lovely" });
    expect(await db.tastingNotes.count()).toBe(1);
    await undoBatch(drink.batchId!);
    expect(await db.tastingNotes.count()).toBe(0);
    expect((await db.lots.get(lot.id))?.quantity).toBe(6);
  });

  it("undoing a delete brings the wine back", async () => {
    const { lot } = await seedLotOfSix();
    const deleted = await deleteWine({ wineId: lot.wineId });
    await undoBatch(deleted.batchId!);
    expect((await db.wines.get(lot.wineId))?.deletedAt).toBeNull();
  });

  it("refuses to undo an add when a later change refers to the new wine", async () => {
    const { lot, added } = await seedLotOfSix();
    await addTastingNote({ wineId: lot.wineId, text: "Young but open" });
    const refused = await undoBatch(added.batchId!);
    expect(refused).toMatchObject({
      ok: false,
      reason:
        "A later change touched this wine (Added a tasting note for Ridge Monte Bello 2019). Undo that first.",
    });
    expect(await db.wines.count()).toBe(1);
  });

  it("refuses to undo a change that would point at a location deleted since", async () => {
    const { lot, kitchen, cave } = await seedLotOfSix();
    const move = await moveBottles({ lotId: lot.id, quantity: 6, toLocationId: cave.id });
    await deleteLocation({ locationId: kitchen.id });
    const refused = await undoBatch(move.batchId!);
    expect(refused).toMatchObject({
      ok: false,
      reason:
        "A later change touched this location (Deleted location Kitchen rack). Undo that first.",
    });
  });

  it("refuses to undo twice and reports unknown batches", async () => {
    const { added } = await seedLotOfSix();
    const first = await undoBatch(added.batchId!);
    expect(first.ok).toBe(true);
    expect(await undoBatch(added.batchId!)).toEqual({
      ok: false,
      reason: "This change has already been undone.",
    });
    expect(await undoBatch("missing")).toEqual({
      ok: false,
      reason: "This change is no longer in the history.",
    });
  });

  it("checkUndo reports the same answer without changing anything", async () => {
    const { cave, lot } = await seedLotOfSix();
    const move = await moveBottles({ lotId: lot.id, quantity: 2, toLocationId: cave.id });
    expect(await checkUndo(move.batchId!)).toEqual({ ok: true });
    await consumeBottles({ lotId: lot.id });
    expect((await checkUndo(move.batchId!)).ok).toBe(false);
    expect(await db.lots.count()).toBe(2);
  });

  it("AE6: undoing a restore brings the previous 40 wines back from the safety snapshot", async () => {
    await db.wines.bulkAdd(Array.from({ length: 40 }, (_, i) => makeWine({ name: `Cuvée ${i}` })));
    const { batchId } = await restoreBackup({
      app: "vintry",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        wines: [makeWine({ producer: "Krug" })],
        lots: [],
        consumptions: [],
        tastingNotes: [],
        locations: [],
        wishlist: [],
        eventBatches: [],
        chatThreads: [],
        chatMessages: [],
        settings: [],
      },
    });
    expect(await db.wines.count()).toBe(1);
    expect(await undoBatch(batchId)).toMatchObject({ ok: true });
    expect(await db.wines.count()).toBe(40);
  });
});

function backupWith(wines: ReturnType<typeof makeWine>[]): BackupFile {
  return {
    app: "vintry",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      wines,
      lots: [],
      consumptions: [],
      tastingNotes: [],
      locations: [],
      wishlist: [],
      eventBatches: [],
      chatThreads: [],
      chatMessages: [],
      settings: [],
    },
  };
}

const wineNames = async () => (await db.wines.toArray()).map((w) => w.name).sort();

describe("undoing restores and erases in a chain", () => {
  beforeEach(resetDatabase);

  it("restore A, restore B, undo B, undo A brings the original wines back", async () => {
    await db.wines.bulkAdd([makeWine({ name: "Original 1" }), makeWine({ name: "Original 2" })]);
    const first = await restoreBackup(backupWith([makeWine({ name: "From A" })]));
    const second = await restoreBackup(backupWith([makeWine({ name: "From B" })]));

    expect(await undoBatch(second.batchId)).toMatchObject({ ok: true });
    expect(await wineNames()).toEqual(["From A"]);
    // The undone restore stays in the history, marked undone, and does not block the earlier one.
    expect((await db.eventBatches.get(second.batchId))?.undoneAt).toBeTruthy();
    expect(await checkUndo(first.batchId)).toEqual({ ok: true });

    expect(await undoBatch(first.batchId)).toMatchObject({ ok: true });
    expect(await wineNames()).toEqual(["Original 1", "Original 2"]);
    expect((await db.eventBatches.get(first.batchId))?.undoneAt).toBeTruthy();
    // Nothing left to undo that would bring B or A back.
    const open = (await db.eventBatches.toArray()).filter((b) => b.snapshotId && !b.undoneAt);
    expect(open).toEqual([]);
  });

  it("erase, restore, undo the restore, undo the erase brings the original wines back", async () => {
    await db.wines.add(makeWine({ name: "Original" }));
    const wipe = await wipeAll({});
    const restore = await restoreBackup(backupWith([makeWine({ name: "From A" })]));
    expect(await undoBatch(restore.batchId)).toMatchObject({ ok: true });
    expect(await db.wines.count()).toBe(0);
    expect(await undoBatch(wipe.batchId!)).toMatchObject({ ok: true });
    expect(await wineNames()).toEqual(["Original"]);
  });

  it("keeps the safety copy a restore still needs, however many copies are taken after it", async () => {
    await db.wines.add(makeWine({ name: "Original" }));
    const first = await restoreBackup(backupWith([makeWine({ name: "From A" })]));
    for (let i = 0; i < SNAPSHOTS_KEPT + 2; i++) {
      // Each restore of B is undone again, so the first restore stays the one to undo.
      const other = await restoreBackup(backupWith([makeWine({ name: `B${i}` })]));
      expect(await undoBatch(other.batchId)).toMatchObject({ ok: true });
    }
    expect(await db.snapshots.get(first.snapshotId)).toBeDefined();
    expect(await undoBatch(first.batchId)).toMatchObject({ ok: true });
    expect(await wineNames()).toEqual(["Original"]);
  });

  it("refuses plainly, without throwing, when the safety copy is gone", async () => {
    await db.wines.add(makeWine({ name: "Original" }));
    const { batchId, snapshotId } = await restoreBackup(backupWith([makeWine({ name: "A" })]));
    await db.snapshots.delete(snapshotId);

    const reason = "The safety copy for this change is no longer available.";
    expect(await checkUndo(batchId)).toEqual({ ok: false, reason });
    const batch = (await db.eventBatches.get(batchId))!;
    expect((await checkUndoAll([batch])).get(batchId)).toEqual({ ok: false, reason });
    expect(await undoBatch(batchId)).toEqual({ ok: false, reason });
    expect(await wineNames()).toEqual(["A"]);
  });
});

describe("checkUndoAll", () => {
  beforeEach(resetDatabase);

  it("gives the same answer as checkUndo for every batch", async () => {
    // Batches from before the wipe are gone from the history: both report them missing.
    await seedLotOfSix();
    const beforeWipe = await db.eventBatches.toArray();
    await wipeAll({});

    // After the wipe: the wipe itself is blocked by the later changes.
    const { cave, lot } = await seedLotOfSix();
    const move = await moveBottles({ lotId: lot.id, quantity: 2, toLocationId: cave.id });
    await consumeBottles({ lotId: lot.id, quantity: 1 }); // blocks the move
    const note = await addTastingNote({ wineId: lot.wineId, text: "Lovely" });
    await undoBatch(note.batchId!); // undone: no longer blocks anything
    await createLocation({ name: "Garage" });
    const garage = (await db.locations.where("name").equals("Garage").first())!;
    await moveBottles({ lotId: lot.id, quantity: 1, toLocationId: garage.id });
    await createLocation({ name: "Shed" });
    const shed = (await db.locations.where("name").equals("Shed").first())!;
    await deleteLocation({ locationId: shed.id }); // blocks creating the shed

    const history = await db.eventBatches.orderBy("createdAt").reverse().toArray();
    const batches = [...history, ...beforeWipe];
    const all = await checkUndoAll(batches);

    const expected = new Map();
    for (const batch of batches) expected.set(batch.id, await checkUndo(batch.id));
    expect(all).toEqual(expected);

    // The sequence covers every kind of answer.
    const reasons = [...all.values()].map((c) => (c.ok ? "ok" : c.reason));
    expect(reasons).toContain("ok");
    expect(reasons).toContain("This change has already been undone.");
    expect(reasons).toContain("This change is no longer in the history.");
    expect(reasons.some((r) => r.includes("touched your data"))).toBe(true);
    expect(reasons.some((r) => r.includes("touched this lot"))).toBe(true);
    expect(reasons.some((r) => r.includes("touched this location"))).toBe(true);
    expect(all.get(move.batchId!)).toMatchObject({ ok: false });
  });

  it("returns an empty map for no batches", async () => {
    expect((await checkUndoAll([])).size).toBe(0);
  });
});

describe("permanent removal", () => {
  beforeEach(resetDatabase);

  it("does not let Undo bring back a wine that was deleted forever", async () => {
    const added = await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 2 }] }],
    });
    const wineId = added.touched.wineIds[0]!;
    await deleteWine({ wineId });
    const purged = await purgeDeleted({ wineId });

    const check = await checkUndo(purged.batchId!);
    expect(check.ok).toBe(false);
    expect(
      (await checkUndoAll([(await db.eventBatches.get(purged.batchId!))!])).get(purged.batchId!),
    ).toEqual(check);
    expect((await undoBatch(purged.batchId!)).ok).toBe(false);
    expect(await db.wines.get(wineId)).toBeUndefined();
  });
});
