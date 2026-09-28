import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeLocation } from "../../db/testing";
import { resetDatabase } from "../../db/testing";
import ImportPage from "./index";

vi.mock("../../ai/useAiStatus", () => ({ useAiStatus: () => ({ state: "no-key" as const }) }));
vi.mock("../../ai/features/mapCsv", () => ({
  suggestCsvMapping: vi.fn(async () => ({ mapping: {}, notes: [] })),
}));

function renderPage() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <ImportPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

function csvFile(name: string, text: string, type = "text/csv"): File {
  return new File([text], name, { type });
}

const CT_CSV =
  "Producer,Wine,Vintage,Color,Country,Region,Quantity,Price,Currency,BeginConsume,EndConsume\n" +
  "Ridge,Monte Bello,2019,Red,USA,California,6,250,USD,2024,2034\n" +
  "Ridge,Lytton Springs,2020,Red,USA,California,3,60,USD,9999,9999\n";

async function chooseFile(text: string, name = "cellar.csv") {
  const input = screen.getByLabelText(/CSV, TSV, or text file/i);
  const file = csvFile(name, text);
  await userEvent.upload(input, file);
}

describe("ImportPage", () => {
  beforeEach(resetDatabase);

  it("starts on the file step with a drop zone", () => {
    renderPage();
    expect(screen.getByText("Drop a CSV file here, or")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeInTheDocument();
  });

  it("rejects a file with an unsupported extension", async () => {
    renderPage();
    const input = screen.getByLabelText(/CSV, TSV, or text file/i);
    // fireEvent (not userEvent.upload) bypasses the input's `accept` filtering, the way choosing
    // "All files" in a real file picker would.
    fireEvent.change(input, {
      target: { files: [csvFile("photo.png", "not a csv", "image/png")] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/\.csv, \.tsv, or \.txt/);
  });

  it("detects CellarTracker headers and pre-fills the mapping", async () => {
    renderPage();
    await chooseFile(CT_CSV);
    expect(await screen.findByText("CellarTracker", { selector: "span" })).toBeInTheDocument();
    const producerSelect = screen.getByLabelText(/^Producer/) as HTMLSelectElement;
    expect(producerSelect.value).toBe("Producer");
  });

  it("refuses to continue without a producer column mapped", async () => {
    renderPage();
    await chooseFile("Wine,Vintage\nSomething,2020\n", "odd.csv");
    await screen.findByText(/Generic CSV/);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Producer/);
  });

  it("shows the manual mapping editor for a generic file with no AI key", async () => {
    renderPage();
    await chooseFile("Bottle,Maker\nA,B\n", "generic.csv");
    await screen.findByText(/Generic CSV/);
    expect(screen.queryByRole("button", { name: "Suggest with AI" })).not.toBeInTheDocument();
  });

  it("imports a CellarTracker-shaped file end to end, applying the 9999 window sentinel", async () => {
    await db.locations.add(makeLocation({ id: "kitchen", name: "Kitchen rack" }));
    renderPage();

    await chooseFile(CT_CSV);
    await screen.findByText("CellarTracker", { selector: "span" });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("Default currency");
    await userEvent.selectOptions(screen.getByLabelText("Default location"), "Kitchen rack");
    await userEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText(/2 wines will be imported/)).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Ridge Monte Bello 2019")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Import 2 wines/ }));

    await waitFor(async () => expect(await db.wines.count()).toBe(2));
    const wines = await db.wines.toArray();
    const lyttonSprings = wines.find((w) => w.name === "Lytton Springs");
    expect(lyttonSprings).toMatchObject({ windowFrom: null, windowTo: null });
    const lots = await db.lots.toArray();
    expect(lots.every((lot) => lot.locationId === "kitchen")).toBe(true);

    expect(await screen.findByRole("link", { name: "Go to cellar" })).toBeInTheDocument();
  });

  it("creates the locations a file names, instead of putting their bottles under No location", async () => {
    await db.locations.add(makeLocation({ id: "kitchen", name: "Kitchen rack" }));
    renderPage();

    await chooseFile(
      "Producer,Wine,Vintage,Color,Quantity,Location,Bin\n" +
        "Ridge,Monte Bello,2019,Red,6,Rack 1,A1\n" +
        "Ridge,Lytton Springs,2020,Red,3,rack 1,A2\n" +
        "Ridge,Geyserville,2021,Red,2,Rack 2,\n" +
        "Ridge,East Bench,2021,Red,1,Kitchen Rack,\n",
      "racks.csv",
    );
    await screen.findByText(/Generic CSV/);
    await userEvent.selectOptions(screen.getByLabelText(/^Producer/), "Producer");
    await userEvent.selectOptions(screen.getByLabelText(/^Cuvée/), "Wine");
    await userEvent.selectOptions(screen.getByLabelText(/^Vintage/), "Vintage");
    await userEvent.selectOptions(screen.getByLabelText(/^Location/), "Location");
    await userEvent.selectOptions(screen.getByLabelText(/^Bin/), "Bin");
    await userEvent.selectOptions(screen.getByLabelText(/^Quantity/), "Quantity");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Default currency");
    await userEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("2 new locations will be created:")).toBeInTheDocument();
    expect(screen.getByText("Rack 1, Rack 2")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Rack 1 · A1")).toBeInTheDocument();
    expect(within(table).getByText("Kitchen rack")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Import 4 wines/ }));
    await waitFor(async () => expect(await db.wines.count()).toBe(4));

    const locations = await db.locations.toArray();
    expect(locations.map((l) => l.name).sort()).toEqual(["Kitchen rack", "Rack 1", "Rack 2"]);
    const idOf = (name: string) => locations.find((l) => l.name === name)!.id;
    const lots = await db.lots.toArray();
    const bottlesAt = (id: string) =>
      lots.filter((l) => l.locationId === id).reduce((sum, l) => sum + l.quantity, 0);
    expect(bottlesAt(idOf("Rack 1"))).toBe(9);
    expect(bottlesAt(idOf("Rack 2"))).toBe(2);
    expect(bottlesAt("kitchen")).toBe(1);
    expect(lots.some((l) => l.locationId === null)).toBe(false);
  });

  it("reuses an existing location whose name matches a typed new-location name", async () => {
    await db.locations.add(makeLocation({ id: "kitchen", name: "Kitchen rack" }));
    renderPage();

    await chooseFile("Producer,Wine,Vintage,Color\nRidge,Monte Bello,2019,Red\n", "one.csv");
    await screen.findByText(/Generic CSV/);
    await userEvent.selectOptions(screen.getByLabelText(/^Producer/), "Producer");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("Default currency");
    await userEvent.selectOptions(screen.getByLabelText("Default location"), "Add a new location…");
    await userEvent.type(screen.getByLabelText("New location name"), "kitchen RACK");
    await userEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await userEvent.click(screen.getByRole("button", { name: /Import 1 wine/ }));

    await waitFor(async () => expect(await db.wines.count()).toBe(1));
    expect(await db.locations.count()).toBe(1);
    const lots = await db.lots.toArray();
    expect(lots[0]?.locationId).toBe("kitchen");
  });

  it("skips a row missing a producer and shows the count in the preview", async () => {
    renderPage();
    const csv =
      "Producer,Wine,Vintage,Color\nRidge,Monte Bello,2019,Red\n,No Producer,2020,White\n";
    await chooseFile(csv, "mixed.csv");
    await userEvent.selectOptions(await screen.findByLabelText(/^Producer/), "Producer");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Default currency");
    await userEvent.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText(/1 wine will be imported, 1 row skipped/)).toBeInTheDocument();
  });

  async function chooseAndMapSmallFile() {
    await chooseFile("Producer,Wine,Vintage,Color\nRidge,Monte Bello,2019,Red\n", "small.csv");
    await screen.findByText(/Generic CSV/);
    await userEvent.selectOptions(await screen.findByLabelText(/^Producer/), "Producer");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Default currency");
    await userEvent.click(screen.getByRole("button", { name: "Preview import" }));
  }

  it("importing the same small CSV twice shows the notice and imports 0 rows by default", async () => {
    renderPage();
    await chooseAndMapSmallFile();
    await userEvent.click(await screen.findByRole("button", { name: /Import 1 wine/ }));
    await waitFor(async () => expect(await db.wines.count()).toBe(1));

    await userEvent.click(screen.getByRole("button", { name: "Import another file" }));
    await chooseAndMapSmallFile();

    expect(await screen.findByText(/This file looks already imported\./)).toBeInTheDocument();
    expect(screen.getByText("Already in your cellar")).toBeInTheDocument();
    const importButton = screen.getByRole("button", { name: "Import 0 wines" });
    expect(importButton).toBeDisabled();

    await userEvent.click(importButton);
    expect(await db.wines.count()).toBe(1);
    expect(await db.lots.count()).toBe(1);
  });

  describe("an updated CellarTracker export", () => {
    const HEADERS = "iWine,Producer,Wine,Vintage,Color,Quantity,Location,Bin,Price,Currency\n";
    const FIRST =
      HEADERS +
      "100001,Ridge,Ridge Monte Bello,2019,Red,6,Cellar,A1,250,USD\n" +
      "100002,Ridge,Ridge Lytton Springs,2020,Red,3,Cellar,A2,60,USD\n" +
      "100003,Ridge,Ridge Geyserville,2021,Red,2,Cellar,A3,45,USD\n";
    // One more Monte Bello bought, one Lytton Springs drunk (not yet recorded in Vintry).
    const UPDATED =
      HEADERS +
      "100001,Ridge,Ridge Monte Bello,2019,Red,7,Cellar,A1,250,USD\n" +
      "100002,Ridge,Ridge Lytton Springs,2020,Red,2,Cellar,A2,60,USD\n" +
      "100003,Ridge,Ridge Geyserville,2021,Red,2,Cellar,A3,45,USD\n";

    async function previewCellarTracker(text: string) {
      await chooseFile(text, "cellartracker.csv");
      await screen.findByText("CellarTracker", { selector: "span" });
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByText("Default currency");
      await userEvent.click(screen.getByRole("button", { name: "Preview import" }));
    }

    async function importFirstFile() {
      renderPage();
      await previewCellarTracker(FIRST);
      await userEvent.click(await screen.findByRole("button", { name: "Import 3 wines" }));
      await waitFor(async () => expect(await db.lots.count()).toBe(3));
      await userEvent.click(await screen.findByRole("button", { name: "Import another file" }));
    }

    const bottlesOf = async (name: string) => {
      const wine = (await db.wines.toArray()).find((w) => w.name === name)!;
      const lots = await db.lots.where("wineId").equals(wine.id).toArray();
      return lots.reduce((sum, lot) => sum + lot.quantity, 0);
    };

    it("adds only the new bottle and leaves the rest as they are", async () => {
      await importFirstFile();
      await previewCellarTracker(UPDATED);

      const table = await screen.findByRole("table");
      expect(within(table).getByText("Adds 1 (6 already in your cellar)")).toBeInTheDocument();
      expect(
        within(table).getByText("Vintry has 3, the file has 2: record drinks in Vintry"),
      ).toBeInTheDocument();
      expect(within(table).getByText("Already in your cellar")).toBeInTheDocument();
      expect(screen.getByText(/2 of 3 rows look already in your cellar\./)).toBeInTheDocument();
      expect(
        screen.getByText("1 row has more bottles than your cellar. Only the new ones are added."),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Import 1 wine" }));
      await waitFor(async () => expect(await bottlesOf("Monte Bello")).toBe(7));
      expect(await bottlesOf("Lytton Springs")).toBe(3);
      expect(await bottlesOf("Geyserville")).toBe(2);
      expect(await db.wines.count()).toBe(3);
      expect(await db.locations.count()).toBe(1);
    });

    it("imports the whole row when it is included anyway", async () => {
      await importFirstFile();
      await previewCellarTracker(UPDATED);

      await userEvent.click(await screen.findByLabelText("Import all of row 1 anyway"));
      await userEvent.click(screen.getByLabelText("Include row 2 anyway"));
      await userEvent.click(screen.getByRole("button", { name: "Import 2 wines" }));
      await waitFor(async () => expect(await bottlesOf("Monte Bello")).toBe(13));
      expect(await bottlesOf("Lytton Springs")).toBe(5);
    });
  });

  it("importing a row anyway after the notice adds it as a second lot", async () => {
    renderPage();
    await chooseAndMapSmallFile();
    await userEvent.click(await screen.findByRole("button", { name: /Import 1 wine/ }));
    await waitFor(async () => expect(await db.wines.count()).toBe(1));

    await userEvent.click(screen.getByRole("button", { name: "Import another file" }));
    await chooseAndMapSmallFile();
    await screen.findByText(/This file looks already imported\./);

    await userEvent.click(screen.getByRole("button", { name: "Include them anyway" }));
    const importButton = await screen.findByRole("button", { name: "Import 1 wine" });
    expect(importButton).not.toBeDisabled();
    await userEvent.click(importButton);

    await waitFor(async () => expect(await db.lots.count()).toBe(2));
    expect(await db.wines.count()).toBe(1);
  });
});
