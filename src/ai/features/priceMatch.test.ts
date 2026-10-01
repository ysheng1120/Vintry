import { describe, expect, it } from "vitest";
import {
  buildRanges,
  findPrices,
  isIsoCurrency,
  parsePrice,
  priceAppearsIn,
  resolveCurrency,
} from "./priceMatch";

const RIDGE = "Ridge Monte Bello 2019 £225.00 per bottle";

describe("parsePrice", () => {
  it.each([
    ["£225.00", 225, "GBP"],
    ["£1,250", 1250, "GBP"],
    ["€1,250", 1250, "EUR"],
    ["1.250,00 €", 1250, "EUR"],
    ["1\u00a0250,50 EUR", 1250.5, "EUR"],
    ["EUR 99,5", 99.5, "EUR"],
    ["CHF 480", 480, "CHF"],
    ["480.00 CHF", 480, "CHF"],
    ["USD 310", 310, "USD"],
    ["310 usd", 310, "USD"],
    ["US$310", 310, "USD"],
    ["A$310", 310, "AUD"],
    ["C$310", 310, "CAD"],
    ["HK$2,400", 2400, "HKD"],
    ["NZ$99", 99, "NZD"],
    ["S$150", 150, "SGD"],
    ["$310", 310, "$"],
    ["¥45,000", 45000, "¥"],
    ["JPY 45000", 45000, "JPY"],
    ["£1,234,567.89", 1234567.89, "GBP"],
    ["£225.5", 225.5, "GBP"],
    ["£0,50", 0.5, "GBP"],
  ])("parses %s", (text, amount, currency) => {
    expect(parsePrice(text)).toEqual({ amount, currency });
  });

  it("reads Swiss apostrophe thousands", () => {
    expect(parsePrice("CHF 1'250.00")).toEqual({ amount: 1250, currency: "CHF" });
  });

  it.each(["", "no price here", "2019", "225", "£", "$ per bottle", "XYZ 225", "MX$225", "£-5"])(
    "returns null for %j",
    (text) => {
      expect(parsePrice(text)).toBeNull();
    },
  );

  it("does not take a vintage as an amount", () => {
    expect(parsePrice("2019 £225.00")).toEqual({ amount: 225, currency: "GBP" });
  });
});

describe("findPrices", () => {
  it("returns every price with a currency mark, in order", () => {
    expect(findPrices("Was £250.00, now £225.00 (about $290)")).toEqual([
      { amount: 250, currency: "GBP" },
      { amount: 225, currency: "GBP" },
      { amount: 290, currency: "$" },
    ]);
  });

  it("ignores numbers with no currency mark", () => {
    expect(findPrices("Ridge Monte Bello 2019, 750ml, 94 points")).toEqual([]);
  });

  it("does not read a bare dollar out of a prefixed dollar", () => {
    expect(findPrices("HK$310")).toEqual([{ amount: 310, currency: "HKD" }]);
    expect(findPrices("MX$310")).toEqual([]);
  });

  it("keeps a thousands figure in one piece", () => {
    expect(findPrices("$2,500")).toEqual([{ amount: 2500, currency: "$" }]);
    expect(findPrices("£1,250")).toEqual([{ amount: 1250, currency: "GBP" }]);
  });
});

describe("isIsoCurrency", () => {
  it("is true for ISO codes and false for bare symbols", () => {
    expect(isIsoCurrency("GBP")).toBe(true);
    expect(isIsoCurrency("USD")).toBe(true);
    expect(isIsoCurrency("$")).toBe(false);
    expect(isIsoCurrency("¥")).toBe(false);
    expect(isIsoCurrency("gbp")).toBe(false);
  });
});

describe("resolveCurrency", () => {
  it("resolves a bare $ to USD only when the site declares USD", () => {
    expect(resolveCurrency("$", "$310", { siteDollar: "USD" })).toBe("USD");
    expect(resolveCurrency("$", "$310", { siteDollar: null })).toBe("$");
    expect(resolveCurrency("$", "$310")).toBe("$");
  });

  it("resolves a bare $ to USD when the quote shows US$", () => {
    expect(resolveCurrency("$", "US$310 or $305")).toBe("USD");
  });

  it("does not resolve a bare $ because the quote shows another dollar", () => {
    expect(resolveCurrency("$", "HK$310 or $305")).toBe("$");
  });

  it("never turns a site declaring another currency into USD", () => {
    expect(resolveCurrency("$", "$310", { siteDollar: "CAD" })).toBe("$");
  });

  it("leaves ISO codes and other symbols alone", () => {
    expect(resolveCurrency("GBP", "", { siteDollar: "USD" })).toBe("GBP");
    expect(resolveCurrency("¥", "", { siteDollar: "USD" })).toBe("¥");
  });

  it("normalises symbols and case", () => {
    expect(resolveCurrency("£")).toBe("GBP");
    expect(resolveCurrency("€")).toBe("EUR");
    expect(resolveCurrency("usd")).toBe("USD");
    expect(resolveCurrency("US$")).toBe("USD");
    expect(resolveCurrency("HK$")).toBe("HKD");
  });
});

