import { useState } from "react";
import { currentYear } from "../../domain/clock";
import { updateWine, type CommandResult, type WineFields } from "../../domain/commands";
import type { Wine } from "../../domain/types";
import { errorMessage } from "../cellar/feedback";
import {
  validateWineValues,
  wineFieldsFromValues,
  wineFormValues,
  type WineFormErrors,
  type WineFormValues,
} from "../add/draft";
import { SheetForm } from "./SheetForm";
import { WineFieldsForm } from "./WineFieldsForm";

export interface EditWineSheetProps {
  wine: Wine;
  onClose: () => void;
  /** Called with the result, or null when nothing changed. */
  onDone: (result: CommandResult | null) => void;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Edit a wine's details (R2). The drinking window has its own sheet. */
export function EditWineSheet({ wine, onClose, onDone }: EditWineSheetProps) {
  const [values, setValues] = useState<WineFormValues>(() => wineFormValues(wine));
  const [errors, setErrors] = useState<WineFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const found = validateWineValues(values, currentYear(), { includeWindow: false });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const fields = wineFieldsFromValues(values);
    const patch: Partial<WineFields> = {};
    for (const [key, value] of Object.entries(fields) as [keyof typeof fields, unknown][]) {
      if (!sameValue(value, wine[key])) (patch as Record<string, unknown>)[key] = value;
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
    </SheetForm>
  );
}
