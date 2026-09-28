import { beforeEach, describe, expect, it } from "vitest";
import { exportBackup, parseBackup, restoreBackup } from "../db/backup";
import type { BackupFile } from "../db/backup-schema";
import { db } from "../db/db";
import { CURRENT_SCHEMA_VERSION } from "../db/migrations";
import { makeLot, makeWine, resetDatabase } from "../db/testing";
import { setClock } from "./clock";
import { consumeBottles } from "./commands/consumption";
import { createLocation, deleteLocation, renameLocation } from "./commands/locations";
import { adjustQuantity, moveBottles } from "./commands/lots";
import { mergeWines } from "./commands/merge";
import { addTastingNote, deleteTastingNote, updateTastingNote } from "./commands/notes";
import { clearSampleCellar, loadSampleCellar } from "./commands/sample";
import { setDrinkingWindow } from "./commands/windows";
import { setWineProfile } from "./commands/wineProfile";
import { addBottles, deleteWine, importRows, restoreWine, updateWine } from "./commands/wines";
import {
  addWishlistItem,
  convertWishlistItem,
  removeWishlistItem,
  updateWishlistItem,
} from "./commands/wishlist";
import { TABLE_NAMES, type EventBatch, type Wine } from "./types";
import { checkUndo, undoBatch } from "./undo";

const THUMBNAIL = `data:image/jpeg;base64,${"B".repeat(5_000)}`;

function withoutUpdatedAt(row: object): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row };
  delete copy.updatedAt;
  return copy;
}

