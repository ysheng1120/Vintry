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
