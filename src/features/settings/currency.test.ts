import { describe, expect, it } from "vitest";
import { COMMON_CURRENCIES, currencyForLocale } from "./currency";

describe("currencyForLocale", () => {
  it("picks the currency of the locale's region", () => {
    expect(currencyForLocale("en-US")).toBe("USD");
    expect(currencyForLocale("en-GB")).toBe("GBP");
    expect(currencyForLocale("de-DE")).toBe("EUR");
    expect(currencyForLocale("fr-CH")).toBe("CHF");
    expect(currencyForLocale("ja")).toBe("JPY");
  });

  it("falls back to USD for an unknown region", () => {
    expect(currencyForLocale("xx")).toBe("USD");
    expect(currencyForLocale("en-AQ")).toBe("USD");
  });

  it("only returns currencies offered in the list", () => {
    for (const locale of ["en-US", "en-GB", "de-DE", "fr-CH", "ja", "sv-SE", "pt-BR"]) {
      expect(COMMON_CURRENCIES.map((c) => c.code)).toContain(currencyForLocale(locale));
    }
  });
});
