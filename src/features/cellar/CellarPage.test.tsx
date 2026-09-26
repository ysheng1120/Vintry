import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { currentYear } from "../../domain/clock";
import { renderCellarApp } from "./testing";

beforeEach(resetDatabase);

const year = currentYear();

async function seed() {
  const rack = makeLocation({ name: "Kitchen rack" });
  const wines = [
    makeWine({
      producer: "Giacomo Conterno",
      name: "Barolo Cascina Francia",
      vintage: 2016,
      region: "Piedmont",
      country: "Italy",
      windowFrom: year - 2,
      windowTo: year + 10,
    }),
    makeWine({
      producer: "Bartolo Mascarello",
      name: "Barolo",
      vintage: 2015,
      region: "Piedmont",
      country: "Italy",
      windowFrom: year - 5,
      windowTo: year + 1,
    }),
    makeWine({
      producer: "Ridge",
      name: "Monte Bello",
      vintage: 2019,
      country: "USA",
      windowFrom: year + 3,
      windowTo: year + 20,
      windowSource: "ai",
    }),
    makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null, colour: "sparkling" }),
  ];
  await db.locations.add(rack);
  await db.wines.bulkAdd(wines);
  await db.lots.bulkAdd(wines.map((w) => makeLot({ wineId: w.id, locationId: rack.id })));
}

const rows = () => within(screen.getByRole("list", { name: "Wines" })).getAllByRole("link");

describe("Cellar list", () => {
  it("searches by name and restores the full list when cleared", async () => {
    await seed();
    const { user } = renderCellarApp("/cellar");
    await screen.findByRole("link", { name: /Monte Bello/ });
    expect(rows()).toHaveLength(4);

    const search = screen.getByRole("searchbox", { name: "Search your cellar" });
    expect(search).toHaveAttribute("id", "cellar-search");
    await user.type(search, "barolo");
    expect(rows()).toHaveLength(2);
    expect(screen.getByText(/2 of 4 wines/)).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("q=barolo");

    await user.clear(search);
    expect(rows()).toHaveLength(4);
  });

  it("filters Ready to Ready and Drink soon wines", async () => {
    await seed();
    const { user } = renderCellarApp("/cellar");
    await screen.findByRole("link", { name: /Monte Bello/ });
    await user.click(screen.getByRole("button", { name: /^Ready/ }));

    const names = rows().map((r) => r.textContent);
    expect(names).toHaveLength(2);
    expect(names.join(" ")).toMatch(/Cascina Francia/);
    expect(names.join(" ")).toMatch(/Mascarello/);
    expect(screen.getByTestId("path")).toHaveTextContent("status=ready");
  });

  it("reads filters from the URL, like the No window link from Home", async () => {
    await seed();
    renderCellarApp("/cellar?status=none");
    await screen.findByRole("link", { name: /Krug/ });
    expect(screen.getByRole("button", { name: /^No window/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(rows()).toHaveLength(1);
  });

  it("shows the row details: vintage or NV, bottles, status, and an AI badge", async () => {
    await seed();
    renderCellarApp("/cellar");
    const ridge = await screen.findByRole("link", { name: /Monte Bello/ });
    expect(ridge).toHaveAttribute("href", expect.stringMatching(/^\/wine\//));
    expect(within(ridge).getByText("Hold")).toBeInTheDocument();
    expect(within(ridge).getByText("AI")).toBeInTheDocument();
    const krug = screen.getByRole("link", { name: /Krug/ });
    expect(within(krug).getByText("NV")).toBeInTheDocument();
    expect(within(krug).getByText("No window")).toBeInTheDocument();
  });

  it("offers to clear filters when nothing matches", async () => {
    await seed();
    const { user } = renderCellarApp("/cellar?q=zinfandel");
    expect(await screen.findByText("No wines match")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]!);
    expect(await screen.findAllByRole("link", { name: /Monte Bello|Krug|Barolo/ })).toHaveLength(4);
    expect(screen.getByRole("searchbox", { name: "Search your cellar" })).toHaveValue("");
  });

  it("offers adding a wine or the sample cellar when empty", async () => {
    const { user } = renderCellarApp("/cellar");
    expect(await screen.findByText("Your cellar is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a wine" })).toHaveAttribute("href", "/add");
    await user.click(screen.getByRole("button", { name: "Load the sample cellar" }));
    expect((await screen.findAllByText("Sample")).length).toBeGreaterThan(0);
  });
});
