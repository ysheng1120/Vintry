import { beforeEach, describe, expect, it } from "vitest";
import { exportBackup, parseBackup } from "../../db/backup";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { undoBatch } from "../undo";
import { CommandError } from "./core";
import { addBottles } from "./wines";
import { setWineProfile } from "./wineProfile";

const PROFILE = {
  summary: "Ridge makes structured, age-worthy reds from the Santa Cruz Mountains.",
  tasting: "Typically shows blackcurrant and cedar, with firm tannins.",
  pairings: ["Roast lamb", "Aged cheddar"],
  serving: "Serve at 16 to 18°C; decant for about an hour.",
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

describe("setWineProfile", () => {
  beforeEach(resetDatabase);

  it("saves a profile on the wine", async () => {
    const wine = await seedWine();
    const result = await setWineProfile({ wineId: wine.id, profile: PROFILE });
    expect(await db.wines.get(wine.id)).toMatchObject({ profile: PROFILE });
    expect(result.summary).toBe("Wrote a profile for Ridge Monte Bello 2019");
  });

  it("removes a profile with profile: null", async () => {
    const wine = await seedWine();
    await setWineProfile({ wineId: wine.id, profile: PROFILE });
    const result = await setWineProfile({ wineId: wine.id, profile: null });
    expect((await db.wines.get(wine.id))?.profile).toBeNull();
    expect(result.summary).toBe("Removed the profile for Ridge Monte Bello 2019");
  });

  it("undo restores the wine to before the profile was written", async () => {
    const wine = await seedWine();
    const result = await setWineProfile({ wineId: wine.id, profile: PROFILE });
    expect(await undoBatch(result.batchId!)).toMatchObject({ ok: true });
    expect((await db.wines.get(wine.id))?.profile).toBeUndefined();
  });

  it("refuses a deleted or missing wine", async () => {
    const wine = await seedWine();
    await db.wines.update(wine.id, { deletedAt: "2026-09-01T00:00:00Z" });
    await expect(setWineProfile({ wineId: wine.id, profile: PROFILE })).rejects.toThrow(
      CommandError,
    );
    await expect(setWineProfile({ wineId: "missing", profile: PROFILE })).rejects.toThrow(
      CommandError,
    );
  });

  it("round-trips through a backup, and older backups without a profile still parse", async () => {
    const wine = await seedWine();
    await setWineProfile({ wineId: wine.id, profile: PROFILE });
    const file = await exportBackup();
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok && parsed.backup.data.wines[0]).toMatchObject({ profile: PROFILE });

    const older = structuredClone(file);
    for (const row of older.data.wines as Record<string, unknown>[]) delete row.profile;
    const parsedOld = parseBackup(older);
    expect(parsedOld.ok).toBe(true);
    expect(parsedOld.ok && parsedOld.backup.data.wines[0]?.profile).toBeUndefined();
  });
});
