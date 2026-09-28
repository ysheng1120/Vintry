import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import { consumeBottles } from "../../domain/commands/consumption";
import { loadSampleCellar } from "../../domain/commands/sample";
import { addBottles, deleteWine, purgeDeleted } from "../../domain/commands/wines";
import { HISTORY_KEEP_AT_LEAST, pruneHistory } from "../../domain/historyRetention";
import { formatDate } from "../../lib/format";
import HistoryPage from "./index";

function renderHistory() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <HistoryPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function findRowFor(text: string) {
  const items = await screen.findAllByRole("listitem");
  const match = items.find((li) => li.textContent?.includes(text));
  if (!match) throw new Error(`No row found containing "${text}"`);
  return match;
}

describe("HistoryPage", () => {
  beforeEach(resetDatabase);

  it("lists batches newest first with a source label, and undoes the newest on click", async () => {
    setClock("2026-09-01T09:00:00Z");
    await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] }],
    });
    setClock("2026-09-02T09:00:00Z");
    await loadSampleCellar();

    renderHistory();

    const items = await screen.findAllByRole("listitem");
    expect(items[0]?.textContent).toContain("Loaded the sample cellar");
    expect(items[0]?.textContent).toContain("Sample");
    const ridgeRow = await findRowFor("Ridge 2019");
    expect(within(ridgeRow).getByText(/^You/)).toBeInTheDocument();

    await userEvent.click(within(items[0]!).getByRole("button", { name: "Undo" }));
    await screen.findByText(/Undid: Loaded the sample cellar/);
    await waitFor(async () => expect(await db.wines.filter((w) => w.isSample).count()).toBe(0));
  });

  it("disables undo on a blocked batch and explains why", async () => {
    setClock("2026-09-01T09:00:00Z");
    await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] }],
    });
    const lot = (await db.lots.toArray())[0]!;
    setClock("2026-09-02T09:00:00Z");
    await consumeBottles({ lotId: lot.id, quantity: 1 });

    renderHistory();
    const addRow = await findRowFor("Added 3 bottles of Ridge 2019");
    const undoButton = within(addRow).getByRole("button", { name: "Undo" });
    await waitFor(() =>
      expect(undoButton).toHaveAttribute("title", expect.stringContaining("Drank 1 bottle")),
    );
    expect(undoButton).toBeDisabled();
  });

  it("switches to the consumption log and shows date, wine, quantity, rating and note", async () => {
    setClock("2026-09-01T09:00:00Z");
    await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] }],
    });
    const lot = (await db.lots.toArray())[0]!;
    await consumeBottles({
      lotId: lot.id,
      quantity: 2,
      date: "2026-08-20",
      rating: 92,
      note: "Lovely with steak",
    });

    renderHistory();
    await userEvent.click(screen.getByRole("tab", { name: "Consumption log" }));

    const row = await screen.findByRole("row", { name: /Ridge 2019/ });
    expect(within(row).getByText("2 bottles")).toBeInTheDocument();
    expect(within(row).getByText("92/100")).toBeInTheDocument();
    expect(within(row).getByText("Lovely with steak")).toBeInTheDocument();
    expect(within(row).getByText(formatDate("2026-08-20"))).toBeInTheDocument();
  });

  it("restores a recently deleted wine", async () => {
    await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] }],
    });
    const wine = (await db.wines.toArray())[0]!;
    await deleteWine({ wineId: wine.id });

    renderHistory();
    await userEvent.click(screen.getByRole("tab", { name: "Recently deleted" }));

    const row = await findRowFor("Ridge 2019");
    await userEvent.click(within(row).getByRole("button", { name: "Restore" }));
    await screen.findByText(/Restored Ridge 2019/);
    await waitFor(async () => expect((await db.wines.get(wine.id))?.deletedAt).toBeNull());
  });

  it("deletes a wine forever after confirmation", async () => {
    await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] }],
    });
    const wine = (await db.wines.toArray())[0]!;
    await deleteWine({ wineId: wine.id });

    renderHistory();
    await userEvent.click(screen.getByRole("tab", { name: "Recently deleted" }));
    const row = await findRowFor("Ridge 2019");
    await userEvent.click(within(row).getByRole("button", { name: "Delete forever" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/removed for good/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete forever" }));
    await waitFor(async () => expect(await db.wines.get(wine.id)).toBeUndefined());
  });

  it("says when older changes were cleared, and keeps offering undo for the kept ones", async () => {
    setClock("2026-01-01T09:00:00Z");
    for (let i = 0; i < 3; i++) {
      await addBottles({
        drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 1 }] }],
      });
    }
    setClock("2026-09-28T09:00:00Z");
    await db.eventBatches.bulkAdd(
      Array.from({ length: HISTORY_KEEP_AT_LEAST }, (_, i) => ({
        id: `b${i}`,
        createdAt: `2026-09-${String(10 + (i % 18)).padStart(2, "0")}T09:00:00.000Z`,
        updatedAt: "2026-09-10T09:00:00.000Z",
        source: "user" as const,
        command: "test",
        summary: `Change ${i}`,
        changes: [],
        undoneAt: null,
        snapshotId: null,
      })),
    );
    expect(await pruneHistory()).toBe(3);

    renderHistory();
    expect(
      await screen.findByText(/Changes up to .* have been cleared and can no longer be undone/),
    ).toHaveTextContent(formatDate("2026-01-01T09:00:00Z"));
    const row = await findRowFor("Change 1");
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: "Undo" })).not.toBeDisabled(),
    );
  });

  it("does not offer undo of a change to a wine deleted forever", async () => {
    await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] }],
    });
    const wine = (await db.wines.toArray())[0]!;
    await deleteWine({ wineId: wine.id });
    await purgeDeleted({ wineId: wine.id });

    renderHistory();
    const addRow = await findRowFor("Added 3 bottles of a wine deleted forever");
    const undoButton = within(addRow).getByRole("button", { name: "Undo" });
    await waitFor(() =>
      expect(undoButton).toHaveAttribute("title", expect.stringContaining("deleted forever")),
    );
    expect(undoButton).toBeDisabled();
    expect(screen.queryByText(/Ridge 2019/)).not.toBeInTheDocument();
  });

  it("shows empty messages for each tab with nothing to show", async () => {
    renderHistory();
    expect(await screen.findByText(/No changes yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Consumption log" }));
    expect(await screen.findByText(/No drinks recorded yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Recently deleted" }));
    expect(await screen.findByText(/Nothing recently deleted/i)).toBeInTheDocument();
  });
});