/** Every record table, rows sorted by id, without `updatedAt` (undo stamps a fresh one). */
async function state() {
  const out: Record<string, unknown[]> = {};
  for (const table of TABLE_NAMES) {
    const rows = (await db.table(table).toArray()) as Record<string, unknown>[];
    out[table] = rows
      .map(withoutUpdatedAt)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return out;
}

const location = async (name: string) =>
  (await db.locations.where("name").equals(name).first())!.id;
const wineNamed = async (name: string) => (await db.wines.filter((w) => w.name === name).first())!;

describe("compact updates", () => {
  beforeEach(resetDatabase);

  it("stores only the changed fields of an update, never an unchanged label image", async () => {
    const added = await addBottles({
      drafts: [
        {
          producer: "Ridge",
          name: "Monte Bello",
          vintage: 2019,
          colour: "red",
          thumbnail: THUMBNAIL,
          lots: [{ quantity: 6 }],
        },
      ],
    });
    const wineId = added.touched.wineIds[0]!;
    const edit = await updateWine({ wineId, patch: { notes: "Decant for an hour" } });
    const batch = (await db.eventBatches.get(edit.batchId!))!;
    expect(batch.changes).toHaveLength(1);
    const [change] = batch.changes;
    expect(change?.fields).toEqual(["notes"]);
    expect(change?.before).toEqual({
      id: wineId,
      updatedAt: expect.any(String),
      notes: null,
    });
    expect(change?.after).toMatchObject({ id: wineId, notes: "Decant for an hour" });
    expect(JSON.stringify(batch)).not.toContain(THUMBNAIL);
  });

  it("keeps the fields that point at other records in every image", async () => {
    await createLocation({ name: "Cave" });
    await addBottles({
      drafts: [
        {
          producer: "Ridge",
          vintage: 2019,
          colour: "red",
          lots: [{ quantity: 6, locationId: await location("Cave") }],
        },
      ],
    });
    const lot = (await db.lots.toArray())[0]!;
    const fix = await adjustQuantity({ lotId: lot.id, quantity: 5 });
    const [change] = (await db.eventBatches.get(fix.batchId!))!.changes;
    expect(change?.fields).toEqual(["quantity"]);
    expect(change?.before).toMatchObject({ wineId: lot.wineId, locationId: lot.locationId });
    expect(change?.after).toMatchObject({ wineId: lot.wineId, locationId: lot.locationId });
  });
});

describe("undo is exact with compact batches", () => {
  beforeEach(resetDatabase);

  it("undoing every kind of change in reverse brings back each earlier state exactly", async () => {
    let tick = Date.parse("2026-09-01T09:00:00Z");
    const states: Awaited<ReturnType<typeof state>>[] = [];
    const batches: string[] = [];
    async function step(run: () => Promise<{ batchId: string | null }>) {
      setClock(new Date((tick += 60_000)).toISOString());
      states.push(await state());
      const { batchId } = await run();
      expect(batchId).toBeTruthy();
      batches.push(batchId!);
    }

    await step(() => createLocation({ name: "Kitchen rack" }));
    await step(() => createLocation({ name: "EuroCave A" }));
    await step(async () =>
      addBottles({
        drafts: [
          {
            producer: "Ridge",
            name: "Monte Bello",
            vintage: 2019,
            colour: "red",
            thumbnail: THUMBNAIL,
            grapes: ["Cabernet Sauvignon"],
            lots: [{ quantity: 6, locationId: await location("Kitchen rack") }],
          },
        ],
      }),
    );
    const ridge = await wineNamed("Monte Bello");
    const lotId = (await db.lots.toArray())[0]!.id;
    await step(() =>
      updateWine({
        wineId: ridge.id,
        patch: { notes: "Decant", grapes: ["Cabernet Sauvignon", "Merlot"], rating: 96 },
      }),
    );
    await step(() =>
      updateWine({ wineId: ridge.id, patch: { valuePerBottle: 250, valueCurrency: "USD" } }),
    );
    await step(() => updateWine({ wineId: ridge.id, patch: { valuePerBottle: null } }));
    await step(() =>
      setDrinkingWindow({ wineId: ridge.id, from: 2027, to: 2045, source: "user", note: "Ages" }),
    );
    await step(() =>
      setWineProfile({
        wineId: ridge.id,
        profile: {
          summary: "Structured red.",
          tasting: "Blackcurrant.",
          pairings: ["Lamb"],
          serving: "16°C.",
          generatedAt: "2026-09-01T00:00:00.000Z",
          model: "claude-opus-5",
        },
      }),
    );
    await step(async () =>
      moveBottles({ lotId, quantity: 2, toLocationId: await location("EuroCave A") }),
    );
    await step(() => consumeBottles({ lotId, quantity: 1, note: "Lovely", rating: 95 }));
    await step(() => adjustQuantity({ lotId, quantity: 2 }));
    await step(() => addTastingNote({ wineId: ridge.id, text: "Still young" }));
    const noteId = (await db.tastingNotes.toArray()).find((n) => n.text === "Still young")!.id;
    await step(() => updateTastingNote({ noteId, text: "Opening up", rating: 94 }));
    await step(() => deleteTastingNote({ noteId }));
    await step(async () =>
      renameLocation({ locationId: await location("Kitchen rack"), name: "Rack" }),
    );
    await step(() =>
      importRows({
        rows: [
          {
            producer: "Krug",
            name: "Grande Cuvée",
            vintage: null,
            colour: "sparkling",
            lots: [{ quantity: 2 }],
          },
          {
            producer: "Ridge",
            name: "Monte Bello",
            vintage: 2019,
            colour: "red",
            lots: [{ quantity: 1 }],
          },
        ],
      }),
    );
    await step(() =>
      addBottles({
        drafts: [
          {
            producer: "Ridge",
            name: "MB",
            vintage: 2019,
            colour: "red",
            region: "Santa Cruz Mountains",
            lots: [{ quantity: 1 }],
          },
        ],
      }),
    );
    const duplicate = await wineNamed("MB");
    await step(() => mergeWines({ keepId: ridge.id, mergeId: duplicate.id }));
    const caveId = await location("EuroCave A");
    const caveLot = (await db.lots.toArray()).find((l) => l.locationId === caveId)!;
    await step(() => adjustQuantity({ lotId: caveLot.id, quantity: 0 }));
    await step(() => deleteLocation({ locationId: caveId }));
    await step(() => deleteWine({ wineId: ridge.id }));
    await step(() => restoreWine({ wineId: ridge.id }));
    await step(() => addWishlistItem({ producer: "Krug", name: "Clos du Mesnil" }));
    const itemId = (await db.wishlist.toArray())[0]!.id;
    await step(() => updateWishlistItem({ itemId, patch: { vintage: 2008, notes: "Auction" } }));
    await step(() =>
      convertWishlistItem({
        itemId,
        draft: {
          producer: "Krug",
          name: "Clos du Mesnil",
          vintage: 2008,
          colour: "sparkling",
          lots: [{ quantity: 1 }],
        },
      }),
    );
    await step(() => addWishlistItem({ producer: "Salon" }));
    await step(async () => removeWishlistItem({ itemId: (await db.wishlist.toArray())[0]!.id }));
    await step(() => loadSampleCellar());
    await step(() => clearSampleCellar());

    // Every update in these batches is compact.
    const written = (await db.eventBatches.bulkGet(batches)) as EventBatch[];
    const updates = written.flatMap((b) => b.changes).filter((c) => c.before && c.after);
    expect(updates.length).toBeGreaterThan(10);
    expect(updates.every((c) => Array.isArray(c.fields))).toBe(true);

    for (let i = batches.length - 1; i >= 0; i--) {
      const result = await undoBatch(batches[i]!);
      expect(result, `undo step ${i}`).toMatchObject({ ok: true });
      expect(await state(), `state before step ${i}`).toEqual(states[i]);
    }
  });

  it("undoes an edit of a wine saved before value fields existed, leaving the fields absent", async () => {
    const legacy = makeWine({ producer: "Ridge" }) as Partial<Wine>;
    delete legacy.valuePerBottle;
    delete legacy.valueCurrency;
    delete legacy.valueUpdatedAt;
    await db.wines.add(legacy as Wine);
    const edit = await updateWine({
      wineId: legacy.id!,
      patch: { valuePerBottle: 120, valueCurrency: "GBP" },
    });
    expect(await undoBatch(edit.batchId!)).toMatchObject({ ok: true });
    const row = (await db.wines.get(legacy.id!))!;
    expect("valuePerBottle" in row).toBe(false);
    expect("valueUpdatedAt" in row).toBe(false);
    expect(withoutUpdatedAt(row)).toEqual(withoutUpdatedAt(legacy));
  });

  it("undoes edits of different fields of one wine in reverse, and refuses out of order", async () => {
    const added = await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 1 }] }],
    });
    const wineId = added.touched.wineIds[0]!;
    const original = await state();
    const first = await updateWine({ wineId, patch: { notes: "First" } });
    const second = await updateWine({ wineId, patch: { region: "Santa Cruz" } });
    expect((await undoBatch(first.batchId!)).ok).toBe(false);
    expect(await undoBatch(second.batchId!)).toMatchObject({ ok: true });
    expect(await undoBatch(first.batchId!)).toMatchObject({ ok: true });
    expect(await state()).toEqual(original);
  });

  it("refuses plainly, without writing, when a compact change's record is gone", async () => {
    const added = await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 1 }] }],
    });
    const wineId = added.touched.wineIds[0]!;
    const edit = await updateWine({ wineId, patch: { notes: "Decant" } });
    // Not something the app does: only a hand-edited database loses a record this way.
    await db.wines.delete(wineId);
    const result = await undoBatch(edit.batchId!);
    expect(result).toEqual({
      ok: false,
      reason: "A record this change touched no longer exists, so it can't be undone.",
    });
    expect(await db.wines.count()).toBe(0);
    expect((await db.eventBatches.get(edit.batchId!))?.undoneAt).toBeNull();
  });
});

