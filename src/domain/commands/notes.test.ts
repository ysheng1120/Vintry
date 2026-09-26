import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { addTastingNote, deleteTastingNote, updateTastingNote } from "./notes";
import { addBottles } from "./wines";

describe("tasting notes", () => {
  beforeEach(resetDatabase);

  it("adds, edits and deletes a note for a wine", async () => {
    await addBottles({
      drafts: [
        {
          producer: "Krug",
          name: "Grande Cuvée",
          vintage: null,
          colour: "sparkling",
          lots: [{ quantity: 1 }],
        },
      ],
    });
    const wine = (await db.wines.toArray())[0]!;

    const added = await addTastingNote({
      wineId: wine.id,
      text: "Brioche, lemon",
      date: "2026-09-01",
    });
    const note = (await db.tastingNotes.toArray())[0]!;
    expect(note).toMatchObject({ wineId: wine.id, consumptionId: null, text: "Brioche, lemon" });
    expect(added.summary).toBe("Added a tasting note for Krug Grande Cuvée NV");

    await updateTastingNote({ noteId: note.id, text: "Brioche, lemon, chalk", rating: 96 });
    expect(await db.tastingNotes.get(note.id)).toMatchObject({
      text: "Brioche, lemon, chalk",
      rating: 96,
    });

    await deleteTastingNote({ noteId: note.id });
    expect(await db.tastingNotes.count()).toBe(0);
  });

  it("refuses an empty note", async () => {
    await addBottles({
      drafts: [{ producer: "Krug", vintage: null, colour: "sparkling", lots: [{ quantity: 1 }] }],
    });
    const wine = (await db.wines.toArray())[0]!;
    await expect(addTastingNote({ wineId: wine.id, text: "   " })).rejects.toThrow(/empty/);
  });
});
