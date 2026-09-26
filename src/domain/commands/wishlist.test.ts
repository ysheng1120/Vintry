import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import {
  addWishlistItem,
  convertWishlistItem,
  removeWishlistItem,
  updateWishlistItem,
} from "./wishlist";

describe("wishlist", () => {
  beforeEach(resetDatabase);

  it("adds, updates and removes an item", async () => {
    const added = await addWishlistItem({
      producer: "Krug",
      name: "Clos du Mesnil",
      colour: "sparkling",
    });
    const item = (await db.wishlist.toArray())[0]!;
    expect(item).toMatchObject({ producer: "Krug", name: "Clos du Mesnil", vintage: null });
    expect(added.touched.wishlistIds).toEqual([item.id]);
    expect(added.summary).toBe("Added Krug Clos du Mesnil to the wishlist");

    await updateWishlistItem({
      itemId: item.id,
      patch: { vintage: 2008, notes: "Look at auction" },
    });
    expect(await db.wishlist.get(item.id)).toMatchObject({
      vintage: 2008,
      notes: "Look at auction",
    });

    await removeWishlistItem({ itemId: item.id });
    expect(await db.wishlist.count()).toBe(0);
  });

  it("turns a wishlist item into bottles in the cellar and removes it from the wishlist", async () => {
    await addWishlistItem({ producer: "Ridge", name: "Monte Bello", vintage: 2019, colour: "red" });
    const item = (await db.wishlist.toArray())[0]!;

    const result = await convertWishlistItem({
      itemId: item.id,
      draft: {
        producer: "Ridge",
        name: "Monte Bello",
        vintage: 2019,
        colour: "red",
        lots: [{ quantity: 3, pricePerBottle: 250, currency: "USD" }],
      },
    });
    expect(await db.wishlist.count()).toBe(0);
    expect(await db.wines.count()).toBe(1);
    expect((await db.lots.toArray())[0]?.quantity).toBe(3);
    expect(result.summary).toBe("Added 3 bottles of Ridge Monte Bello 2019 from the wishlist");
    expect(await db.eventBatches.count()).toBe(2);
  });
});
