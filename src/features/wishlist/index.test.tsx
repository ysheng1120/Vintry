import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { addWishlistItem } from "../../domain/commands/wishlist";
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

  it("marks an item as bought by opening the manual add form with its id", async () => {
    await addWishlistItem({ producer: "Salon", vintage: 2012 });
    renderWishlist();

    const card = (await screen.findByText("Salon 2012")).closest("li")!;
    const link = within(card).getByRole("link", { name: "Mark as bought" });
    const item = (await db.wishlist.toArray())[0]!;
    expect(link).toHaveAttribute("href", `/add/manual?fromWishlist=${item.id}`);
  });
});
