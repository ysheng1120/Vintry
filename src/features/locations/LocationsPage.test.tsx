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

  describe("bins", () => {
    it("expands a location to show its bottles grouped by bin, naturally sorted", async () => {
      const rack = makeLocation({ name: "Kitchen rack" });
      const ridge = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
      const krug = makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null });
      await db.locations.add(rack);
      await db.wines.bulkAdd([ridge, krug]);
      await db.lots.bulkAdd([
        makeLot({ wineId: ridge.id, locationId: rack.id, bin: "A10", quantity: 2 }),
        makeLot({ wineId: krug.id, locationId: rack.id, bin: "A2", quantity: 3 }),
        makeLot({ wineId: krug.id, locationId: rack.id, bin: null, quantity: 1 }),
      ]);
      const { user } = await openPage();
      const item = (await screen.findByText("Kitchen rack")).closest("li")!;

      const toggle = within(item).getByRole("button", { name: "Show contents" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      await user.click(toggle);
      expect(await screen.findByRole("button", { name: "Hide contents" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // Bins in natural order (A2 before A10), "No bin" last.
      const headings = (await within(item).findAllByRole("heading", { level: 3 })).map(
        (h) => h.textContent,
      );
      expect(headings).toEqual(["A2", "A10", "No bin"]);

      const a2 = screen.getByRole("heading", { level: 3, name: "A2" }).closest("div")!;
      expect(a2).toHaveTextContent("3 bottles");
      const wineLink = within(a2.parentElement as HTMLElement).getByRole("link", {
        name: "Krug Grande Cuvée NV",
      });
      expect(wineLink).toHaveAttribute("href", `/wine/${krug.id}`);

      await user.click(wineLink);
      expect(
        await screen.findByRole("heading", { level: 1, name: "Krug Grande Cuvée NV" }),
      ).toBeInTheDocument();
    });

    it("hides the contents again on toggle, and shows nothing for an empty location", async () => {
      const rack = makeLocation({ name: "Kitchen rack" });
      const attic = makeLocation({ name: "Attic" });
      const wine = makeWine();
      await db.locations.bulkAdd([rack, attic]);
      await db.wines.add(wine);
      await db.lots.add(makeLot({ wineId: wine.id, locationId: rack.id, quantity: 1 }));
      const { user } = await openPage();

      const atticItem = (await screen.findByText("Attic")).closest("li")!;
      expect(within(atticItem).queryByRole("button", { name: /contents/ })).not.toBeInTheDocument();

      const item = (await screen.findByText("Kitchen rack")).closest("li")!;
      await user.click(within(item).getByRole("button", { name: "Show contents" }));
      expect(await within(item).findByRole("heading", { level: 3 })).toBeInTheDocument();
      await user.click(within(item).getByRole("button", { name: "Hide contents" }));
      expect(within(item).queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    });

    it("only counts live, non-deleted bottles in the bins view", async () => {
      const rack = makeLocation({ name: "Kitchen rack" });
      const live = makeWine({ producer: "Live Wine", name: "", vintage: null });
      const deleted = makeWine({
        producer: "Deleted Wine",
        name: "",
        vintage: null,
        deletedAt: new Date().toISOString(),
      });
      await db.locations.add(rack);
      await db.wines.bulkAdd([live, deleted]);
      await db.lots.bulkAdd([
        makeLot({ wineId: live.id, locationId: rack.id, bin: "A1", quantity: 2 }),
        makeLot({ wineId: live.id, locationId: rack.id, bin: "A1", quantity: 0 }),
        makeLot({ wineId: deleted.id, locationId: rack.id, bin: "A1", quantity: 5 }),
      ]);
      const { user } = await openPage();
      const item = (await screen.findByText("Kitchen rack")).closest("li")!;
      await user.click(within(item).getByRole("button", { name: "Show contents" }));

      expect(await within(item).findByText("Live Wine NV")).toBeInTheDocument();
      expect(within(item).queryByText(/Deleted Wine/)).not.toBeInTheDocument();
      expect(
        within(item).getByRole("heading", { level: 3, name: "A1" }).closest("div"),
      ).toHaveTextContent("2 bottles");
    });

    it("shows a search box only past 12 lots, and it narrows the bins shown", async () => {
      const rack = makeLocation({ name: "Kitchen rack" });
      await db.locations.add(rack);
      const wines = await Promise.all(
        Array.from({ length: 13 }, (_, i) => {
          const wine = makeWine({ producer: `Producer ${i}`, name: `Wine ${i}`, vintage: null });
          return db.wines.add(wine).then(() => wine);
        }),
      );
      await db.lots.bulkAdd(
        wines.map((wine, i) =>
          makeLot({ wineId: wine.id, locationId: rack.id, bin: `A${i}`, quantity: 1 }),
        ),
      );
      const { user } = await openPage();
      const item = (await screen.findByText("Kitchen rack")).closest("li")!;
      await user.click(within(item).getByRole("button", { name: "Show contents" }));

      const search = await within(item).findByLabelText("Find a wine in this location");
      expect(await within(item).findByText("Producer 0 Wine 0 NV")).toBeInTheDocument();
      await user.type(search, "Producer 5");
      expect(within(item).getByText("Producer 5 Wine 5 NV")).toBeInTheDocument();
      expect(within(item).queryByText("Producer 0 Wine 0 NV")).not.toBeInTheDocument();
    });
  });
});
