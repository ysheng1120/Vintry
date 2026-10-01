import { useState } from "react";
import { errorMessage } from "../../app/commandFeedback";
import { updateWine, type CommandResult } from "../../domain/commands";
import { formatMoney, wineValue } from "../../domain/money";
import type { Wine } from "../../domain/types";
import { amountText } from "../add/draft";
import { SheetForm } from "./SheetForm";
import {
  validateValueValues,
  valuePatch,
  type ValueFormErrors,
  type ValueFormValues,
} from "./value";
import { ValueFields } from "./ValueFields";

export interface SetValueSheetProps {
  wine: Wine;
  /** The amount to start from, for example a price range's middle. */
  amount: number;
  /** Its ISO currency code. */
  currency: string;
  onClose: () => void;
  /** Called with the result, or null when the value did not change. */
  onDone: (result: CommandResult | null) => void;
}

/** "£180" for a whole amount, "£212.50" otherwise. */
function moneyText(amount: number, currency: string): string {
  if (!Number.isInteger(amount)) return formatMoney(amount, currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return formatMoney(amount, currency);
  }
}

/**
 * "Use this price": the collector's own value, prefilled from a shop-price range (KTD7). Nothing
 * changes until the collector saves; saving goes through `updateWine` as the collector, the only
 * source allowed to set a value. Saving the value it already has closes without a change.
 */
export function SetValueSheet({ wine, amount, currency, onClose, onDone }: SetValueSheetProps) {
  const [values, setValues] = useState<ValueFormValues>(() => ({
    amount: amountText(amount),
    currency,
  }));
  const [errors, setErrors] = useState<ValueFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = wineValue(wine);

  const submit = async () => {
    const found = validateValueValues(values, currency);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const patch = valuePatch(wine, values, currency);
    if (Object.keys(patch).length === 0) {
      onDone(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await updateWine({ wineId: wine.id, patch }, { source: "user" }));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <SheetForm
      title="Set your value"
      description="Filled in with the middle shop price. Change it if you like; nothing is saved until you press Save value."
      submitLabel="Save value"
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {current && (
        <p className="text-sm text-ink-muted">
          Replaces {moneyText(current.amount, current.currency)}
        </p>
      )}
      <ValueFields
        values={values}
        onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        defaultCurrency={currency}
        errors={errors}
      />
    </SheetForm>
  );
}
