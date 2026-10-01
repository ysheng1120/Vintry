/**
 * Price matching for "Check price": parses prices out of text, decides whether a price that
 * Claude reported really appears in a quote cited from the page, and builds the per-currency
 * ranges. Pure functions only. Amounts are matched as whole numbers ("250" never matches inside
 * "1,250" or "$2,500") and a currency is never converted into another (R3, R5, KTD2).
 *
 * A currency is an ISO code ("GBP"), or, when the mark does not say which currency it is, the
 * bare symbol itself: "$" and "¥" (many currencies share them). A bare "$" becomes USD only
 * when the caller says the source site declares USD, or the quote shows "US$" (KTD7).
 */

export interface Price {
  amount: number;
  /** An ISO code, or "$" / "¥" when the mark is ambiguous. */
  currency: string;
}

export interface CurrencyRange {
  currency: string;
  low: number;
  /** The median: the middle price, or the mean of the middle two for an even count. */
  middle: number;
  high: number;
  count: number;
}

export interface PriceContext {
  /** The currency a bare "$" means on the source site ("USD"), or null/absent when none. */
  siteDollar?: string | null;
}

/** ISO codes recognised as a currency mark. */
const ISO_CODES: ReadonlySet<string> = new Set([
  "USD",
  "GBP",
  "EUR",
  "CHF",
  "JPY",
  "AUD",
  "CAD",
  "HKD",
  "NZD",
  "SGD",
  "CNY",
  "SEK",
  "NOK",
  "DKK",
]);

/** Prefixed dollars: what the letters in front of "$" stand for. */
const DOLLAR_PREFIXES: Readonly<Record<string, string>> = {
  US: "USD",
  A: "AUD",
  C: "CAD",
  HK: "HKD",
  NZ: "NZD",
  S: "SGD",
};

const SYMBOLS: Readonly<Record<string, string>> = { "£": "GBP", "€": "EUR", $: "$", "¥": "¥" };

/** True for an ISO currency code the matcher knows ("GBP"), false for a bare symbol or text. */
export function isIsoCurrency(value: string): boolean {
  return ISO_CODES.has(value);
}

/**
 * A currency as written (symbol, prefixed dollar, or code in any case) as an ISO code, "$" or
 * "¥", or null when it is not a currency the matcher knows.
 */
function normalizeCurrency(raw: string): string | null {
  const text = raw.trim();
  if (text in SYMBOLS) return SYMBOLS[text]!;
  if (text.endsWith("$")) return DOLLAR_PREFIXES[text.slice(0, -1).toUpperCase()] ?? null;
  const code = text.toUpperCase();
  return ISO_CODES.has(code) ? code : null;
}

