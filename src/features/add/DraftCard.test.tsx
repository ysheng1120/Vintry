import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeLocation, makeWine, resetDatabase } from "../../db/testing";
import type { CommandResult } from "../../domain/commands";
import { DraftCard } from "./DraftCard";
import type { BottleDraft } from "./draft";

beforeEach(resetDatabase);

async function renderCard(drafts: BottleDraft[]) {
  const onSaved = vi.fn<(result: CommandResult) => void>();
  const onCancel = vi.fn();
  render(
    <MemoryRouter>
      <ToastProvider>
        <DraftCard drafts={drafts} source="ai-describe" onSaved={onSaved} onCancel={onCancel} />
      </ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Cancel" });
  return { onSaved, onCancel, user: userEvent.setup() };
}

describe("DraftCard", () => {
  it("shows hints, highlights low-confidence fields, and saves with the given source", async () => {
    const { onSaved, user } = await renderCard([
      {
        producer: "Ridge",
        name: "Monte Bello",
        vintage: 2019,
        colour: "red",
        lots: [{ quantity: 6, pricePerBottle: 250, currency: "USD", store: "K&L" }],
        notes: ["Store read from the sentence"],
        lowConfidence: ["vintage"],
      },
    ]);
    expect(screen.getByText("Store read from the sentence")).toBeInTheDocument();
    expect(screen.getByLabelText(/Vintage/)).toHaveAccessibleDescription(/Please check/);

    await user.click(screen.getByRole("button", { name: "Add 6 bottles" }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0]?.[0].summary).toBe("Added 6 bottles of Ridge Monte Bello 2019");
    const batch = await db.eventBatches.toCollection().first();
    expect(batch?.source).toBe("ai-describe");
    const [lot] = await db.lots.toArray();
    expect(lot).toMatchObject({ quantity: 6, pricePerBottle: 250, currency: "USD", store: "K&L" });
  });

  it("asks for the price basis when unclear and converts a total to a price per bottle", async () => {
    const { onSaved, user } = await renderCard([
      {
        producer: "Ridge",
        vintage: 2019,
        priceBasis: "unclear",
        lots: [{ quantity: 6, totalPrice: 1500, currency: "USD" }],
      },
    ]);
    await user.click(screen.getByRole("button", { name: "Add 6 bottles" }));
    expect(await screen.findByText(/Choose Per bottle or For all bottles/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: "For all bottles" }));
    expect(screen.getByLabelText(/Price/)).toHaveValue("1500");
    await user.click(screen.getByRole("radio", { name: "Per bottle" }));
    expect(screen.getByLabelText(/Price/)).toHaveValue("250");
    await user.click(screen.getByRole("button", { name: "Add 6 bottles" }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [lot] = await db.lots.toArray();
    expect(lot?.pricePerBottle).toBe(250);
  });

  it("adds lots to the wine named by wineId and matches a location by name", async () => {
    const wine = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    const rack = makeLocation({ name: "Kitchen rack" });
    await db.wines.add(wine);
    await db.locations.add(rack);
    const { onSaved, user } = await renderCard([
      { wineId: wine.id, lots: [{ quantity: 2, locationName: "kitchen rack" }] },
    ]);
    expect(await screen.findByText(/Add to existing wine/)).toHaveTextContent(
      "Ridge Monte Bello 2019",
    );
    await user.click(screen.getByRole("button", { name: "Add 2 bottles" }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(await db.locations.count()).toBe(1);
    const [lot] = await db.lots.toArray();
    expect(lot).toMatchObject({ wineId: wine.id, locationId: rack.id, quantity: 2 });
  });

  it("cancels without writing", async () => {
    const { onCancel, user } = await renderCard([{ lots: [{ quantity: 1 }] }]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(await db.eventBatches.count()).toBe(0);
  });
});
