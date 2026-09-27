import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { consumeBottles } from "./consumption";
import { createLocation, deleteLocation, renameLocation } from "./locations";
import { addBottles, deleteWine, purgeDeleted } from "./wines";

describe("locations", () => {
  beforeEach(resetDatabase);

  it("creates and renames a location", async () => {
    const created = await createLocation({ name: "  Kitchen rack " });
    const location = (await db.locations.toArray())[0]!;
    expect(location.name).toBe("Kitchen rack");
    expect(created.touched.locationIds).toEqual([location.id]);

    await renameLocation({ locationId: location.id, name: "Kitchen wine rack" });
    expect((await db.locations.get(location.id))?.name).toBe("Kitchen wine rack");
  });

  it("refuses a duplicate name, ignoring case", async () => {
    await createLocation({ name: "EuroCave A" });
    await expect(createLocation({ name: "eurocave a" })).rejects.toThrow(
      'A location called "EuroCave A" already exists.',
    );
  });

  it("refuses to delete a location that still holds bottles and names the count", async () => {
    await createLocation({ name: "Kitchen rack" });
    const location = (await db.locations.toArray())[0]!;
    await addBottles({
      drafts: [
        {
          producer: "Ridge",
          name: "Monte Bello",
          vintage: 2019,
          colour: "red",
          lots: [{ quantity: 2, locationId: location.id }],
        },
        {
          producer: "Krug",
          vintage: null,
          colour: "sparkling",
          lots: [{ quantity: 1, locationId: location.id }],
        },
      ],
    });
    await expect(deleteLocation({ locationId: location.id })).rejects.toThrow(
      "Kitchen rack still holds 3 bottles. Move or drink them first.",
    );
    expect(await db.locations.count()).toBe(1);
  });

  it("refuses, naming Recently deleted, when only deleted wines' bottles remain", async () => {
    await createLocation({ name: "Kitchen rack" });
    const location = (await db.locations.toArray())[0]!;
    const added = await addBottles({
      drafts: [
        {
          producer: "Ridge",
          vintage: 2019,
          colour: "red",
          lots: [{ quantity: 3, locationId: location.id }],
        },
      ],
    });
    const wineId = added.touched.wineIds[0]!;
    await deleteWine({ wineId });

    await expect(deleteLocation({ locationId: location.id })).rejects.toThrow(
      "Kitchen rack still holds bottles of wines in Recently deleted. Restore and move them, or delete them forever.",
    );
    expect(await db.locations.count()).toBe(1);

    // Once the wine is deleted forever, the location can go.
    await purgeDeleted({ wineId });
    await deleteLocation({ locationId: location.id });
    expect(await db.locations.count()).toBe(0);
  });

  it("deletes a location once it is empty", async () => {
    await createLocation({ name: "Fridge" });
    const location = (await db.locations.toArray())[0]!;
    await addBottles({
      drafts: [
        {
          producer: "Krug",
          vintage: null,
          colour: "sparkling",
          lots: [{ quantity: 1, locationId: location.id }],
        },
      ],
    });
    const lot = (await db.lots.toArray())[0]!;
    await consumeBottles({ lotId: lot.id });

    const result = await deleteLocation({ locationId: location.id });
    expect(await db.locations.count()).toBe(0);
    expect(result.summary).toBe("Deleted location Fridge");
  });
});
