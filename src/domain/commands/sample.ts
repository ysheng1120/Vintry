import { z } from "zod";
import { db } from "../../db/db";
import { buildSampleCellar } from "../../db/sample-cellar";
import type { RecordTableName } from "../types";
import { CommandError, defineCommand, type CommandContext } from "./core";

export const loadSampleCellarCommand = defineCommand({
  name: "loadSampleCellar",
  description: "Load the sample cellar to explore the app. Every sample row is clearly marked.",
  input: z.object({}),
  defaultSource: "sample",
  countsAsChange: false,
  async execute(_input, changes) {
    const alreadyLoaded = await db.wines.filter((w) => w.isSample).first();
    if (alreadyLoaded) throw new CommandError("The sample cellar is already loaded.");
    const sample = buildSampleCellar();
    for (const row of sample.locations) await changes.insert("locations", row);
    for (const row of sample.wines) await changes.insert("wines", row);
    for (const row of sample.lots) await changes.insert("lots", row);
    for (const row of sample.consumptions) await changes.insert("consumptions", row);
    for (const row of sample.tastingNotes) await changes.insert("tastingNotes", row);
    for (const row of sample.wishlist) await changes.insert("wishlist", row);
    return { summary: "Loaded the sample cellar" };
  },
});

export const clearSampleCellarCommand = defineCommand({
  name: "clearSampleCellar",
  description: "Remove every sample row and keep the user's own records.",
  input: z.object({}),
  defaultSource: "sample",
  countsAsChange: false,
  async execute(_input, changes) {
    const sampleWineIds = new Set(
      (await db.wines.filter((w) => w.isSample).primaryKeys()).map(String),
    );
    // Rows that belong to a sample wine go too, so nothing is left pointing at a removed wine.
    const belongsToSample = (row: { isSample: boolean; wineId?: string }) =>
      row.isSample || (row.wineId !== undefined && sampleWineIds.has(row.wineId));

    const lots = await db.lots.toArray();
    const keptLocationIds = new Set(
      lots.filter((lot) => !belongsToSample(lot)).map((lot) => lot.locationId),
    );

    for (const table of ["tastingNotes", "consumptions", "lots"] as const) {
      const rows = (await db.table(table).toArray()) as {
        id: string;
        isSample: boolean;
        wineId: string;
      }[];
      for (const row of rows) if (belongsToSample(row)) await changes.remove(table, row.id);
    }
    for (const id of sampleWineIds) await changes.remove("wines", id);
    for (const table of ["wishlist", "locations"] as const satisfies RecordTableName[]) {
      const rows = (await db.table(table).toArray()) as { id: string; isSample: boolean }[];
      for (const row of rows) {
        if (!row.isSample) continue;
        // A sample location now holding the user's own bottles becomes theirs.
        if (table === "locations" && keptLocationIds.has(row.id)) {
          await changes.update("locations", row.id, { isSample: false });
        } else {
          await changes.remove(table, row.id);
        }
      }
    }
    return { summary: "Cleared the sample cellar" };
  },
});

export const loadSampleCellar = (input: Record<string, never> = {}, ctx?: CommandContext) =>
  loadSampleCellarCommand.run(input, ctx);
export const clearSampleCellar = (input: Record<string, never> = {}, ctx?: CommandContext) =>
  clearSampleCellarCommand.run(input, ctx);
