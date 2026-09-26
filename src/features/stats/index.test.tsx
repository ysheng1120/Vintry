import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import { consumeBottles } from "../../domain/commands/consumption";
import { addBottles } from "../../domain/commands/wines";
import StatsPage from "./index";

async function seed() {
  setClock("2026-09-01T09:00:00Z");
  await addBottles({
    drafts: [
      {
        producer: "Château Margaux",
        vintage: 2015,
        colour: "red",
        country: "France",
        lots: [{ quantity: 3 }],
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
        lots: [{ quantity: 2 }],
      },
    ],
  });
  const margaux = (await db.wines.where("producer").equals("Château Margaux").first())!;
  const lot = (await db.lots.where("wineId").equals(margaux.id).first())!;
  await consumeBottles({ lotId: lot.id, quantity: 1, date: "2026-08-15" });
}

describe("StatsPage", () => {
  beforeEach(resetDatabase);

  it("shows the empty state when the cellar has no bottles and no history", async () => {
    render(<StatsPage />);
    expect(await screen.findByText("No stats yet")).toBeInTheDocument();
  });

  it("charts bottles by colour, country, decade, status and drinks per month, summing to the total", async () => {
    setClock("2026-09-26T09:00:00Z");
    await seed();
    render(<StatsPage />);

    const byColour = await screen.findByRole("img", { name: /Bottles by colour/ });
    expect(byColour).toHaveAccessibleName(/Red 2 bottles/);
    expect(byColour).toHaveAccessibleName(/White 2 bottles/);

    expect(screen.getByRole("img", { name: /Bottles by country/ })).toHaveAccessibleName(
      /France 2 bottles/,
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
});
