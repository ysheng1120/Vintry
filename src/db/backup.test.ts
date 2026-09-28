import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_FOLDER_SETTING_KEY } from "../features/backup/fileHandle";
import { newId } from "../lib/id";
import {
  exportBackup,
  listSnapshots,
  markBackupDone,
  parseBackup,
  restoreBackup,
  restoreSnapshot,
  SNAPSHOTS_KEPT,
  takeSnapshot,
  backupCounts,
} from "./backup";
import { BACKUP_TABLES, type BackupFile } from "./backup-schema";
import { db } from "./db";
import { CURRENT_SCHEMA_VERSION, SCHEMA_VERSIONS, type SchemaVersion } from "./migrations";
import { getSetting, setSetting } from "./settings";
import { makeLocation, makeLot, makeWine, resetDatabase } from "./testing";

const t = "2026-09-20T10:00:00.000Z";
const stamp = () => ({ id: newId(), createdAt: t, updatedAt: t });

/** Puts one realistic row in every backed-up table. */
async function seedEveryTable() {
  const location = makeLocation();
  const wine = makeWine({
    thumbnail: "data:image/jpeg;base64,AAAA",
    grapes: ["Cabernet"],
    cellarTrackerId: "100001",
  });
  const lot = makeLot({ wineId: wine.id, locationId: location.id, currency: "USD" });
  const consumption = {
    ...stamp(),
    wineId: wine.id,
    lotId: lot.id,
    date: "2026-09-19",
    quantity: 1,
    rating: 94,
    occasion: "Birthday",
    isSample: false,
  };
  await db.locations.add(location);
  await db.wines.add(wine);
  await db.lots.add(lot);
  await db.consumptions.add(consumption);
  await db.tastingNotes.add({
    ...stamp(),
    wineId: wine.id,
    consumptionId: consumption.id,
    date: "2026-09-19",
    text: "Cassis and cedar",
    rating: 94,
    isSample: false,
  });
  await db.wishlist.add({
    ...stamp(),
    producer: "Krug",
    name: "Grande Cuvée",
    vintage: null,
    colour: "sparkling",
    country: "France",
    region: "Champagne",
    notes: null,
    targetPrice: 180,
    currency: "GBP",
    isSample: false,
  });
  await db.eventBatches.add({
    ...stamp(),
    source: "user",
    command: "addBottles",
    summary: "Added 6 bottles of Ridge Monte Bello 2019",
    changes: [{ table: "wines", id: wine.id, before: null, after: { ...wine } }],
    undoneAt: null,
    snapshotId: null,
  });
  const thread = { ...stamp(), title: "Lamb tonight" };
  await db.chatThreads.add(thread);
  await db.chatMessages.add({
    ...stamp(),
    threadId: thread.id,
    role: "user",
    content: "What goes with lamb?",
    meta: null,
  });
  await setSetting("currency", "USD");
  await setSetting("apiKey", "sk-ant-secret");
  await db.aiUsage.add({
    ...stamp(),
    feature: "chat",
    model: "claude-opus-5",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.01,
  });
}

async function readBackedUpTables() {
  const out: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) out[table] = await db.table(table).toArray();
  return out;
}

function validFile(overrides: Partial<BackupFile["data"]> = {}): BackupFile {
  return {
    app: "vintry",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: t,
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
      ...overrides,
    },
  };
}

