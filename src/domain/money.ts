/** Formats an amount with the currency symbol from Intl, for example "£1,234.50". */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    // Unknown currency code: show the number and the code rather than failing.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export interface CurrencyTotal {
  currency: string;
  total: number;
}

/**
 * Totals amounts per currency, largest first. Currencies are never converted or mixed (R9).
 * Items without an amount or a currency are skipped.
 */
export function sumByCurrency(
  items: Iterable<{ amount: number | null; currency: string | null }>,
): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const { amount, currency } of items) {
    if (amount === null || currency === null || !Number.isFinite(amount)) continue;
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
  return [...totals]
    .map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total || a.currency.localeCompare(b.currency));
}

export interface WineValue {
  amount: number;
  currency: string;
  /** When the collector last changed it (ISO date-time), if known. */
  updatedAt: string | null;
}

/**
 * The collector's own value per bottle for a wine, or null when there is none. Rows saved before
 * values existed have no value fields at all, so missing counts as none.
 */
export function wineValue(wine: {
  valuePerBottle?: number | null;
  valueCurrency?: string | null;
  valueUpdatedAt?: string | null;
}): WineValue | null {
  const { valuePerBottle: amount, valueCurrency: currency } = wine;
  if (typeof amount !== "number" || !Number.isFinite(amount) || !currency) return null;
  return { amount, currency, updatedAt: wine.valueUpdatedAt ?? null };
}
