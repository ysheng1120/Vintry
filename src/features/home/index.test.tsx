import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { addBottles, deleteWine, updateWine } from "../../domain/commands/wines";
import { setClock } from "../../domain/clock";
import { makeLot, makeWine } from "../../db/testing";
import HomePage from "./index";

vi.mock("../../ai/useAiStatus", () => ({
  useAiStatus: () => ({ state: "no-key" }),
}));

function renderHome() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <HomePage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function addWine(overrides: Parameters<typeof addBottles>[0]["drafts"][0]) {
  await addBottles({ drafts: [overrides] });
}

describe("HomePage", () => {
  beforeEach(resetDatabase);

  it("shows the empty-cellar state with add and sample actions", async () => {
    renderHome();
    expect(await screen.findByText("Your cellar is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add your first wine" })).toHaveAttribute(
      "href",
      "/add",
    );
    expect(screen.getByRole("button", { name: "Explore a sample cellar" })).toBeInTheDocument();
  });

  it("loads the sample cellar from the empty state", async () => {
    renderHome();
    await userEvent.click(await screen.findByRole("button", { name: "Explore a sample cellar" }));
    await waitFor(async () => expect(await db.wines.count()).toBeGreaterThan(0));
    expect(await screen.findByText(/Loaded the sample cellar/)).toBeInTheDocument();
  });

  it("shows the refusal reason when undo of the sample load is blocked by a later change", async () => {
    renderHome();
    await userEvent.click(await screen.findByRole("button", { name: "Explore a sample cellar" }));
    await waitFor(async () => expect(await db.wines.count()).toBeGreaterThan(0));
    await screen.findByText(/Loaded the sample cellar/);

    // A later change touching one of the sample's own wines blocks undoing the load.
    const wine = (await db.wines.toArray())[0]!;
    await deleteWine({ wineId: wine.id });

    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Couldn't undo")).toBeInTheDocument();
    expect(await screen.findByText(/A later change touched/)).toBeInTheDocument();
  });

  it("lists each wine under the section its window status gives, with counts and cost", async () => {
    setClock("2026-01-05T09:00:00Z");
    await addWine({
      producer: "Ridge",
      name: "Monte Bello",
      vintage: 2019,
      colour: "red",
      windowFrom: 2022,
      windowTo: 2030,
      lots: [{ quantity: 3, pricePerBottle: 250, currency: "USD" }],
    });
    await addWine({
      producer: "Dr. Loosen",
      name: "Riesling Kabinett",
      vintage: 2021,
      colour: "white",
      windowFrom: 2022,
      windowTo: 2026,
      lots: [{ quantity: 2, pricePerBottle: 20, currency: "GBP" }],
    });
    await addWine({
      producer: "Taittinger",
      name: "Brut",
      vintage: null,
      colour: "sparkling",
      windowFrom: 2018,
      windowTo: 2024,
      lots: [{ quantity: 1 }],
    });

    renderHome();

    expect(await screen.findByText(/6 bottles/)).toBeInTheDocument();
    expect(screen.getByText(/3 wines/)).toBeInTheDocument();

    const ready = screen.getByRole("heading", { name: "Ready now" }).closest("section")!;
    expect(within(ready).getByText("Ridge Monte Bello 2019")).toBeInTheDocument();

    const soon = screen.getByRole("heading", { name: "Drink soon" }).closest("section")!;
    expect(within(soon).getByText("Dr. Loosen Riesling Kabinett 2021")).toBeInTheDocument();

    const past = screen.getByRole("heading", { name: "Past peak" }).closest("section")!;
    expect(within(past).getByText("Taittinger Brut NV")).toBeInTheDocument();

    expect(screen.getByText("$750.00")).toBeInTheDocument();
    expect(screen.getByText("£40.00")).toBeInTheDocument();
  });

  it("shows a no-window count with Set windows only, when there is no AI key", async () => {
    for (const producer of ["Estate A", "Estate B", "Estate C"]) {
      await addWine({ producer, vintage: null, colour: "red", lots: [{ quantity: 1 }] });
    }
    renderHome();
    expect(await screen.findByText("No drinking window yet (3)")).toBeInTheDocument();
    const setWindows = screen.getByRole("link", { name: "Set windows" });
    expect(setWindows).toHaveAttribute("href", "/cellar?status=none");
    expect(screen.queryByRole("link", { name: "Estimate all with AI" })).not.toBeInTheDocument();
  });

  it("hides sections with nothing in them", async () => {
    await addWine({
      producer: "Ridge",
      vintage: null,
      colour: "red",
      windowFrom: 2022,
      windowTo: 2030,
      lots: [{ quantity: 1 }],
    });
    renderHome();
    await screen.findByRole("heading", { name: "Ready now" });
    expect(screen.queryByRole("heading", { name: "Past peak" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Drink soon" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No drinking window yet/)).not.toBeInTheDocument();
  });

  it("shows the cellar value from the collector's own values, per currency, with how many wines count", async () => {
    await addWine({ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] });
    await addWine({ producer: "Latour", vintage: 2010, colour: "red", lots: [{ quantity: 2 }] });
    await addWine({ producer: "Loosen", vintage: 2021, colour: "white", lots: [{ quantity: 1 }] });
    const ids = new Map((await db.wines.toArray()).map((w) => [w.producer, w.id]));
    await updateWine({
      wineId: ids.get("Ridge")!,
      patch: { valuePerBottle: 200, valueCurrency: "USD" },
    });
    await updateWine({
      wineId: ids.get("Latour")!,
      patch: { valuePerBottle: 450, valueCurrency: "GBP" },
    });

    renderHome();
    const value = (await screen.findByRole("heading", { name: "Cellar value" })).closest(
      "section",
    )!;
    expect(within(value).getByText("$600.00")).toBeInTheDocument();
    expect(within(value).getByText("£900.00")).toBeInTheDocument();
    expect(
      within(value).getByText("Based on values you entered for 2 of 3 wines."),
    ).toBeInTheDocument();
  });

  it("has no cellar value section until a value is entered", async () => {
    await addWine({ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] });
    renderHome();
    await screen.findByText(/You have 3 bottles/);
    expect(screen.queryByRole("heading", { name: "Cellar value" })).not.toBeInTheDocument();
  });

  it("offers quick questions for the sommelier, with a note that AI needs a key", async () => {
    await addWine({ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] });
    renderHome();
    const card = (
      await screen.findByRole("heading", { name: "Not sure what to open tonight?" })
    ).closest("section")!;
    for (const label of ["Something to drink now", "Pair with dinner", "A bottle past its best"]) {
      const link = within(card).getByRole("link", { name: label });
      const href = link.getAttribute("href")!;
      expect(href).toMatch(/^\/sommelier\?ask=/);
      const question = new URLSearchParams(href.split("?")[1]).get("ask");
      expect(question && question.length).toBeGreaterThan(10);
    }
    expect(within(card).getByRole("link", { name: "Needs an AI key" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("hides the quick questions when no bottles are left", async () => {
    await addWine({ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 1 }] });
    await db.lots.toCollection().modify({ quantity: 0 });
    renderHome();
    await screen.findByText(/You have 0 bottles/);
    expect(screen.queryByText("Not sure what to open tonight?")).not.toBeInTheDocument();
  });

  it("shows favourites down to their last bottle, best-rated first, and links to Buy again", async () => {
    await addWine({
      producer: "Ridge",
      name: "Monte Bello",
      vintage: 2019,
      colour: "red",
      rating: 92,
      lots: [{ quantity: 1 }],
    });
    await addWine({
      producer: "Latour",
      vintage: 2010,
      colour: "red",
      rating: 98,
      lots: [{ quantity: 1 }],
    });
    // Rated well but two bottles left: not a "last bottle".
    await addWine({
      producer: "Yquem",
      vintage: 2015,
      colour: "dessert",
      rating: 95,
      lots: [{ quantity: 2 }],
    });
    // Down to one bottle, but not rated well.
    await addWine({
      producer: "Estate X",
      vintage: 2020,
      colour: "red",
      rating: 70,
      lots: [{ quantity: 1 }],
    });

    renderHome();
    const section = (await screen.findByRole("heading", { name: "Last bottles" })).closest(
      "section",
    )!;
    const cards = within(section).getAllByRole("link");
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining("Latour 2010"),
      expect.stringContaining("Ridge Monte Bello 2019"),
    ]);
    expect(cards[0]).toHaveAttribute("href", expect.stringMatching(/^\/wine\//));
    expect(within(section).getAllByText("Buy again")).toHaveLength(2);
    expect(within(section).queryByText(/Yquem/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/Estate X/)).not.toBeInTheDocument();
  });

  it("hides the Last bottles section when nothing qualifies", async () => {
    await addWine({
      producer: "Ridge",
      vintage: 2019,
      colour: "red",
      windowFrom: 2022,
      windowTo: 2030,
      lots: [{ quantity: 3 }],
    });
    renderHome();
    await screen.findByRole("heading", { name: "Ready now" });
    expect(screen.queryByRole("heading", { name: "Last bottles" })).not.toBeInTheDocument();
  });

  it("renders quickly with 500 wines (Verification Contract)", async () => {
    const wines = Array.from({ length: 500 }, (_, i) =>
      makeWine({
        producer: `Estate ${i}`,
        vintage: 2000 + (i % 20),
        colour: "red",
        windowFrom: 2020,
        windowTo: 2032,
      }),
    );
    const lots = wines.map((w) => makeLot({ wineId: w.id, quantity: 1 }));
    await db.wines.bulkAdd(wines);
    await db.lots.bulkAdd(lots);

    const start = performance.now();
    renderHome();
    await screen.findByRole("heading", { name: "Ready now" });
    const elapsed = performance.now() - start;

    // jsdom is slower than a real browser; a generous ceiling still catches a real regression.
    expect(elapsed).toBeLessThan(2000);
  });

  it("shows at most 6 wines per section until Show all is pressed", async () => {
    const wines = Array.from({ length: 9 }, (_, i) =>
      makeWine({ producer: `Estate ${i}`, colour: "red", windowFrom: 2020, windowTo: 2040 }),
    );
    await db.wines.bulkAdd(wines);
    await db.lots.bulkAdd(wines.map((w) => makeLot({ wineId: w.id, quantity: 1 })));

    renderHome();
    const heading = await screen.findByRole("heading", { name: "Ready now" });
    const section = heading.closest("section")!;
    expect(within(section).getAllByRole("listitem")).toHaveLength(6);

    const button = within(section).getByRole("button", { name: "Show all 9" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(within(section).getAllByRole("listitem")).toHaveLength(9);

    await userEvent.click(within(section).getByRole("button", { name: "Show fewer" }));
    expect(within(section).getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("HomePage with AI ready", () => {
  beforeEach(resetDatabase);

  it("offers Estimate all with AI when a key is ready", async () => {
    vi.resetModules();
    vi.doMock("../../ai/useAiStatus", () => ({ useAiStatus: () => ({ state: "ready" }) }));
    const { default: HomePageWithAi } = await import("./index");
    for (const producer of ["Estate A", "Estate B"]) {
      await addWine({ producer, vintage: null, colour: "red", lots: [{ quantity: 1 }] });
    }
    render(
      <MemoryRouter>
        <ToastProvider>
          <HomePageWithAi />
        </ToastProvider>
      </MemoryRouter>,
    );
    const estimate = await screen.findByRole("link", { name: "Estimate all with AI" });
    expect(estimate).toHaveAttribute("href", "/cellar?status=none&estimate=all");
    // The quick questions need no key note when AI is ready.
    expect(screen.getByRole("link", { name: "Something to drink now" })).toBeInTheDocument();
    expect(screen.queryByText("Needs an AI key")).not.toBeInTheDocument();
    vi.doUnmock("../../ai/useAiStatus");
  });
});