/** Thousands separators: comma, dot, apostrophes, and non-breaking or narrow spaces. */
const NUMBER =
  /\d{1,3}(?:[.,'\u2019\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?(?!\d)/g;

/** A mark just before a number: a symbol, letters then "$", or a three-letter code. */
const PREFIX_MARK = /(?:([A-Za-z]*)\$|([£€¥])|(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z]))\s?$/;
/** A mark just after a number, unless it belongs to the number that follows it. */
const SUFFIX_MARK = /^\s?(?:([£€¥])|([A-Za-z]{3})(?![A-Za-z]))(?!\s?\d)/;

/** "1.250,00", "1,250", "225.50", "225,5" and "1 250" style digits as a number. */
function parseAmount(digits: string): number {
  const text = digits.replace(/['\u2019\u00a0\u202f]/g, "");
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let decimal = "";
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? "." : ",";
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    if (sep) {
      const count = text.split(sep).length - 1;
      const tail = text.length - text.lastIndexOf(sep) - 1;
      // One separator followed by exactly three digits is a thousands separator ("1,250"),
      // unless the number starts with 0 ("0,500").
      if (count === 1 && !(tail === 3 && !text.startsWith("0"))) decimal = sep;
    }
  }
  const whole = decimal ? text.slice(0, text.lastIndexOf(decimal)) : text;
  const fraction = decimal ? text.slice(text.lastIndexOf(decimal) + 1) : "";
  const amount = Number(`${whole.replace(/[.,]/g, "")}${fraction ? `.${fraction}` : ""}`);
  return amount;
}

/** The currency of a mark found before a number, or null when there is none we know. */
function prefixCurrency(before: string): string | null {
  const match = PREFIX_MARK.exec(before);
  if (!match) return null;
  const [, dollarLetters, symbol, code] = match;
  if (symbol) return SYMBOLS[symbol] ?? null;
  if (dollarLetters !== undefined && match[0].includes("$")) {
    return dollarLetters === "" ? "$" : (DOLLAR_PREFIXES[dollarLetters.toUpperCase()] ?? null);
  }
  return code ? normalizeCurrency(code) : null;
}

/** The currency of a mark found right after a number, or null. */
function suffixCurrency(after: string): string | null {
  const match = SUFFIX_MARK.exec(after);
  if (!match) return null;
  return normalizeCurrency(match[1] ?? match[2] ?? "");
}

/**
 * Every price in the text that has a currency mark, in order. A number with no mark, or with
 * a mark the matcher does not know (for example "MX$"), is not a price. The currency is an ISO
 * code, or "$" / "¥" for a bare mark; nothing is resolved here (see resolveCurrency).
 */
export function findPrices(text: string): Price[] {
  const prices: Price[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const start = match.index;
    const digits = match[0];
    const currency =
      prefixCurrency(text.slice(0, start)) ?? suffixCurrency(text.slice(start + digits.length));
    const amount = parseAmount(digits);
    if (currency === null || !Number.isFinite(amount)) continue;
    prices.push({ amount, currency });
  }
  return prices;
}

/** The first price in the text, or null. */
export function parsePrice(text: string): Price | null {
  return findPrices(text)[0] ?? null;
}

/** True when the quote shows an explicit "US$" amount. */
function showsUsDollar(quote: string): boolean {
  return /(?<![A-Za-z])US\$\s?\d/i.test(quote);
}

/**
 * The currency of a price as written, resolved: symbols and prefixed dollars become ISO codes,
 * and a bare "$" becomes "USD" only when the site declares USD or the quote shows "US$".
 * Anything else stays "$" (or "¥"). A value the matcher does not know is returned unchanged.
 */
export function resolveCurrency(currency: string, quote = "", ctx: PriceContext = {}): string {
  const normalized = normalizeCurrency(currency);
  if (normalized === null) return currency;
  if (normalized !== "$") return normalized;
  return ctx.siteDollar === "USD" || showsUsDollar(quote) ? "USD" : "$";
}

/**
 * True when `price` appears in `quote` as a whole amount with a matching currency mark. The
 * quote's bare "$" and the price's currency are resolved the same way (see resolveCurrency), so
 * a "$310" quote from a site that does not declare USD matches only a "$" price, and "HK$310"
 * never matches a "$" or USD price.
 */
export function priceAppearsIn(price: Price, quote: string, ctx: PriceContext = {}): boolean {
  if (!Number.isFinite(price.amount) || price.amount <= 0) return false;
  const wanted = normalizeCurrency(price.currency);
  if (wanted === null) return false;
  const currency = resolveCurrency(wanted, quote, ctx);
  return findPrices(quote).some(
    (found) =>
      found.amount === price.amount && resolveCurrency(found.currency, quote, ctx) === currency,
  );
}

const roundCents = (value: number): number => Math.round(value * 100) / 100;

/**
 * Low, middle (median) and high per currency, never converted or merged. Amounts that are not
 * positive finite numbers are skipped. Groups are ordered by price count, then currency code.
 */
export function buildRanges(prices: Iterable<Price>): CurrencyRange[] {
  const groups = new Map<string, number[]>();
  for (const { amount, currency } of prices) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const amounts = groups.get(currency);
    if (amounts) amounts.push(amount);
    else groups.set(currency, [amount]);
  }
  return [...groups]
    .map(([currency, amounts]) => {
      const sorted = amounts.toSorted((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const middle = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      return {
        currency,
        low: roundCents(sorted[0]!),
        middle: roundCents(middle),
        high: roundCents(sorted[sorted.length - 1]!),
        count: sorted.length,
      };
    })
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
}
