import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLiveQuery } from "dexie-react-hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import type { CommandResult } from "../../domain/commands";
import type { Wine, WinePriceCheck } from "../../domain/types";
import PriceSection from "./PriceSection";
import { SetValueSheet } from "./SetValueSheet";

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-10-01T12:00:00Z");
});

const BBR = "https://www.bbr.com/products-20191234-ridge-monte-bello-2019";

const listing = (value: number): WinePriceCheck["listings"][number] => ({
  amount: `£${value}.00`,
  value,
  currency: "GBP",
  merchant: "Berry Bros. & Rudd",
  unit: "bottle",
  sizeMl: 750,
  vintage: 2019,
  basis: "duty-paid retail",
  availability: "for sale",
  inRange: true,
  source: { url: BBR, title: "BBR" },
});

/** AE2: GBP £200, £225, £240 and a separate USD price. */
const PRICES: WinePriceCheck = {
  checkedFor: { producer: "Ridge", name: "Monte Bello", vintage: 2019, bottleSize: 750 },
  ranges: [
    { currency: "GBP", low: 200, middle: 225, high: 240, count: 3, usable: true },
    { currency: "USD", low: 310, middle: 310, high: 310, count: 1, usable: true },
  ],
  listings: [listing(200), listing(225), listing(240)],
  found: true,
  generatedAt: "2026-09-30T12:00:00.000Z",
  model: "claude-opus-5",
};

async function addWine(overrides: Partial<Wine> = {}): Promise<Wine> {
  const wine = makeWine({ priceCheck: PRICES, ...overrides });
  await db.wines.add(wine);
  return wine;
}

function LiveSection({ id }: { id: string }) {
  const wine = useLiveQuery(() => db.wines.get(id), [id]);
  return wine ? <PriceSection wine={wine} /> : null;
}

function renderSection(wine: Wine) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <LiveSection id={wine.id} />
    </ToastProvider>,
  );
  return user;
}

const SLOW = { timeout: 5000 };
const toasts = () => within(screen.getByRole("region", { name: "Notifications" }));

async function openGbpSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /^Use this price.*GBP/ }));
  return screen.getByRole("dialog", { name: "Set your value" });
}

describe("Use this price", () => {
  it("opens the value sheet with the GBP middle price and currency (AE2)", async () => {
    const wine = await addWine();
    const user = renderSection(wine);

    const sheet = await openGbpSheet(user);

    expect(within(sheet).getByLabelText("Value per bottle")).toHaveValue("225");
    expect(within(sheet).getByLabelText("Currency")).toHaveValue("GBP");
    expect(within(sheet).queryByText(/Replaces/)).not.toBeInTheDocument();
  });

  it("saves the value as the collector, and Undo restores the old value", async () => {
    const wine = await addWine({ valuePerBottle: 180, valueCurrency: "GBP" });
    const user = renderSection(wine);

    const sheet = await openGbpSheet(user);
    expect(within(sheet).getByText("Replaces £180")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Save value" }));

    expect(await toasts().findByText(/^Edited Ridge Monte Bello 2019/, {}, SLOW)).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Set your value" })).not.toBeInTheDocument(),
    );
    expect(await db.wines.get(wine.id)).toMatchObject({
      valuePerBottle: 225,
      valueCurrency: "GBP",
    });
    const batches = await db.eventBatches.toArray();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ source: "user", command: "updateWine" });

    await user.click(toasts().getByRole("button", { name: "Undo" }));

    await waitFor(async () =>
      expect(await db.wines.get(wine.id)).toMatchObject({
        valuePerBottle: 180,
        valueCurrency: "GBP",
      }),
    );
  });

  it("lets the collector change the amount and currency before saving", async () => {
    const wine = await addWine();
    const user = renderSection(wine);

    const sheet = await openGbpSheet(user);
    const amount = within(sheet).getByLabelText("Value per bottle");
    await user.clear(amount);
    await user.type(amount, "210");
    await user.click(within(sheet).getByRole("button", { name: "Save value" }));

    await waitFor(async () =>
      expect(await db.wines.get(wine.id)).toMatchObject({
        valuePerBottle: 210,
        valueCurrency: "GBP",
      }),
    );
  });

  it("Cancel leaves the value unchanged", async () => {
    const wine = await addWine({ valuePerBottle: 180, valueCurrency: "GBP" });
    const user = renderSection(wine);

    const sheet = await openGbpSheet(user);
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Set your value" })).not.toBeInTheDocument();
    expect(await db.wines.get(wine.id)).toMatchObject({
      valuePerBottle: 180,
      valueCurrency: "GBP",
    });
    expect(await db.eventBatches.count()).toBe(0);
  });

  it("shows no Use this price on a sample wine, with its reason", async () => {
    const wine = await addWine({ isSample: true });
    renderSection(wine);

    expect(await screen.findByText("GBP £200 to £240, middle £225 (3 prices)")).toBeInTheDocument();
    expect(
      screen.getAllByText("Sample wine. Prices can't be used as a value.").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Use this price/ })).not.toBeInTheDocument();
  });

  it("shows no Use this price on an out-of-date result", async () => {
    const wine = await addWine({ vintage: 2018 });
    renderSection(wine);

    expect(await screen.findByText(/Checked for 2019; this wine is now 2018/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Use this price/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Prices can't be used/)).not.toBeInTheDocument();
  });

  it("never changes the value without the sheet", async () => {
    const wine = await addWine();
    renderSection(wine);

    expect(await screen.findByText(/^GBP £200 to £240/)).toBeInTheDocument();
    expect(await db.wines.get(wine.id)).toMatchObject({
      valuePerBottle: null,
      valueCurrency: null,
    });
    expect(await db.eventBatches.count()).toBe(0);
  });
});

describe("SetValueSheet", () => {
  function renderSheet(wine: Wine, amount: number, currency: string) {
    const onDone = vi.fn<(result: CommandResult | null) => void>();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SetValueSheet
        wine={wine}
        amount={amount}
        currency={currency}
        onClose={onClose}
        onDone={onDone}
      />,
    );
    return { user, onDone, onClose };
  }

  it("closes without a change when the value is the same as now", async () => {
    const wine = await addWine({ valuePerBottle: 225, valueCurrency: "GBP" });
    const { user, onDone } = renderSheet(wine, 225, "GBP");

    expect(screen.getByText("Replaces £225")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save value" }));

    expect(onDone).toHaveBeenCalledWith(null);
    expect(await db.eventBatches.count()).toBe(0);
  });

  it("checks the amount and currency before saving", async () => {
    const wine = await addWine();
    const { user, onDone } = renderSheet(wine, 225, "GBP");

    const amount = screen.getByLabelText("Value per bottle");
    await user.clear(amount);
    await user.type(amount, "abc");
    await user.click(screen.getByRole("button", { name: "Save value" }));

    expect(await screen.findByText("Enter an amount like 120")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect((await db.wines.get(wine.id))?.valuePerBottle).toBeNull();
  });

  it("Cancel calls onClose and saves nothing", async () => {
    const wine = await addWine();
    const { user, onClose, onDone } = renderSheet(wine, 225, "GBP");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(await db.eventBatches.count()).toBe(0);
  });
});