describe("backup export and import", () => {
  beforeEach(resetDatabase);

  it("exports the Vintry format with every backed-up table and never the API key", async () => {
    await seedEveryTable();
    const file = await exportBackup();
    expect(file.app).toBe("vintry");
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(Object.keys(file.data).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(file.data.settings).toEqual([{ key: "currency", value: "USD" }]);
    expect(JSON.stringify(file)).not.toContain("sk-ant-secret");
    expect(file.data).not.toHaveProperty("aiUsage");
    expect(file.data).not.toHaveProperty("snapshots");
  });

  it("keeps the chosen backup folder on this device: never exported, kept across restore", async () => {
    // Stands in for the FileSystemDirectoryHandle the browser gives us.
    const folder = { kind: "directory", name: "Vintry backups" };
    await setSetting(BACKUP_FOLDER_SETTING_KEY, folder);
    await setSetting("currency", "USD");

    const file = await exportBackup();
    expect(file.data.settings.map((row) => row.key)).not.toContain(BACKUP_FOLDER_SETTING_KEY);

    const incoming = validFile({
      settings: [
        { key: "currency", value: "EUR" },
        { key: BACKUP_FOLDER_SETTING_KEY, value: {} },
      ],
    });
    await restoreBackup(incoming);
    expect(await getSetting(BACKUP_FOLDER_SETTING_KEY, null)).toEqual(folder);
    expect(await getSetting("currency", null)).toBe("EUR");
  });

  it("export then import into an empty database reproduces every table row for row", async () => {
    await seedEveryTable();
    const before = await readBackedUpTables();
    const json = JSON.parse(JSON.stringify(await exportBackup())) as unknown;

    await resetDatabase();
    await setSetting("apiKey", "sk-ant-this-device");
    const earlier = { id: newId(), createdAt: t, reason: "Earlier copy", backup: validFile() };
    await db.snapshots.add(earlier);
    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error(parsed.message);
    await restoreBackup(parsed.backup);

    const after = await readBackedUpTables();
    for (const table of BACKUP_TABLES) {
      if (table === "eventBatches") {
        // Restore adds one "Restored a backup" entry on top of the restored history.
        const restored = (after.eventBatches ?? []).filter(
          (b) => (b as { source: string }).source !== "restore",
        );
        expect(restored).toEqual(before.eventBatches);
      } else if (table === "settings") {
        expect(after.settings).toEqual(expect.arrayContaining([{ key: "currency", value: "USD" }]));
      } else {
        expect(after[table]).toEqual(before[table]);
      }
    }
    // The API key on this device is kept; the one from the old device never travelled.
    expect(await getSetting("apiKey", "")).toBe("sk-ant-this-device");
    // Snapshots are never replaced: the earlier one stays and the safety copy is added.
    expect(await db.snapshots.get(earlier.id)).toEqual(earlier);
    expect(await db.snapshots.count()).toBe(2);
  });

  it("accepts a JSON string", () => {
    const result = parseBackup(JSON.stringify(validFile()));
    expect(result.ok).toBe(true);
  });

  it("rejects a backup with a missing required field, naming the table and field, and writes nothing", async () => {
    const wine = makeWine();
    const broken: Record<string, unknown> = { ...wine };
    delete broken.producer;
    const result = parseBackup({ ...validFile(), data: { ...validFile().data, wines: [broken] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("wines");
    expect(result.message).toContain("producer");
    expect(await db.wines.count()).toBe(0);
  });

  it('rejects files that are not Vintry backups with "This is not a Vintry backup"', () => {
    for (const input of [{ ...validFile(), app: "cellartracker" }, [], "not json", null, 42]) {
      const result = parseBackup(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("This is not a Vintry backup");
    }
  });

  it("rejects a backup from a newer schema version", () => {
    const result = parseBackup({ ...validFile(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(result).toEqual({
      ok: false,
      message: "This backup was made by a newer Vintry. Update the app first.",
    });
  });

  it("migrates a backup from an older schema version through the row migrations", () => {
    const versions: SchemaVersion[] = [
      ...SCHEMA_VERSIONS,
      {
        version: CURRENT_SCHEMA_VERSION + 1,
        stores: {},
        migrateRow: (table, row) =>
          table === "wines" ? { ...row, producer: String(row.maker), maker: undefined } : row,
      },
    ];
    const oldWine = { ...makeWine(), maker: "Ridge" } as Record<string, unknown>;
    delete oldWine.producer;
    const result = parseBackup(
      { ...validFile(), data: { ...validFile().data, wines: [oldWine] } },
      versions,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.backup.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
    expect(result.backup.data.wines[0]?.producer).toBe("Ridge");
  });

  it("fills defaults for optional fields and treats missing optional tables as empty", () => {
    const wine = { id: newId(), createdAt: t, updatedAt: t, producer: "Krug", vintage: null };
    const result = parseBackup({
      app: "vintry",
      schemaVersion: 1,
      exportedAt: t,
      data: {
        wines: [{ ...wine, colour: "sparkling" }],
        lots: [],
        consumptions: [],
        tastingNotes: [],
        locations: [],
      },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.backup.data.wines[0]).toMatchObject({ bottleSize: 750, grapes: [], name: "" });
    expect(result.backup.data.chatThreads).toEqual([]);
    expect(result.backup.data.settings).toEqual([]);
  });

  it("refuses a file without the cellar's own tables, so a cut-short file never empties the cellar", () => {
    const wine = { id: newId(), createdAt: t, updatedAt: t, producer: "Krug", vintage: null };
    const partial = parseBackup({
      app: "vintry",
      schemaVersion: 1,
      exportedAt: t,
      data: { wines: [{ ...wine, colour: "sparkling" }] },
    });
    expect(partial).toEqual({
      ok: false,
      message: 'This backup is damaged: it has no "lots" list.',
    });
    const empty = parseBackup({ app: "vintry", schemaVersion: 1, exportedAt: t, data: {} });
    expect(empty).toEqual({
      ok: false,
      message: 'This backup is damaged: it has no "wines" list.',
    });
    expect(parseBackup({ app: "vintry", schemaVersion: 1, exportedAt: t }).ok).toBe(false);
  });

  it("counts the wines and bottles a backup holds, leaving out deleted wines", () => {
    const kept = { id: newId(), createdAt: t, updatedAt: t, producer: "Krug", vintage: null };
    const gone = { ...kept, id: newId(), deletedAt: t };
    const lot = (wineId: string, quantity: number) => ({
      id: newId(),
      createdAt: t,
      updatedAt: t,
      wineId,
      quantity,
    });
    const result = parseBackup({
      app: "vintry",
      schemaVersion: 1,
      exportedAt: t,
      data: {
        wines: [
          { ...kept, colour: "sparkling" },
          { ...gone, colour: "sparkling" },
        ],
        lots: [lot(kept.id, 4), lot(gone.id, 9)],
        consumptions: [],
        tastingNotes: [],
        locations: [],
      },
    });
    if (!result.ok) throw new Error(result.message);
    expect(backupCounts(result.backup)).toEqual({ wines: 1, bottles: 4 });
  });
});

describe("restore and safety snapshots", () => {
  beforeEach(resetDatabase);

  it("takes a safety snapshot before replacing data, and the snapshot brings the old data back", async () => {
    const wines = Array.from({ length: 40 }, (_, i) => makeWine({ name: `Cuvée ${i}` }));
    await db.wines.bulkAdd(wines);
    await db.aiUsage.add({
      ...stamp(),
      feature: "scan",
      model: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    });

    const incoming = validFile({ wines: [makeWine({ producer: "Krug" })] });
    const { snapshotId, batchId } = await restoreBackup(incoming);

    expect(await db.wines.count()).toBe(1);
    expect(await db.aiUsage.count()).toBe(1); // never replaced
    const snapshots = await listSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ id: snapshotId, wineCount: 40 });
    const batch = await db.eventBatches.get(batchId);
    expect(batch).toMatchObject({ source: "restore", snapshotId });

    await restoreSnapshot(snapshotId);
    expect(await db.wines.count()).toBe(40);
  });

  it("keeps only the last 3 snapshots", async () => {
    for (let i = 0; i < 5; i++) {
      await db.wines.add(makeWine({ name: `Round ${i}` }));
      await restoreBackup(validFile());
    }
    expect(await db.snapshots.count()).toBe(3);
  });

  it("never prunes a snapshot that a not-undone restore in the history still needs", async () => {
    await db.wines.add(makeWine());
    const unneeded = await takeSnapshot("Taken by hand");
    const { snapshotId, batchId } = await restoreBackup(validFile());
    for (let i = 0; i < SNAPSHOTS_KEPT + 1; i++) await takeSnapshot(`Later ${i}`);

    expect(await db.snapshots.get(snapshotId)).toBeDefined();
    expect(await db.snapshots.get(unneeded)).toBeUndefined();
    expect(await db.snapshots.count()).toBe(SNAPSHOTS_KEPT + 1);

    // Once that restore is undone, its snapshot is no longer needed and can go.
    await db.eventBatches.update(batchId, { undoneAt: new Date().toISOString() });
    await takeSnapshot("One more");
    expect(await db.snapshots.get(snapshotId)).toBeUndefined();
    expect(await db.snapshots.count()).toBe(SNAPSHOTS_KEPT);
  });

  it("restore does not delete the snapshot it just took", async () => {
    await db.wines.add(makeWine());
    const { snapshotId } = await restoreBackup(validFile());
    expect(await db.snapshots.get(snapshotId)).toBeDefined();
  });

  it("marks a backup as done", async () => {
    await setSetting("changesSinceBackup", 12);
    await markBackupDone();
    expect(await getSetting("changesSinceBackup", -1)).toBe(0);
    expect(await getSetting<string | null>("lastBackupAt", null)).not.toBeNull();
  });
});
