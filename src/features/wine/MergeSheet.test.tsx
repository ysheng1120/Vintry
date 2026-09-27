import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeLot, makeWine, resetDatabase } from "../../db/testing";
import { addTastingNote } from "../../domain/commands";
import { MergeSheet } from "./MergeSheet";

beforeEach(resetDatabase);

function renderSheet(wine: Parameters<typeof MergeSheet>[0]["wine"], onClose = () => {}) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <MergeSheet wine={wine} onClose={onClose} />
    </ToastProvider>,
  );
  return user;
}

const notifications = () => screen.getByRole("region", { name: "Notifications" });

describe("MergeSheet", () => {
  it("suggests a same producer and vintage wine first, shows what moves, and merges on confirm", async () => {
    const keep = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    const duplicate = makeWine({ producer: "Ridge", name: "Monte Bello Estate", vintage: 2019 });
    const other = makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null });
    await db.wines.bulkAdd([keep, duplicate, other]);
    await db.lots.bulkAdd([makeLot({ wineId: duplicate.id, quantity: 3 })]);
    await addTastingNote({ wineId: duplicate.id, text: "Cassis, graphite" });

    const user = renderSheet(keep);

    const dialog = await screen.findByRole("dialog", { name: "Merge with another wine" });
    expect(await within(dialog).findByText("Likely duplicates")).toBeInTheDocument();
    const likelyRow = within(dialog).getByRole("button", { name: "Ridge Monte Bello Estate 2019" });
    expect(within(dialog).getByText("Other wines")).toBeInTheDocument();

    await user.click(likelyRow);
    expect(
      await within(dialog).findByText(
        /The 3 bottles, 1 note and 0 drinks of Ridge Monte Bello Estate 2019 move to this wine\./,
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Merge wines" }));

    await waitFor(async () =>
      expect(await db.lots.where("wineId").equals(keep.id).count()).toBe(1),
    );
    expect((await db.wines.get(duplicate.id))?.deletedAt).toBeTruthy();
    expect(
      await within(notifications()).findByText(/Merged 2 wines: Ridge Monte Bello 2019/),
    ).toBeInTheDocument();
  });

  it("filters the list by search text", async () => {
    const keep = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    const krug = makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null });
    const drc = makeWine({ producer: "DRC", name: "La Tâche", vintage: 2015 });
    await db.wines.bulkAdd([keep, krug, drc]);

    const user = renderSheet(keep);
    const dialog = await screen.findByRole("dialog", { name: "Merge with another wine" });
    await within(dialog).findByRole("button", { name: /La Tâche/ });

    await user.type(within(dialog).getByLabelText("Find the duplicate"), "krug");
    expect(
      within(dialog).getByRole("button", { name: "Krug Grande Cuvée NV" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /La Tâche/ })).not.toBeInTheDocument();
  });

  it("requires a wine to be chosen before merging", async () => {
    const keep = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    const other = makeWine({ producer: "Krug", name: "Grande Cuvée", vintage: null });
    await db.wines.bulkAdd([keep, other]);

    const user = renderSheet(keep);
    const dialog = await screen.findByRole("dialog", { name: "Merge with another wine" });
    await user.click(within(dialog).getByRole("button", { name: "Merge wines" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Choose a wine/);
    expect(await db.wines.count()).toBe(2);
  });

  it("never offers a sample wine as a match for a real wine", async () => {
    const keep = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    const sample = makeWine({ producer: "Sample House", isSample: true });
    await db.wines.bulkAdd([keep, sample]);

    renderSheet(keep);
    const dialog = await screen.findByRole("dialog", { name: "Merge with another wine" });
    expect(
      await within(dialog).findByText("There's no other wine in your cellar yet."),
    ).toBeInTheDocument();
  });
});
