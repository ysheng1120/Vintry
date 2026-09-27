import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { renderCellarApp } from "../cellar/testing";

beforeEach(resetDatabase);

async function openPage() {
  const app = renderCellarApp("/locations");
  await screen.findByRole("heading", { level: 1, name: "Locations" });
  return app;
}

describe("Locations", () => {
  it("lists locations with bottle counts", async () => {
    const rack = makeLocation({ name: "Kitchen rack" });
    const wine = makeWine();
    await db.locations.bulkAdd([rack, makeLocation({ name: "Attic" })]);
    await db.wines.add(wine);
    await db.lots.bulkAdd([
      makeLot({ wineId: wine.id, locationId: rack.id, quantity: 4 }),
      makeLot({ wineId: wine.id, locationId: rack.id, quantity: 2 }),
    ]);
    await openPage();
    const item = (await screen.findByText("Kitchen rack")).closest("li")!;
    expect(item).toHaveTextContent("6 bottles in 2 lots");
    expect(within(item).getByRole("link", { name: /View bottles/ })).toHaveAttribute(
      "href",
      `/cellar?location=${rack.id}`,
    );
    expect(screen.getByText("Attic").closest("li")).toHaveTextContent("Empty");
  });

  it("adds, renames, and deletes an empty location", async () => {
    const { user } = await openPage();
    await user.type(screen.getByLabelText("New location"), "EuroCave A");
    await user.click(screen.getByRole("button", { name: "Add location" }));
    expect(await screen.findByText("EuroCave A")).toBeInTheDocument();
    expect(await screen.findByText("Created location EuroCave A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename EuroCave A" }));
    const input = screen.getByLabelText("Name for EuroCave A");
    await user.clear(input);
    await user.type(input, "EuroCave B{Enter}");
    expect(await screen.findByText("EuroCave B")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete EuroCave B" }));
    expect(await screen.findByText("Deleted location EuroCave B")).toBeInTheDocument();
    expect(await db.locations.count()).toBe(0);
  });

  it("refuses to delete a location that holds bottles and says how many", async () => {
    const rack = makeLocation({ name: "Kitchen rack" });
    const wine = makeWine();
    await db.locations.add(rack);
    await db.wines.add(wine);
    await db.lots.add(makeLot({ wineId: wine.id, locationId: rack.id, quantity: 6 }));
    const { user } = await openPage();
    await user.click(await screen.findByRole("button", { name: "Delete Kitchen rack" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kitchen rack still holds 6 bottles in 1 lot. Move or drink them first.",
    );
    expect(await db.locations.count()).toBe(1);
  });

  it("shows a location holding only deleted wines' bottles as such, and why it can't be deleted", async () => {
    const rack = makeLocation({ name: "Kitchen rack" });
    const wine = makeWine({ deletedAt: new Date().toISOString() });
    await db.locations.add(rack);
    await db.wines.add(wine);
    await db.lots.add(makeLot({ wineId: wine.id, locationId: rack.id, quantity: 3 }));
    const { user } = await openPage();
    const item = (await screen.findByText("Kitchen rack")).closest("li")!;
    expect(item).not.toHaveTextContent("Empty");
    expect(item).toHaveTextContent("Only bottles of wines in Recently deleted");
    expect(within(item).queryByRole("link", { name: /View bottles/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Kitchen rack" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kitchen rack still holds bottles of wines in Recently deleted. Restore and move them, or delete them forever.",
    );
    expect(await db.locations.count()).toBe(1);
  });

  it("explains a duplicate name", async () => {
    await db.locations.add(makeLocation({ name: "Kitchen rack" }));
    const { user } = await openPage();
    await user.type(screen.getByLabelText("New location"), "kitchen rack");
    await user.click(screen.getByRole("button", { name: "Add location" }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });
});
