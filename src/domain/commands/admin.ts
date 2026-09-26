import { z } from "zod";
import { replaceAllData, restoreBackup, restoreSnapshot, takeSnapshot } from "../../db/backup";
import { BackupFileSchema } from "../../db/backup-schema";
import { EMPTY_TOUCHED } from "../events";
import { defineCustomCommand, type CommandContext } from "./core";

const EMPTY_DATA = {
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
};

export const wipeAllCommand = defineCustomCommand({
  name: "wipeAll",
  description:
    "Erase every wine, bottle, note, location, wishlist item, history entry and chat on this device. A safety copy is kept so it can be undone.",
  humanOnly: "Erases all data; only the user may do this, from Settings.",
  input: z.object({}),
  async execute() {
    const snapshotId = await takeSnapshot("Before erasing all data");
    const summary = "Erased all data";
    const batchId = await replaceAllData(EMPTY_DATA, { command: "wipeAll", summary, snapshotId });
    return { batchId, touched: EMPTY_TOUCHED, summary };
  },
});

export const restoreBackupCommand = defineCustomCommand({
  name: "restoreBackup",
  description: "Replace all data with a backup file, after taking a safety copy.",
  humanOnly: "Replaces all data; only the user may restore a backup.",
  input: BackupFileSchema,
  async execute(file) {
    const { batchId } = await restoreBackup(file);
    return { batchId, touched: EMPTY_TOUCHED, summary: "Restored a backup" };
  },
});

export const restoreSnapshotCommand = defineCustomCommand({
  name: "restoreSnapshot",
  description: "Bring back a safety copy saved on this device before a restore or erase.",
  humanOnly: "Replaces all data; only the user may bring back a saved copy.",
  input: z.object({ snapshotId: z.string().min(1) }),
  async execute({ snapshotId }) {
    const { batchId } = await restoreSnapshot(snapshotId);
    return { batchId, touched: EMPTY_TOUCHED, summary: "Brought back a saved copy" };
  },
});

export const wipeAll = (input: Record<string, never> = {}, ctx?: CommandContext) =>
  wipeAllCommand.run(input, ctx);
