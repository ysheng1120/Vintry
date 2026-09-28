import { beforeEach, describe, expect, it } from "vitest";
import { exportBackup, restoreBackup, SNAPSHOTS_KEPT, takeSnapshot } from "../db/backup";
import type { BackupFile } from "../db/backup-schema";
import { db } from "../db/db";
import { CURRENT_SCHEMA_VERSION } from "../db/migrations";
import { getSetting, SETTING_KEYS } from "../db/settings";
import { makeWine, resetDatabase } from "../db/testing";
import { newId } from "../lib/id";
import { setClock } from "./clock";
import { consumeBottles } from "./commands/consumption";
import { addTastingNote } from "./commands/notes";
import { addBottles, deleteWine, purgeDeleted, updateWine } from "./commands/wines";
import {
  DELETED_WINE_LABEL,
  HISTORY_KEEP_AT_LEAST,
  HISTORY_KEEP_DAYS,
  pruneHistory,
} from "./historyRetention";
import type { EventBatch } from "./types";
import { CLEARED_AFTER_REASON, checkUndo, checkUndoAll, SCRUBBED_REASON, undoBatch } from "./undo";

const NOW = "2026-09-28T12:00:00.000Z";
const DAY = 86_400_000;
const daysAgo = (days: number, plusMs = 0) =>
  new Date(Date.parse(NOW) - days * DAY + plusMs).toISOString();

function fakeBatch(createdAt: string, extra: Partial<EventBatch> = {}): EventBatch {
  return {
    id: newId(),
    createdAt,
    updatedAt: createdAt,
    source: "user",
    command: "test",
    summary: `Change at ${createdAt}`,
    changes: [],
    undoneAt: null,
    snapshotId: null,
    ...extra,
  };
}

/** `count` batches one minute apart, the first `days` days ago. */
async function addBatches(count: number, days: number, extra: Partial<EventBatch> = {}) {
  const rows = Array.from({ length: count }, (_, i) => fakeBatch(daysAgo(days, i * 60_000), extra));
  await db.eventBatches.bulkAdd(rows);
  return rows;
}

