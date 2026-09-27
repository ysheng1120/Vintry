import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { addWishlistItem, updateWishlistItem } from "../../domain/commands/wishlist";
import { undoBatch } from "../../domain/undo";
import WishlistPage from "./index";

function renderWishlist() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <WishlistPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("WishlistPage", () => {
  beforeEach(resetDatabase);

  it("shows the empty state when nothing is on the list", async () => {
    renderWishlist();
    expect(await screen.findByText("Your wishlist is empty")).toBeInTheDocument();
  });

  it("adds an item by hand and shows it in the list", async () => {
    renderWishlist();
    await userEvent.click(await screen.findByRole("button", { name: "Add to wishlist" }));

    await userEvent.type(await screen.findByRole("textbox", { name: "Producer" }), "Krug");
    await userEvent.type(screen.getByRole("textbox", { name: "Wine" }), "Clos du Mesnil");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Vintage" }), "2008");
    await userEvent.type(screen.getByRole("textbox", { name: "Note" }), "Look for auction lots");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Krug Clos du Mesnil 2008")).toBeInTheDocument();
    expect(await db.wishlist.count()).toBe(1);
  });

  it("keeps a target price and shows it on the card", async () => {
    renderWishlist();
    await userEvent.click(await screen.findByRole("button", { name: "Add to wishlist" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Producer" }), "Salon");
    await userEvent.type(screen.getByRole("spinbutton", { name: /Target price/ }), "120");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Target .*120/)).toBeInTheDocument();
    const item = (await db.wishlist.toArray())[0]!;
    expect(item.targetPrice).toBe(120);
    expect(item.currency).toMatch(/^[A-Z]{3}$/);
  });

  it("edits an existing item", async () => {
    await addWishlistItem({ producer: "Salon", vintage: 2012, colour: "sparkling" });
    renderWishlist();

    const card = (await screen.findByText("Salon 2012")).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));

    const noteField = await screen.findByRole("textbox", { name: "Note" });
    await userEvent.type(noteField, "Birthday gift");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Salon 2012");
    expect((await db.wishlist.toArray())[0]?.notes).toBe("Birthday gift");
  });

  it("removes an item after confirming", async () => {
    await addWishlistItem({ producer: "Salon", vintage: 2012 });
    renderWishlist();

    const card = (await screen.findByText("Salon 2012")).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText("Salon 2012")).not.toBeInTheDocument());
    expect(await db.wishlist.count()).toBe(0);
  });

  it("shows the refusal reason when undoing a remove that's already been undone", async () => {
    await addWishlistItem({ producer: "Salon", vintage: 2012 });
    renderWishlist();

    const card = (await screen.findByText("Salon 2012")).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText("Salon 2012")).not.toBeInTheDocument());

    const batch = (await db.eventBatches.orderBy("createdAt").last())!;
    await undoBatch(batch.id); // undone from outside the toast, so the toast's own Undo now fails

    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Couldn't undo")).toBeInTheDocument();
    expect(await screen.findByText(/already been undone/)).toBeInTheDocument();
  });

  it("shows the refusal reason when undoing an edit blocked by a later change", async () => {
    const added = await addWishlistItem({ producer: "Salon", vintage: 2012 });
    renderWishlist();

    const card = (await screen.findByText("Salon 2012")).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Note" }), "Birthday gift");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Edited/);

    // A later change to the same item blocks undoing the edit above.
    const itemId = added.touched.wishlistIds[0]!;
    await updateWishlistItem({ itemId, patch: { notes: "Changed again" } });

    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Couldn't undo")).toBeInTheDocument();
    expect(await screen.findByText(/A later change touched/)).toBeInTheDocument();
  });

  it("marks an item as bought by opening the manual add form with its id", async () => {
    await addWishlistItem({ producer: "Salon", vintage: 2012 });
    renderWishlist();

    const card = (await screen.findByText("Salon 2012")).closest("li")!;
    const link = within(card).getByRole("link", { name: "Mark as bought" });
    const item = (await db.wishlist.toArray())[0]!;
    expect(link).toHaveAttribute("href", `/add/manual?fromWishlist=${item.id}`);
  });
});
