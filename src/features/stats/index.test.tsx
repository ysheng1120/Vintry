import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import { consumeBottles } from "../../domain/commands/consumption";
import { addTastingNote } from "../../domain/commands/notes";
import { addBottles, deleteWine } from "../../domain/commands/wines";
import StatsPage from "./index";

function renderStats() {
  return render(
    <MemoryRouter>
      <StatsPage />
    </MemoryRouter>,
  );
}

/** The "Year in wine" <section>, once it has rendered. */
async function findYearInWineSection() {
  const heading = await screen.findByRole("heading", { name: "Year in wine" });
  return heading.closest("section")!;
}

/** The value shown under one of the year recap's stat labels, e.g. "Bottles bought". */
async function statValue(section: HTMLElement, label: string): Promise<HTMLElement> {
  return (await within(section).findByText(label)).closest("div")!;
}

/** Adds Château Margaux and Dr. Loosen, both bought in 2026; the caller sets the clock first. */
async function seed() {
  await addBottles({
    drafts: [
      {
        producer: "Château Margaux",
        vintage: 2015,
        colour: "red",
        country: "France",
        region: "Bordeaux",
        lots: [{ quantity: 3, purchaseDate: "2026-01-05", pricePerBottle: 500, currency: "GBP" }],
      },
    ],
  });
  await addBottles({
    drafts: [
      {
        producer: "Dr. Loosen",
        vintage: 2021,
        colour: "white",
        country: "Germany",
        windowFrom: 2022,
        windowTo: 2032,
        lots: [{ quantity: 2, purchaseDate: "2026-02-01", pricePerBottle: 20, currency: "GBP" }],
      },
    ],
  });
  const margaux = (await db.wines.where("producer").equals("Château Margaux").first())!;
  const loosen = (await db.wines.where("producer").equals("Dr. Loosen").first())!;
  const lot = (await db.lots.where("wineId").equals(margaux.id).first())!;
  await consumeBottles({ lotId: lot.id, quantity: 1, date: "2026-08-15" });
  await addTastingNote({
    wineId: margaux.id,
    text: "Lovely, still tight",
    rating: 90,
    date: "2026-08-15",
  });
  return { margaux, loosen };
}

describe("StatsPage", () => {
  beforeEach(resetDatabase);

  it("shows the empty state when the cellar has no bottles and no history", async () => {
    renderStats();
    expect(await screen.findByText("No stats yet")).toBeInTheDocument();
  });

  it("charts bottles by colour, country, region, decade, status and drinks per month, summing to the total", async () => {
    setClock("2026-09-26T09:00:00Z");
    await seed();
    renderStats();

    const byColour = await screen.findByRole("img", { name: /Bottles by colour/ });
    expect(byColour).toHaveAccessibleName(/Red 2 bottles/);
    expect(byColour).toHaveAccessibleName(/White 2 bottles/);

    expect(screen.getByRole("img", { name: /Bottles by country/ })).toHaveAccessibleName(
      /France 2 bottles/,
    );
    expect(screen.getByRole("img", { name: /Bottles by region/ })).toHaveAccessibleName(
      /Bordeaux 2 bottles/,
    );
    expect(screen.getByRole("img", { name: /vintage decade/i })).toHaveAccessibleName(
      /2010s 2 bottles/,
    );
    expect(screen.getByRole("img", { name: /window status/i })).toHaveAccessibleName(
      /Ready 2 bottles/,
    );
    expect(screen.getByRole("img", { name: /drunk per month/i })).toHaveAccessibleName(
      /Aug.*1 bottle/,
    );

    expect(screen.getByText(/4 bottles/)).toBeInTheDocument();
  });

  it("recaps the chosen year: bottles bought, money spent, drinks, top wines, rating and colours", async () => {
    setClock("2026-09-26T09:00:00Z");
    const { margaux } = await seed();
    renderStats();

    const section = await findYearInWineSection();
    expect(within(section).getByRole("combobox", { name: "Year" })).toHaveValue("2026");
    expect(within(await statValue(section, "Bottles bought")).getByText("5 bottles")).toBeVisible();
    expect(within(await statValue(section, "Money spent")).getByText("£1,540.00")).toBeVisible();
    expect(within(await statValue(section, "Bottles drunk")).getByText("1 bottle")).toBeVisible();

    const topWine = within(section).getByRole("link", { name: /Château Margaux 2015/ });
    expect(topWine).toHaveAttribute("href", `/wine/${margaux.id}`);

    // 90/100 renders as 4.5 out of 5 stars (StarRating's own scale).
    expect(within(section).getByRole("img", { name: /Rated 4\.5 out of 5/ })).toBeInTheDocument();

    expect(within(section).getByRole("img", { name: /Colours drunk/ })).toHaveAccessibleName(
      /Red 1 bottle/,
    );
  });

  it("switches the year recap when another year is picked", async () => {
    setClock("2025-06-01T09:00:00Z");
    await addBottles({
      drafts: [
        {
          producer: "Krug",
          name: "Grande Cuvée",
          vintage: null,
          colour: "sparkling",
          lots: [{ quantity: 2, purchaseDate: "2025-06-01", pricePerBottle: 150, currency: "GBP" }],
        },
      ],
    });
    setClock("2026-09-26T09:00:00Z");
    await seed();
    renderStats();
    const user = userEvent.setup();

    const section = await findYearInWineSection();
    const select = within(section).getByRole("combobox", { name: "Year" });
    expect(select).toHaveValue("2026");
    expect(within(await statValue(section, "Bottles bought")).getByText("5 bottles")).toBeVisible();

    await user.selectOptions(select, "2025");
    expect(within(await statValue(section, "Bottles bought")).getByText("2 bottles")).toBeVisible();
    expect(within(await statValue(section, "Money spent")).getByText("£300.00")).toBeVisible();
    expect(within(await statValue(section, "Bottles drunk")).getByText("0 bottles")).toBeVisible();
  });

  it("charts spending per year, per currency, with a note for other currencies", async () => {
    setClock("2026-09-26T09:00:00Z");
    await seed();
    await addBottles({
      drafts: [
        {
          producer: "Ridge",
          name: "Monte Bello",
          vintage: 2019,
          colour: "red",
          lots: [{ quantity: 1, purchaseDate: "2026-03-01", pricePerBottle: 300, currency: "USD" }],
        },
      ],
    });
    renderStats();

    expect(await screen.findByRole("img", { name: /Spending per year/ })).toHaveAccessibleName(
      /2026 £1,540\.00/,
    );
    expect(screen.getByText(/Also spent in USD/)).toBeInTheDocument();
  });

  it("excludes a soft-deleted wine's bought bottles and spending but keeps its drinks in the total", async () => {
    setClock("2026-09-26T09:00:00Z");
    const { loosen } = await seed();
    await deleteWine({ wineId: loosen.id });
    renderStats();

    const section = await findYearInWineSection();
    expect(within(await statValue(section, "Bottles bought")).getByText("3 bottles")).toBeVisible();
    expect(within(await statValue(section, "Money spent")).getByText("£1,500.00")).toBeVisible();
    expect(within(await statValue(section, "Bottles drunk")).getByText("1 bottle")).toBeVisible();
  });
});