function backupWith(wines: ReturnType<typeof makeWine>[]): BackupFile {
  return {
    app: "vintry",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: NOW,
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

describe("pruneHistory", () => {
  beforeEach(async () => {
    await resetDatabase();
    setClock(NOW);
  });

  it("keeps the rule's numbers: 90 days, and at least the newest 500", () => {
    expect(HISTORY_KEEP_DAYS).toBe(90);
    expect(HISTORY_KEEP_AT_LEAST).toBe(500);
  });

  it("keeps every change while there are at most 500, however old", async () => {
    await addBatches(HISTORY_KEEP_AT_LEAST, 400);
    expect(await pruneHistory()).toBe(0);
    expect(await db.eventBatches.count()).toBe(HISTORY_KEEP_AT_LEAST);
    expect(await getSetting(SETTING_KEYS.historyClearedBefore, null)).toBeNull();
  });

  it("keeps every change from the last 90 days, even beyond 500", async () => {
    await addBatches(700, HISTORY_KEEP_DAYS - 1);
    expect(await pruneHistory()).toBe(0);
    expect(await db.eventBatches.count()).toBe(700);
  });

  it("clears the oldest changes older than 90 days, keeping the newest 500", async () => {
    const old = await addBatches(600, 300);
    await addBatches(100, 10);
    expect(await pruneHistory()).toBe(200);
    expect(await db.eventBatches.count()).toBe(500);
    const oldestKept = await db.eventBatches.orderBy("createdAt").first();
    expect(oldestKept?.id).toBe(old[200]!.id);
    expect(await getSetting(SETTING_KEYS.historyClearedBefore, null)).toBe(old[199]!.createdAt);
    expect(await checkUndo(old[0]!.id)).toEqual({
      ok: false,
      reason: "This change is no longer in the history.",
    });
    // Running again changes nothing.
    expect(await pruneHistory()).toBe(0);
  });

  it("leaves recent changes undoable, exactly as before", async () => {
    await addBatches(600, 300);
    setClock(NOW);
    const added = await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 1 }] }],
    });
    const wineId = added.touched.wineIds[0]!;
    const edit = await updateWine({ wineId, patch: { notes: "Decant" } });
    expect(await pruneHistory()).toBe(102);
    expect(await checkUndo(edit.batchId!)).toEqual({ ok: true });
    expect(await undoBatch(edit.batchId!)).toMatchObject({ ok: true });
    expect((await db.wines.get(wineId))?.notes).toBeNull();
    expect(await undoBatch(added.batchId!)).toMatchObject({ ok: true });
    expect(await db.wines.count()).toBe(0);
  });

  it("never clears a restore or erase whose safety copy it still needs", async () => {
    setClock(daysAgo(400));
    await db.wines.add(makeWine({ name: "Original" }));
    const restore = await restoreBackup(backupWith([makeWine({ name: "Restored" })]));
    // Everything since was undone, so only cleared changes would stand in the restore's way.
    await addBatches(600, 300, { undoneAt: daysAgo(1) });
    setClock(NOW);

    expect(await pruneHistory()).toBe(100);
    expect(await db.eventBatches.get(restore.batchId)).toBeDefined();
    // Later copies never push out the one this restore needs.
    for (let i = 0; i < SNAPSHOTS_KEPT + 1; i++) await takeSnapshot("Test");
    expect(await db.snapshots.get(restore.snapshotId)).toBeDefined();
  });

  it("does not offer undo of a kept restore once later changes were cleared", async () => {
    setClock(daysAgo(400));
    const restore = await restoreBackup(backupWith([makeWine({ name: "Restored" })]));
    // A change that was never undone, then many undone ones: once the first is cleared, undoing
    // the restore would silently throw it away.
    await addBatches(1, 399);
    await addBatches(600, 300, { undoneAt: daysAgo(1) });
    setClock(NOW);
    await pruneHistory();

    const expected = { ok: false, reason: CLEARED_AFTER_REASON };
    expect(await checkUndo(restore.batchId)).toEqual(expected);
    const batch = (await db.eventBatches.get(restore.batchId))!;
    expect((await checkUndoAll([batch])).get(restore.batchId)).toEqual(expected);
    expect(await undoBatch(restore.batchId)).toEqual(expected);
    expect((await db.wines.toArray()).map((w) => w.name)).toEqual(["Restored"]);
  });

  it("clears an undone restore once its safety copy is gone, and keeps it while the copy is kept", async () => {
    setClock(daysAgo(400));
    const kept = await restoreBackup(backupWith([makeWine({ name: "A" })]));
    await undoBatch(kept.batchId);
    const gone = await restoreBackup(backupWith([makeWine({ name: "B" })]));
    await undoBatch(gone.batchId);
    await db.snapshots.delete(gone.snapshotId);
    await addBatches(600, 300);
    setClock(NOW);

    await pruneHistory();
    expect(await db.eventBatches.get(kept.batchId)).toBeDefined();
    expect(await db.eventBatches.get(gone.batchId)).toBeUndefined();
  });

  it("is part of a backup, so a restored history remembers what was cleared", async () => {
    await addBatches(600, 300);
    await pruneHistory();
    const file = await exportBackup();
    await resetDatabase();
    setClock(NOW);
    await restoreBackup(file);
    expect(await getSetting(SETTING_KEYS.historyClearedBefore, null)).toBeTruthy();
  });
});

const THUMBNAIL = `data:image/jpeg;base64,${"C".repeat(4_000)}`;

async function addSecretWine() {
  const added = await addBottles({
    drafts: [
      {
        producer: "Domaine Unique",
        name: "Cuvée Secrète",
        vintage: 2015,
        colour: "red",
        thumbnail: THUMBNAIL,
        notes: "Hidden gem",
        lots: [{ quantity: 3 }],
      },
    ],
  });
  return { added, wineId: added.touched.wineIds[0]! };
}

