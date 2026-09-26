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

    expect(await screen.findByText(/2 wines will be added/)).toBeInTheDocument();
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

  it("skips a row missing a producer and shows the count in the preview", async () => {
    renderPage();
    const csv =
      "Producer,Wine,Vintage,Color\nRidge,Monte Bello,2019,Red\n,No Producer,2020,White\n";
    await chooseFile(csv, "mixed.csv");
    await userEvent.selectOptions(await screen.findByLabelText(/^Producer/), "Producer");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Default currency");
    await userEvent.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText(/1 wine will be added, 1 row skipped/)).toBeInTheDocument();
  });
});
