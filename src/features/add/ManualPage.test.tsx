import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { WishlistItemSchema } from "../../domain/types";
import { renderCellarApp } from "../cellar/testing";

beforeEach(resetDatabase);

async function openForm() {
  const app = renderCellarApp("/add/manual");
  await screen.findByRole("heading", { level: 1, name: "Add by hand" });
  await screen.findByLabelText(/Producer/);
  return app;
}

describe("Add by hand", () => {
  it("creates the wine and shows it in the cellar with 3 bottles", async () => {
    await db.locations.add(makeLocation({ name: "Kitchen rack" }));
    const { user, router } = await openForm();

    await user.type(screen.getByLabelText(/Producer/), "Giacomo Conterno");
    await user.type(screen.getByLabelText("Wine name"), "Barolo Cascina Francia");
    await user.type(screen.getByLabelText(/Vintage/), "2016");
    const quantity = screen.getByLabelText("Bottles");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.tab();
    // The only location is the default.
    expect(screen.getByLabelText("Location")).toHaveDisplayValue("Kitchen rack");
    await user.click(screen.getByRole("button", { name: "Add 3 bottles" }));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Giacomo Conterno Barolo Cascina Francia 2016",
      }),
    ).toBeInTheDocument();
    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await toasts.findByText(/Added 3 bottles of Giacomo Conterno/)).toBeInTheDocument();
    expect(toasts.getByRole("button", { name: "Undo" })).toBeInTheDocument();

    await router.navigate("/cellar");
    const row = await screen.findByRole("link", { name: /Barolo Cascina Francia/ });
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("bottles")).toBeInTheDocument();
  });

  it("undoes the add from the toast and returns to the form", async () => {
    const { user } = await openForm();
    await user.type(screen.getByLabelText(/Producer/), "Ridge");
    await user.type(screen.getByLabelText(/Vintage/), "2019");
    await user.click(screen.getByRole("button", { name: "Add 1 bottle" }));
    await screen.findByRole("heading", { level: 1, name: "Ridge 2019" });

    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await screen.findByRole("heading", { level: 1, name: "Add by hand" });
    expect(await db.wines.count()).toBe(0);
  });

  it("shows Add to existing wine for a wine already in the cellar and adds a lot to it", async () => {
    const wine = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    await db.wines.add(wine);
    await db.lots.add(makeLot({ wineId: wine.id, quantity: 2 }));
    const { user } = await openForm();

    await user.type(screen.getByLabelText(/Producer/), "ridge");
    await user.type(screen.getByLabelText("Wine name"), "Monte-Bello");
    await user.type(screen.getByLabelText(/Vintage/), "2019");

    expect(await screen.findByText(/Add to existing wine/)).toHaveTextContent(
      "Add to existing wine: Ridge Monte Bello 2019",
    );
    await user.click(screen.getByRole("button", { name: "Add 1 bottle" }));

    await screen.findByRole("heading", { level: 1, name: "Ridge Monte Bello 2019" });
    expect(await db.wines.count()).toBe(1);
    const lots = await db.lots.where("wineId").equals(wine.id).toArray();
    expect(lots.map((l) => l.quantity).sort()).toEqual([1, 2]);
  });

  it("requires a producer and saves nothing without one", async () => {
    const { user } = await openForm();
    await user.type(screen.getByLabelText(/Vintage/), "2019");
    await user.click(screen.getByRole("button", { name: "Add 1 bottle" }));

    expect(await screen.findByText("Producer is required")).toBeInTheDocument();
    expect(screen.getByLabelText(/Producer/)).toHaveAttribute("aria-invalid", "true");
    expect(await db.wines.count()).toBe(0);
    expect(await db.eventBatches.count()).toBe(0);
  });

  it("creates a new location typed inline and saves a drinking window as the user's", async () => {
    const { user } = await openForm();
    await user.type(screen.getByLabelText(/Producer/), "Krug");
    await user.type(screen.getByLabelText("Wine name"), "Grande Cuvée");
    await user.click(screen.getByRole("checkbox", { name: "NV" }));
    await user.selectOptions(screen.getByLabelText("Colour"), "Sparkling");
    await user.selectOptions(screen.getByLabelText("Location"), "New location…");
    await user.type(screen.getByLabelText("New location name"), "Wine fridge");
    await user.type(screen.getByLabelText("Drink from"), "2026");
    await user.type(screen.getByLabelText("Drink to"), "2032");
    await user.type(screen.getByLabelText(/Price/), "180");
    await user.click(screen.getByRole("button", { name: "Add 1 bottle" }));

    await screen.findByRole("heading", { level: 1, name: "Krug Grande Cuvée NV" });
    const [wine] = await db.wines.toArray();
    expect(wine).toMatchObject({
      vintage: null,
      colour: "sparkling",
      windowFrom: 2026,
      windowTo: 2032,
      windowSource: "user",
    });
    const [location] = await db.locations.toArray();
    expect(location?.name).toBe("Wine fridge");
    const [lot] = await db.lots.toArray();
    expect(lot).toMatchObject({ locationId: location?.id, pricePerBottle: 180 });
  });

  it("turns a wishlist item into bottles and takes it off the wishlist in one change", async () => {
    await db.wishlist.add(
      WishlistItemSchema.parse({
        id: "wish-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        producer: "Ridge",
        name: "Geyserville",
        vintage: 2021,
        colour: "red",
        country: "USA",
        notes: "Try the 2021",
      }),
    );
    const { user } = renderCellarApp("/add/manual?fromWishlist=wish-1");
    expect(await screen.findByLabelText(/Producer/)).toHaveValue("Ridge");
    expect(screen.getByLabelText("Wine name")).toHaveValue("Geyserville");
    expect(screen.getByLabelText(/Vintage/)).toHaveValue("2021");
    expect(screen.getByLabelText("Country")).toHaveValue("USA");
    expect(screen.getByLabelText("Notes")).toHaveValue("Try the 2021");
    await user.click(screen.getByRole("button", { name: "Add 1 bottle" }));

    await screen.findByRole("heading", { level: 1, name: "Ridge Geyserville 2021" });
    expect(await db.wishlist.count()).toBe(0);
    const batches = await db.eventBatches.toArray();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.command).toBe("convertWishlistItem");
  });

  it("falls back to a blank form when the wishlist item is gone", async () => {
    renderCellarApp("/add/manual?fromWishlist=missing");
    expect(await screen.findByText(/no longer there/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Producer/)).toHaveValue("");
  });
});