describe("priceAppearsIn", () => {
  it("AE1: £225.00 matches the Ridge quote; £250 does not", () => {
    expect(priceAppearsIn({ amount: 225, currency: "GBP" }, RIDGE)).toBe(true);
    expect(priceAppearsIn({ amount: 250, currency: "GBP" }, RIDGE)).toBe(false);
  });

  it("accepts the currency as written, symbol or code", () => {
    expect(priceAppearsIn({ amount: 225, currency: "£" }, RIDGE)).toBe(true);
    expect(priceAppearsIn({ amount: 225, currency: "gbp" }, RIDGE)).toBe(true);
  });

  it.each(["£1,250", "$2,500", "£2501", "£1250.50", "£12,250"])(
    "250 does not match inside %s",
    (shown) => {
      expect(priceAppearsIn({ amount: 250, currency: "GBP" }, `Now ${shown} a bottle`)).toBe(false);
      expect(priceAppearsIn({ amount: 250, currency: "USD" }, `Now ${shown} a bottle`)).toBe(false);
      expect(priceAppearsIn({ amount: 250, currency: "$" }, `Now ${shown} a bottle`)).toBe(false);
    },
  );

  it("matches a whole amount, not a prefix of a decimal", () => {
    expect(priceAppearsIn({ amount: 225, currency: "GBP" }, "£225.50")).toBe(false);
    expect(priceAppearsIn({ amount: 225.5, currency: "GBP" }, "£225.50")).toBe(true);
  });

  it("matches 1250 EUR in both European and English formats", () => {
    expect(priceAppearsIn({ amount: 1250, currency: "EUR" }, "1.250,00 € la bouteille")).toBe(true);
    expect(priceAppearsIn({ amount: 1250, currency: "EUR" }, "Now €1,250")).toBe(true);
    expect(priceAppearsIn({ amount: 250, currency: "EUR" }, "1.250,00 € la bouteille")).toBe(false);
  });

  it("does not match a USD price against a quote that shows only £", () => {
    expect(priceAppearsIn({ amount: 225, currency: "USD" }, RIDGE)).toBe(false);
    expect(priceAppearsIn({ amount: 225, currency: "$" }, RIDGE)).toBe(false);
  });

  it("does not match the same amount in a different currency", () => {
    expect(priceAppearsIn({ amount: 225, currency: "EUR" }, RIDGE)).toBe(false);
  });

  it("matches a mark after the amount and an ISO code", () => {
    expect(priceAppearsIn({ amount: 225, currency: "GBP" }, "Ridge 2019, 225 GBP")).toBe(true);
    expect(priceAppearsIn({ amount: 225, currency: "GBP" }, "Ridge 2019 GBP 225.00")).toBe(true);
  });

  it("does not take the mark of the next price for the vintage", () => {
    expect(priceAppearsIn({ amount: 2019, currency: "GBP" }, RIDGE)).toBe(false);
  });

  it("finds the price among several", () => {
    const quote = "Was £250.00, now £225.00";
    expect(priceAppearsIn({ amount: 250, currency: "GBP" }, quote)).toBe(true);
    expect(priceAppearsIn({ amount: 225, currency: "GBP" }, quote)).toBe(true);
    expect(priceAppearsIn({ amount: 200, currency: "GBP" }, quote)).toBe(false);
  });

  describe("dollars", () => {
    it("$310 from a USD site resolves to USD and matches", () => {
      const ctx = { siteDollar: "USD" };
      expect(priceAppearsIn({ amount: 310, currency: "$" }, "Now $310 a bottle", ctx)).toBe(true);
      expect(priceAppearsIn({ amount: 310, currency: "USD" }, "Now $310 a bottle", ctx)).toBe(true);
    });

    it("$310 from a site with no declared dollar stays a $ group", () => {
      expect(priceAppearsIn({ amount: 310, currency: "$" }, "Now $310 a bottle")).toBe(true);
      expect(priceAppearsIn({ amount: 310, currency: "USD" }, "Now $310 a bottle")).toBe(false);
      expect(
        priceAppearsIn({ amount: 310, currency: "USD" }, "Now $310 a bottle", { siteDollar: null }),
      ).toBe(false);
    });

    it("a US$ quote matches both USD and a bare $ claim", () => {
      expect(priceAppearsIn({ amount: 310, currency: "USD" }, "Now US$310")).toBe(true);
      expect(priceAppearsIn({ amount: 310, currency: "$" }, "Now US$310")).toBe(true);
    });

    it("a USD code in the quote matches a USD claim", () => {
      expect(priceAppearsIn({ amount: 310, currency: "USD" }, "USD 310")).toBe(true);
    });

    it.each(["A$", "C$", "HK$", "NZ$", "S$"])("%s310 never matches $ or USD", (prefix) => {
      const quote = `Now ${prefix}310 a bottle`;
      const ctx = { siteDollar: "USD" };
      expect(priceAppearsIn({ amount: 310, currency: "$" }, quote, ctx)).toBe(false);
      expect(priceAppearsIn({ amount: 310, currency: "USD" }, quote, ctx)).toBe(false);
      expect(priceAppearsIn({ amount: 310, currency: "$" }, quote)).toBe(false);
    });

    it("HK$310 matches HKD and nothing else", () => {
      expect(priceAppearsIn({ amount: 310, currency: "HKD" }, "HK$310")).toBe(true);
      expect(priceAppearsIn({ amount: 310, currency: "AUD" }, "HK$310")).toBe(false);
    });

    it("a quote showing both US$ and HK$ only resolves the bare $ to USD", () => {
      expect(priceAppearsIn({ amount: 305, currency: "USD" }, "US$310 or $305")).toBe(true);
      expect(priceAppearsIn({ amount: 305, currency: "USD" }, "HK$310 or $305")).toBe(false);
    });

    it("a site declaring another currency does not make $ into USD", () => {
      expect(priceAppearsIn({ amount: 310, currency: "USD" }, "$310", { siteDollar: "CAD" })).toBe(
        false,
      );
    });
  });

  it("matches a yen sign only against a yen claim", () => {
    expect(priceAppearsIn({ amount: 45000, currency: "¥" }, "¥45,000")).toBe(true);
    expect(priceAppearsIn({ amount: 45000, currency: "JPY" }, "¥45,000")).toBe(false);
    expect(priceAppearsIn({ amount: 45000, currency: "CNY" }, "¥45,000")).toBe(false);
  });

  it("is false for an empty quote, an unknown currency, or a bad amount", () => {
    expect(priceAppearsIn({ amount: 225, currency: "GBP" }, "")).toBe(false);
    expect(priceAppearsIn({ amount: 225, currency: "ZZZ" }, "ZZZ 225")).toBe(false);
    expect(priceAppearsIn({ amount: Number.NaN, currency: "GBP" }, "£NaN")).toBe(false);
    expect(priceAppearsIn({ amount: -225, currency: "GBP" }, "£-225")).toBe(false);
    expect(priceAppearsIn({ amount: 0, currency: "GBP" }, "£0")).toBe(false);
  });
});

