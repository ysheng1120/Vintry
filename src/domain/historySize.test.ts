import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db";
import { resetDatabase } from "../db/testing";
import { addTastingNote, updateTastingNote } from "./commands/notes";
import { addBottles, updateWine } from "./commands/wines";

/**
 * Measures how much history 300 edits add on a wine with a label image. Before updates were
 * stored compactly, each edit of a wine's notes stored the whole wine twice (before and after),
 * image included: 12,420,960 bytes for these 300 edits, and 274,268 bytes for 300 edits of a
 * tasting note. Run with `--silent=false` to print the numbers.
 */

/** A label image the size the app stores (a 256 px JPEG is about 20 KB as a data URL). */
const THUMBNAIL = `data:image/jpeg;base64,${"A".repeat(20_000)}`;
const EDITS = 300;

async function wineWithThumbnail(): Promise<string> {
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
  return added.touched.wineIds[0]!;
}

/** Stored size of the history as it goes into a backup (JSON), in bytes. */
async function historyBytes(): Promise<number> {
  return new TextEncoder().encode(JSON.stringify(await db.eventBatches.toArray())).length;
}

describe("history size", () => {
  beforeEach(resetDatabase);

  it(`${EDITS} edits of a wine's notes store no copy of its label image`, async () => {
    const wineId = await wineWithThumbnail();
    const start = await historyBytes();
    for (let i = 0; i < EDITS; i++) {
      await updateWine({ wineId, patch: { notes: `Tasting note, take ${i}` } });
    }
    const grown = (await historyBytes()) - start;
    console.log(`history grew by ${grown} bytes for ${EDITS} wine note edits`);
    // Was 12,420,960 bytes (about 41 KB per edit); now well under 1 KB per edit.
    expect(grown).toBeLessThan(EDITS * 1_000);
  });

  it(`${EDITS} edits of a tasting note`, async () => {
    const wineId = await wineWithThumbnail();
    await addTastingNote({ wineId, text: "First look" });
    const noteId = (await db.tastingNotes.toArray())[0]!.id;
    const start = await historyBytes();
    for (let i = 0; i < EDITS; i++) {
      await updateTastingNote({ noteId, text: `Tasting note, take ${i}` });
    }
    const grown = (await historyBytes()) - start;
    console.log(`history grew by ${grown} bytes for ${EDITS} tasting note edits`);
    // Was 274,268 bytes.
    expect(grown).toBeLessThan(EDITS * 1_000);
  });
});