describe("deleting a wine forever scrubs it from history", () => {
  beforeEach(resetDatabase);

  it("leaves no copy of the wine, its bottles, drinks or notes in history or backups", async () => {
    const other = await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 1 }] }],
    });
    const { wineId } = await addSecretWine();
    await updateWine({ wineId, patch: { name: "Cuvée Rare" } });
    const lot = (await db.lots.where("wineId").equals(wineId).first())!;
    await consumeBottles({ lotId: lot.id, note: "Tastes of violets" });
    await addTastingNote({ wineId, text: "Silky tannins" });
    await deleteWine({ wineId });
    const purge = await purgeDeleted({ wineId });

    const json = JSON.stringify(await exportBackup());
    for (const secret of [
      "Secrète",
      "Cuvée Rare",
      "Domaine Unique",
      "Hidden gem",
      "Tastes of violets",
      "Silky tannins",
      THUMBNAIL,
    ]) {
      expect(json).not.toContain(secret);
    }

    const history = await db.eventBatches.orderBy("createdAt").toArray();
    const summaries = history.map((b) => b.summary);
    expect(summaries).toEqual([
      "Added 1 bottle of Ridge 2019",
      `Added 3 bottles of ${DELETED_WINE_LABEL}`,
      `Edited ${DELETED_WINE_LABEL}`,
      `Drank 1 bottle of ${DELETED_WINE_LABEL}`,
      `Added a tasting note for ${DELETED_WINE_LABEL}`,
      `Deleted ${DELETED_WINE_LABEL}`,
      "Permanently removed 1 deleted wine",
    ]);

    // None of the scrubbed changes offers Undo; the other wine's change still does.
    const checks = await checkUndoAll(history);
    for (const batch of history) expect(checks.get(batch.id)).toEqual(await checkUndo(batch.id));
    expect(checks.get(other.batchId!)).toEqual({ ok: true });
    for (const batch of history.slice(1, -1)) {
      expect(checks.get(batch.id)).toEqual({ ok: false, reason: SCRUBBED_REASON });
      expect(await undoBatch(batch.id)).toEqual({ ok: false, reason: SCRUBBED_REASON });
    }
    expect(checks.get(purge.batchId!)?.ok).toBe(false);
    expect(await undoBatch(other.batchId!)).toMatchObject({ ok: true });
    expect(await db.wines.count()).toBe(0);
  });

  it("keeps a change's other records, which still block earlier changes to them", async () => {
    const first = await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 1 }] }],
    });
    const ridgeId = first.touched.wineIds[0]!;
    const both = await addBottles({
      drafts: [
        {
          producer: "Ridge",
          vintage: 2019,
          colour: "red",
          wineId: ridgeId,
          lots: [{ quantity: 2 }],
        },
        { producer: "Domaine Unique", vintage: 2015, colour: "red", lots: [{ quantity: 1 }] },
      ],
    });
    const uniqueId = both.touched.wineIds.find((id) => id !== ridgeId)!;
    await deleteWine({ wineId: uniqueId });
    await purgeDeleted({ wineId: uniqueId });

    const batch = (await db.eventBatches.get(both.batchId!))!;
    expect(batch.summary).toBe("Added 3 bottles of 2 wines");
    const ridgeLot = batch.changes.find((c) => c.after?.wineId === ridgeId);
    expect(ridgeLot?.scrubbed).toBeUndefined();
    expect(ridgeLot?.after).toMatchObject({ quantity: 2 });
    expect(await checkUndo(both.batchId!)).toEqual({ ok: false, reason: SCRUBBED_REASON });
    expect(await checkUndo(first.batchId!)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("A later change touched this wine"),
    });
    expect(await db.lots.where("wineId").equals(ridgeId).count()).toBe(2);
  });

  it("scrubs when the 30-day purge removes a wine", async () => {
    setClock("2026-08-01T10:00:00Z");
    const { added, wineId } = await addSecretWine();
    await deleteWine({ wineId });
    setClock("2026-09-05T10:00:00Z");
    const purge = await purgeDeleted();
    expect(purge.summary).toBe("Permanently removed 1 deleted wine");
    expect(await checkUndo(added.batchId!)).toEqual({ ok: false, reason: SCRUBBED_REASON });
    const json = JSON.stringify(await db.eventBatches.toArray());
    expect(json).not.toContain("Domaine Unique");
    expect(json).not.toContain(THUMBNAIL);
  });
});