describe("buildRanges", () => {
  it("AE2: GBP 200, 225, 240 and a USD range of one price", () => {
    const usd = resolveCurrency("$", "$310", { siteDollar: "USD" });
    expect(
      buildRanges([
        { amount: 200, currency: "GBP" },
        { amount: 225, currency: "GBP" },
        { amount: 240, currency: "GBP" },
        { amount: 310, currency: usd },
      ]),
    ).toEqual([
      { currency: "GBP", low: 200, middle: 225, high: 240, count: 3 },
      { currency: "USD", low: 310, middle: 310, high: 310, count: 1 },
    ]);
  });

  it("takes the median of the middle two for an even count", () => {
    expect(
      buildRanges([
        { amount: 100, currency: "EUR" },
        { amount: 300, currency: "EUR" },
        { amount: 200, currency: "EUR" },
        { amount: 400, currency: "EUR" },
      ]),
    ).toEqual([{ currency: "EUR", low: 100, middle: 250, high: 400, count: 4 }]);
  });

  it("does not depend on input order", () => {
    const a = buildRanges([
      { amount: 240, currency: "GBP" },
      { amount: 200, currency: "GBP" },
      { amount: 225, currency: "GBP" },
    ]);
    expect(a[0]).toMatchObject({ low: 200, middle: 225, high: 240 });
  });

  it("rounds a median to cents", () => {
    expect(
      buildRanges([
        { amount: 10.01, currency: "GBP" },
        { amount: 10.02, currency: "GBP" },
      ])[0]?.middle,
    ).toBe(10.02);
  });

  it("keeps a bare $ group apart from USD and never merges currencies", () => {
    const ranges = buildRanges([
      { amount: 310, currency: "$" },
      { amount: 300, currency: "USD" },
      { amount: 45000, currency: "¥" },
    ]);
    expect(ranges.map((r) => r.currency).sort()).toEqual(["$", "USD", "¥"]);
    expect(ranges.every((r) => r.count === 1)).toBe(true);
  });

  it("orders groups by price count, then currency code", () => {
    const ranges = buildRanges([
      { amount: 1, currency: "USD" },
      { amount: 2, currency: "EUR" },
      { amount: 3, currency: "EUR" },
      { amount: 4, currency: "CHF" },
    ]);
    expect(ranges.map((r) => r.currency)).toEqual(["EUR", "CHF", "USD"]);
  });

  it("skips non-finite and non-positive amounts", () => {
    expect(
      buildRanges([
        { amount: Number.NaN, currency: "GBP" },
        { amount: Number.POSITIVE_INFINITY, currency: "GBP" },
        { amount: 0, currency: "GBP" },
        { amount: -5, currency: "GBP" },
        { amount: 225, currency: "GBP" },
      ]),
    ).toEqual([{ currency: "GBP", low: 225, middle: 225, high: 225, count: 1 }]);
  });

  it("returns nothing for no prices", () => {
    expect(buildRanges([])).toEqual([]);
  });
});
