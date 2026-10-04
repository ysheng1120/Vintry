import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { renderCellarApp } from "./testing";

beforeEach(resetDatabase);

/** A big-cellar smoke test: the list only mounts its first page, with a "Show more" button. */
async function seedManyWines(count: number) {
  const rack = makeLocation({ name: "Rack" });
  await db.locations.add(rack);
  const wines = Array.from({ length: count }, (_, i) =>
    makeWine({ producer: `Producer ${String(i).padStart(3, "0")}`, vintage: 2000 + (i % 20) }),
  );
  await db.wines.bulkAdd(wines);
  await db.lots.bulkAdd(wines.map((w) => makeLot({ wineId: w.id, locationId: rack.id })));
}

const rows = () => within(screen.getByRole("list", { name: "Wines" })).getAllByRole("link");

// Each test renders up to 240 rows, which takes about 4s alone and longer under full-suite load.
describe("Cellar list pagination", { timeout: 20_000 }, () => {
  it("renders only the first 100 rows and reveals more with the Show more button", async () => {
    await seedManyWines(240);
    const { user } = renderCellarApp("/cellar");
    await screen.findByRole("link", { name: /Producer 000/ });
    expect(rows()).toHaveLength(100);

    const showMore = screen.getByRole("button", { name: /Show more \(140 more\)/ });
    await user.click(showMore);
    expect(rows()).toHaveLength(200);
    expect(screen.getByRole("button", { name: /Show more \(40 more\)/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Show more \(40 more\)/ }));
    expect(rows()).toHaveLength(240);
    expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
  });

  it("keeps the rows shown when a live update changes data elsewhere", async () => {
    await seedManyWines(240);
    const { user } = renderCellarApp("/cellar");
    await screen.findByRole("link", { name: /Producer 000/ });
    await user.click(screen.getByRole("button", { name: /Show more/ }));
    expect(rows()).toHaveLength(200);

    const other = (await db.wines.toArray()).at(-1)!;
    await db.wines.update(other.id, { rating: 80 });
    await screen.findByRole("button", { name: /Show more \(40 more\)/ });
    expect(rows()).toHaveLength(200);
  });

  it("does not show a Show more button under the page size", async () => {
    await seedManyWines(5);
    renderCellarApp("/cellar");
    await screen.findByRole("link", { name: /Producer 000/ });
    expect(rows()).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
  });

  it("goes back to the first page when the search narrows the list", async () => {
    await seedManyWines(150);
    const { user } = renderCellarApp("/cellar");
    await screen.findByRole("link", { name: /Producer 000/ });
    expect(rows()).toHaveLength(100);
    await user.click(screen.getByRole("button", { name: /Show more/ }));
    expect(rows()).toHaveLength(150);

    const search = screen.getByRole("searchbox", { name: "Search your cellar" });
    await user.type(search, "producer 149");
    await screen.findByRole("link", { name: /Producer 149/ });
    expect(rows()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
  });
});
