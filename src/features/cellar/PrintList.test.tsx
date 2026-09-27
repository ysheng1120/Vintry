import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { renderCellarApp } from "./testing";

beforeEach(resetDatabase);

async function seed() {
  const rack = makeLocation({ name: "Kitchen rack" });
  const wines = [
    makeWine({
      producer: "Giacomo Conterno",
      name: "Barolo Cascina Francia",
      vintage: 2016,
      region: "Piedmont",
      country: "Italy",
      colour: "red",
      windowFrom: 2024,
      windowTo: 2040,
    }),
    makeWine({
      producer: "Domaine Leflaive",
      name: "Puligny-Montrachet",
      vintage: 2018,
      region: "Burgundy",
      country: "France",
      colour: "white",
      windowFrom: null,
      windowTo: null,
    }),
  ];
  await db.locations.add(rack);
  await db.wines.bulkAdd(wines);
  await db.lots.bulkAdd([
    makeLot({ wineId: wines[0]!.id, locationId: rack.id, quantity: 3 }),
    makeLot({ wineId: wines[1]!.id, locationId: rack.id, quantity: 6 }),
  ]);
  return wines;
}

const printTable = () => screen.getByRole("table");

describe("Cellar printable list", () => {
  it("shows a Print list button that opens the browser print dialog", async () => {
    await seed();
    const { user } = renderCellarApp("/cellar");
    await screen.findByRole("link", { name: /Barolo/ });

    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: "Print list" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it("renders the print-only table with the current filtered rows and a title", async () => {
    await seed();
    const { user } = renderCellarApp("/cellar");
    await screen.findByRole("link", { name: /Barolo/ });

    // Two wines to start with.
    expect(within(printTable()).getAllByRole("row")).toHaveLength(3); // header + 2 rows

    await user.type(screen.getByRole("searchbox", { name: "Search your cellar" }), "Puligny");

    const table = printTable();
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2); // header + 1 filtered row
    expect(within(table).getByText("Domaine Leflaive Puligny-Montrachet")).toBeInTheDocument();
    expect(within(table).queryByText(/Cascina Francia/)).not.toBeInTheDocument();
    expect(within(table).getByText("2018")).toBeInTheDocument();
    expect(within(table).getByText("White")).toBeInTheDocument();
    expect(within(table).getByText("Burgundy, France")).toBeInTheDocument();
    expect(within(table).getByText("Kitchen rack")).toBeInTheDocument();
    expect(within(table).getByText("6")).toBeInTheDocument();
    expect(within(table).getByText("No window")).toBeInTheDocument();

    expect(screen.getByText(/^Vintry cellar list — .+ — 1 wine, 6 bottles$/)).toBeInTheDocument();
  });
});
