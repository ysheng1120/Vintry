import { useState } from "react";
import { SETTING_KEYS, useSetting } from "../../db/settings";
import { currentYear } from "../../domain/clock";
import {
  updateWine,
  type CommandResult,
  type WineFields,
  type WineValueFields,
} from "../../domain/commands";
import type { Wine } from "../../domain/types";
import { errorMessage } from "../../app/commandFeedback";
import {
  validateWineValues,
  wineFieldsFromValues,
  wineFormValues,
  type WineFormErrors,
  type WineFormValues,
} from "../add/draft";
import { SheetForm } from "./SheetForm";
import {
  validateValueValues,
  valueFormValues,
  valuePatch,
  type ValueFormErrors,
  type ValueFormValues,
} from "./value";
import { ValueFields } from "./ValueFields";
import { WineFieldsForm } from "./WineFieldsForm";

export interface EditWineSheetProps {
  wine: Wine;
  onClose: () => void;
  /** Called with the result, or null when nothing changed. */
  onDone: (result: CommandResult | null) => void;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const FALLBACK_CURRENCY = "GBP";

/** Edit a wine's details (R2) and the collector's own value. The window has its own sheet. */
export function EditWineSheet({ wine, onClose, onDone }: EditWineSheetProps) {
  const [values, setValues] = useState<WineFormValues>(() => wineFormValues(wine));
  const [errors, setErrors] = useState<WineFormErrors>({});
  const [value, setValue] = useState<ValueFormValues>(() => valueFormValues(wine));
  const [valueErrors, setValueErrors] = useState<ValueFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setting = useSetting<unknown>(SETTING_KEYS.currency, FALLBACK_CURRENCY);
  const defaultCurrency =
    typeof setting === "string" && /^[A-Z]{3}$/.test(setting) ? setting : FALLBACK_CURRENCY;

  const submit = async () => {
    const found = validateWineValues(values, currentYear(), { includeWindow: false });
    const foundValue = validateValueValues(value, defaultCurrency);
    setErrors(found);
    setValueErrors(foundValue);
    if (Object.keys(found).length > 0 || Object.keys(foundValue).length > 0) return;

    const fields = wineFieldsFromValues(values);
    const patch: Partial<WineFields> & WineValueFields = valuePatch(wine, value, defaultCurrency);
    for (const [key, next] of Object.entries(fields) as [keyof typeof fields, unknown][]) {
      if (!sameValue(next, wine[key])) (patch as Record<string, unknown>)[key] = next;
    }
    if (Object.keys(patch).length === 0) {
      onDone(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await updateWine({ wineId: wine.id, patch }));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <SheetForm
      title="Edit wine"
      submitLabel="Save changes"
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <WineFieldsForm
        values={values}
        onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        errors={errors}
        showNotes
      />
      <ValueFields
        values={value}
        onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
        defaultCurrency={defaultCurrency}
        errors={valueErrors}
      />
    </SheetForm>
  );
}
