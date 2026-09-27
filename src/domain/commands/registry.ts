import type { Command } from "./core";
import { consumeBottlesCommand } from "./consumption";
import { restoreBackupCommand, restoreSnapshotCommand, wipeAllCommand } from "./admin";
import { createLocationCommand, deleteLocationCommand, renameLocationCommand } from "./locations";
import { adjustQuantityCommand, moveBottlesCommand } from "./lots";
import { mergeWinesCommand } from "./merge";
import { addTastingNoteCommand, deleteTastingNoteCommand, updateTastingNoteCommand } from "./notes";
import { clearSampleCellarCommand, loadSampleCellarCommand } from "./sample";
import { setWineProfileCommand } from "./wineProfile";
import { setDrinkingWindowCommand } from "./windows";
import {
  addBottlesCommand,
  deleteWineCommand,
  importRowsCommand,
  purgeDeletedCommand,
  restoreWineCommand,
  updateWineCommand,
} from "./wines";
import {
  addWishlistItemCommand,
  convertWishlistItemCommand,
  removeWishlistItemCommand,
  updateWishlistItemCommand,
} from "./wishlist";

/**
 * Every command, by name (KTD4). The sommelier builds its tools from this list and the parity
 * test checks that each command is either exposed as a tool or marked `humanOnly` (KTD11).
 */
export const commands = {
  addBottles: addBottlesCommand,
  importRows: importRowsCommand,
  updateWine: updateWineCommand,
  deleteWine: deleteWineCommand,
  restoreWine: restoreWineCommand,
  purgeDeleted: purgeDeletedCommand,
  mergeWines: mergeWinesCommand,
  consumeBottles: consumeBottlesCommand,
  moveBottles: moveBottlesCommand,
  adjustQuantity: adjustQuantityCommand,
  setDrinkingWindow: setDrinkingWindowCommand,
  setWineProfile: setWineProfileCommand,
  addTastingNote: addTastingNoteCommand,
  updateTastingNote: updateTastingNoteCommand,
  deleteTastingNote: deleteTastingNoteCommand,
  createLocation: createLocationCommand,
  renameLocation: renameLocationCommand,
  deleteLocation: deleteLocationCommand,
  addWishlistItem: addWishlistItemCommand,
  updateWishlistItem: updateWishlistItemCommand,
  removeWishlistItem: removeWishlistItemCommand,
  convertWishlistItem: convertWishlistItemCommand,
  loadSampleCellar: loadSampleCellarCommand,
  clearSampleCellar: clearSampleCellarCommand,
  wipeAll: wipeAllCommand,
  restoreBackup: restoreBackupCommand,
  restoreSnapshot: restoreSnapshotCommand,
} as const;

export type CommandName = keyof typeof commands;

export const commandList: readonly Command[] = Object.values(commands) as readonly Command[];
