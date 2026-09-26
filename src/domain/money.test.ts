import { describe, expect, it } from "vitest";
import { formatMoney, sumByCurrency } from "./money";

describe("formatMoney", () => {
  it("uses the currency symbol from Intl", () => {
    expect(formatMoney(250, "USD", "en-US")).toBe("$250.00");
    expect(formatMoney(1234.5, "GBP", "en-GB")).toBe("£1,234.50");
  });

  it("falls back to plain text for a malformed currency code", () => {
    expect(formatMoney(12, "pounds", "en-GB")).toBe("12.00 pounds");
  });
});

describe("sumByCurrency", () => {
  it("returns separate totals per currency and never sums across currencies", () => {
    const totals = sumByCurrency([
      { amount: 50, currency: "GBP" },
      { amount: 250.1, currency: "USD" },
      { amount: 20.2, currency: "GBP" },
      { amount: 0.1, currency: "USD" },
    ]);
    expect(totals).toEqual([
      { currency: "USD", total: 250.2 },
      { currency: "GBP", total: 70.2 },
    ]);
  });

  it("skips amounts without a currency or price", () => {
    expect(
      sumByCurrency([
        { amount: 10, currency: null },
        { amount: null, currency: "EUR" },
      ]),
    ).toEqual([]);
  });
});