function backup(data: Partial<BackupFile["data"]>): BackupFile {
  return {
    app: "vintry",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: "2026-06-01T10:00:00.000Z",
    data: {
      wines: [],
      lots: [],
      consumptions: [],
      tastingNotes: [],
      locations: [],
      wishlist: [],
      eventBatches: [],
      chatThreads: [],
      chatMessages: [],
      settings: [],
      ...data,
    },
  };
}

describe("old whole-row batches", () => {
  beforeEach(resetDatabase);

  it("still undo after a backup made before compact history is restored", async () => {
    const original = makeWine({
      producer: "Ridge",
      thumbnail: THUMBNAIL,
      notes: "Old note",
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:00:00.000Z",
    });
    const edited = { ...original, notes: "New note", updatedAt: "2026-05-02T10:00:00.000Z" };
    const lot = makeLot({
      id: "lot-1",
      createdAt: original.createdAt,
      updatedAt: original.createdAt,
      wineId: original.id,
      quantity: 3,
    });
    const batch = (id: string, createdAt: string, changes: EventBatch["changes"]) => ({
      id,
      createdAt,
      updatedAt: createdAt,
      source: "user" as const,
      command: "updateWine",
      summary: "Edited Ridge Monte Bello 2019",
      changes,
      undoneAt: null,
      snapshotId: null,
    });
    // Whole rows in `before` and `after`, and no `fields`: the format every older batch has.
    const file = backup({
      wines: [edited],
      lots: [{ ...lot, quantity: 2 }],
      eventBatches: [
        batch("b-edit", "2026-05-02T10:00:00.000Z", [
          { table: "wines", id: original.id, before: original, after: edited },
        ]),
        batch("b-lot", "2026-05-03T10:00:00.000Z", [
          { table: "lots", id: lot.id, before: lot, after: { ...lot, quantity: 2 } },
        ]),
      ],
    });
    const parsed = parseBackup(JSON.stringify(file));
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.backup.data.eventBatches[0]?.changes[0]?.fields).toBeUndefined();
    await restoreBackup(parsed.backup);

    // A new, compact edit on top, undone first.
    const newer = await updateWine({ wineId: original.id, patch: { region: "Santa Cruz" } });
    expect(await undoBatch(newer.batchId!)).toMatchObject({ ok: true });

    expect(await checkUndo("b-lot")).toEqual({ ok: true });
    expect(await undoBatch("b-lot")).toMatchObject({ ok: true });
    expect((await db.lots.get(lot.id))?.quantity).toBe(3);
    expect(await undoBatch("b-edit")).toMatchObject({ ok: true });
    const row = (await db.wines.get(original.id))!;
    expect(withoutUpdatedAt(row)).toEqual(withoutUpdatedAt(original));
  });

  it("keeps compact batches compact through a backup and restore, and they still undo", async () => {
    const added = await addBottles({
      drafts: [
        {
          producer: "Ridge",
          vintage: 2019,
          colour: "red",
          thumbnail: THUMBNAIL,
          lots: [{ quantity: 1 }],
        },
      ],
    });
    const wineId = added.touched.wineIds[0]!;
    const before = await state();
    const edit = await updateWine({ wineId, patch: { notes: "Decant" } });

    const parsed = parseBackup(JSON.stringify(await exportBackup()));
    if (!parsed.ok) throw new Error(parsed.message);
    const stored = parsed.backup.data.eventBatches.find((b) => b.id === edit.batchId);
    expect(stored?.changes[0]?.fields).toEqual(["notes"]);
    await restoreBackup(parsed.backup);

    expect(await undoBatch(edit.batchId!)).toMatchObject({ ok: true });
    expect(await state()).toEqual(before);
    expect((await db.wines.get(wineId))?.thumbnail).toBe(THUMBNAIL);
  });
});
