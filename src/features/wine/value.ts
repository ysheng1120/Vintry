import type { WineValueFields } from "../../domain/commands";
import { wineValue } from "../../domain/money";
import type { Wine } from "../../domain/types";
import { amountText, parseAmount } from "../add/draft";

/** The collector's value as the Edit sheet edits it. `currency` null means "not touched yet". */
export interface ValueFormValues {
  amount: string;
  currency: string | null;
}

export type ValueFormErrors = Partial<Record<"amount" | "currency", string>>;

export function valueFormValues(wine: Wine): ValueFormValues {
  const value = wineValue(wine);
  return { amount: amountText(value?.amount), currency: value?.currency ?? null };
}

/** Checks the value fields. A blank amount means "no value", whatever the currency says. */
export function validateValueValues(
  values: ValueFormValues,
  defaultCurrency: string,
): ValueFormErrors {
  const amount = parseAmount(values.amount);
  if (amount === undefined) return {};
  const errors: ValueFormErrors = {};
  if (Number.isNaN(amount)) errors.amount = "Enter an amount like 120";
  if (!/^[A-Za-z]{3}$/.test((values.currency ?? defaultCurrency).trim())) {
    errors.currency = "Use a three-letter code like GBP";
  }
  return errors;
}

/** The `updateWine` value fields for validated values, or {} when the value is unchanged. */
export function valuePatch(
  wine: Wine,
  values: ValueFormValues,
  defaultCurrency: string,
): WineValueFields {
  const amount = parseAmount(values.amount);
  const valuePerBottle = amount === undefined || Number.isNaN(amount) ? null : amount;
  const valueCurrency =
    valuePerBottle === null ? null : (values.currency ?? defaultCurrency).trim().toUpperCase();
  const current = wineValue(wine);
  if (
    valuePerBottle === (current?.amount ?? null) &&
    valueCurrency === (current?.currency ?? null)
  ) {
    return {};
  }
  return { valuePerBottle, valueCurrency };
}
