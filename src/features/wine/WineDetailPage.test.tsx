import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { currentYear } from "../../domain/clock";
import { renderCellarApp } from "../cellar/testing";

beforeEach(resetDatabase);

async function seedWine(quantity: number) {
  const rack = makeLocation({ name: "Kitchen rack" });
  const wine = makeWine({
    producer: "Ridge",
    name: "Monte Bello",
    vintage: 2019,
    region: "Santa Cruz Mountains",
    country: "USA",
    grapes: ["Cabernet Sauvignon", "Merlot"],
    windowFrom: currentYear() - 1,
    windowTo: currentYear() + 15,
    windowSource: "ai",
  });
  const lot = makeLot({
    wineId: wine.id,
    locationId: rack.id,
    quantity,
    bin: "A1",
    pricePerBottle: 250,
    currency: "USD",
    store: "K&L",
  });
  await db.locations.add(rack);
  await db.wines.add(wine);
  await db.lots.add(lot);
  return { wine, lot, rack };
}

async function openWine(id: string) {
  const app = renderCellarApp(`/wine/${id}`);
  await screen.findByRole("heading", { level: 1, name: "Ridge Monte Bello 2019" });
  return app;
}

const notifications = () => screen.getByRole("region", { name: "Notifications" });

const lotRows = () =>
  within(screen.getByRole("list", { name: "Bottles by location" })).getAllByRole("listitem");

describe("Wine detail", () => {
  it("shows the header, window with its source, lots, and actions", async () => {
    const { wine } = await seedWine(6);
    await openWine(wine.id);
    expect(screen.getByText("Santa Cruz Mountains, USA")).toBeInTheDocument();
    expect(screen.getByText("Cabernet Sauvignon, Merlot")).toBeInTheDocument();
    expect(screen.getByText("AI estimate")).toBeInTheDocument();
    expect(lotRows()).toHaveLength(1);
    expect(lotRows()[0]).toHaveTextContent(/Bin A1/);
    expect(lotRows()[0]).toHaveTextContent(/\$250\.00/);
    expect(screen.getByRole("link", { name: /Ask sommelier/ })).toHaveAttribute(
      "href",
      `/sommelier?wine=${wine.id}`,
    );
  });

  it("drinking the last bottle moves the wine to the Drunk filter and records it", async () => {
    const { wine } = await seedWine(1);
    const { user, router } = await openWine(wine.id);
    await user.click(screen.getByRole("button", { name: "Drink" }));
    const sheet = screen.getByRole("dialog", { name: "Drink a bottle" });
    await user.type(within(sheet).getByLabelText("Occasion"), "Birthday");
    await user.type(within(sheet).getByLabelText("Tasting note"), "Silky, cassis");
    await user.click(within(sheet).getByRole("button", { name: "Record drink" }));

    expect(
      await within(notifications()).findByText("Drank 1 bottle of Ridge Monte Bello 2019"),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Silky, cassis")).toBeInTheDocument();
    expect(screen.getByText(/Birthday/)).toBeInTheDocument();
    expect(await db.consumptions.count()).toBe(1);

    await router.navigate("/cellar");
    expect(await screen.findByText("No bottles left")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Monte Bello/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Drunk/ }));
    expect(await screen.findByRole("link", { name: /Monte Bello/ })).toBeInTheDocument();

    const [batch] = await db.eventBatches.toArray();
    expect(batch?.summary).toBe("Drank 1 bottle of Ridge Monte Bello 2019");
  });

  it("moving 2 of 6 bottles to a new location shows two lots, and Undo restores one lot of 6", async () => {
    const { wine } = await seedWine(6);
    const { user } = await openWine(wine.id);
    await user.click(screen.getByRole("button", { name: "Move" }));
    const sheet = screen.getByRole("dialog", { name: "Move bottles" });
    const quantity = within(sheet).getByLabelText("How many");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.tab();
    await user.selectOptions(within(sheet).getByLabelText("To"), "New location…");
    await user.type(within(sheet).getByLabelText("New location name"), "Wine fridge");
    await user.click(within(sheet).getByRole("button", { name: "Move 2 bottles" }));

    await waitFor(() => expect(lotRows()).toHaveLength(2));
    expect(screen.getByText("Wine fridge")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(lotRows()).toHaveLength(1));
    expect(lotRows()[0]).toHaveTextContent(/6 bottles/);
    const open = (await db.lots.toArray()).filter((l) => l.quantity > 0);
    expect(open.map((l) => l.quantity)).toEqual([6]);
  });

  it("deleting a wine hides it with an Undo toast, and Undo brings it back", async () => {
    const { wine } = await seedWine(6);
    const { user } = await openWine(wine.id);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete wine" }),
    );

    await screen.findByRole("heading", { level: 1, name: "Cellar" });
    expect(await screen.findByText("Deleted Ridge Monte Bello 2019")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Monte Bello/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("link", { name: /Monte Bello/ })).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.deletedAt).toBeNull();
  });

  it("edits the wine and sets the window as the user's", async () => {
    const { wine } = await seedWine(6);
    const { user } = await openWine(wine.id);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const edit = screen.getByRole("dialog", { name: "Edit wine" });
    const name = within(edit).getByLabelText("Wine name");
    await user.clear(name);
    await user.type(name, "Monte Bello Estate");
    await user.click(within(edit).getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { level: 1, name: "Ridge Monte Bello Estate 2019" });

    await user.click(screen.getByRole("button", { name: "Edit window" }));
    const windowSheet = screen.getByRole("dialog", { name: "Drinking window" });
    const to = within(windowSheet).getByLabelText("Drink to");
    await user.clear(to);
    await user.type(to, "2040");
    await user.click(within(windowSheet).getByRole("button", { name: "Save window" }));
    expect(await screen.findByText("Your window")).toBeInTheDocument();
    expect(await db.wines.get(wine.id)).toMatchObject({ windowTo: 2040, windowSource: "user" });
  });

  it("adds a tasting note", async () => {
    const { wine } = await seedWine(6);
    const { user } = await openWine(wine.id);
    await user.click(screen.getByRole("button", { name: "Add note" }));
    const sheet = screen.getByRole("dialog", { name: "Add a tasting note" });
    await user.type(within(sheet).getByLabelText("Note"), "Still tight, decant");
    await user.click(within(sheet).getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Still tight, decant")).toBeInTheDocument();
  });

  it("shows a not-found state for a missing or deleted wine", async () => {
    renderCellarApp("/wine/nope");
    expect(await screen.findByText("This wine isn't in your cellar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the cellar" })).toHaveAttribute(
      "href",
      "/cellar",
    );
  });
});
