import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { restoreBackup } from "../../db/backup";
import { db } from "../../db/db";
import { CURRENT_SCHEMA_VERSION } from "../../db/migrations";
import { makeWine, resetDatabase } from "../../db/testing";
import { addBottles } from "../../domain/commands/wines";
import { HistoryRow } from "./HistoryRow";

// Lets one test make undoBatch throw; every other call goes to the real one.
const failure = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("../../domain/undo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../domain/undo")>();
  return {
    ...actual,
    undoBatch: (batchId: string) =>
      failure.error ? Promise.reject(failure.error) : actual.undoBatch(batchId),
  };
});

async function renderRow(batchId: string) {
  const batch = (await db.eventBatches.get(batchId))!;
  render(
    <ToastProvider>
      <ul>
        <HistoryRow batch={batch} check={{ ok: true }} />
      </ul>
    </ToastProvider>,
  );
}

describe("HistoryRow", () => {
  beforeEach(resetDatabase);
  afterEach(() => {
    failure.error = null;
  });

  it("toasts the reason when the undo is refused", async () => {
    await db.wines.add(makeWine());
    const { batchId, snapshotId } = await restoreBackup({
      app: "vintry",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        wines: [],
        lots: [],
        consumptions: [],
        tastingNotes: [],
        locations: [],
        wishlist: [],
        eventBatches: [],
        chatThreads: [],
        chatMessages: [],
        settings: [],
      },
    });
    await db.snapshots.delete(snapshotId);
    await renderRow(batchId);

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Can't undo that change")).toBeInTheDocument();
    expect(
      screen.getByText("The safety copy for this change is no longer available."),
    ).toBeInTheDocument();
  });

  it("toasts a plain message when the undo fails unexpectedly, and frees the button", async () => {
    const added = await addBottles({
      drafts: [{ producer: "Ridge", vintage: 2019, colour: "red", lots: [{ quantity: 3 }] }],
    });
    await renderRow(added.batchId!);
    failure.error = new Error("DatabaseClosedError: internal detail");

    const button = screen.getByRole("button", { name: "Undo" });
    await userEvent.click(button);
    expect(await screen.findByText("Can't undo that change")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument();
    expect(button).toBeEnabled();
  });
});
