import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { setDrinkingWindow, type CommandResult } from "../../domain/commands";
import { wineLabel } from "../../domain/labels";
import type { Wine } from "../../domain/types";
import { errorMessage } from "../cellar/feedback";
import { validateWindowValues, yearOrNull } from "../add/draft";
import { SheetForm } from "./SheetForm";

export interface WindowSheetProps {
  wine: Wine;
  onClose: () => void;
  onDone: (result: CommandResult) => void;
}

const text = (year: number | null) => (year === null ? "" : String(year));

/** Set or clear the drinking window by hand (R4); the window becomes the user's own. */
export function WindowSheet({ wine, onClose, onDone }: WindowSheetProps) {
  const [from, setFrom] = useState(text(wine.windowFrom));
  const [to, setTo] = useState(text(wine.windowTo));
  const [note, setNote] = useState(wine.windowSource === "user" ? (wine.windowNote ?? "") : "");
  const [errors, setErrors] = useState<{ windowFrom?: string; windowTo?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasWindow = wine.windowFrom !== null || wine.windowTo !== null;

  const save = async (next: { from: number | null; to: number | null; note: string | null }) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await setDrinkingWindow({ wineId: wine.id, ...next, source: "user" }));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const submit = () => {
    const found = validateWindowValues({ windowFrom: from, windowTo: to });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    void save({ from: yearOrNull(from), to: yearOrNull(to), note: note.trim() || null });
  };

  return (
    <SheetForm
      title="Drinking window"
      description={`When to drink ${wineLabel(wine)}. Leave a year empty if it's open-ended.`}
      submitLabel="Save window"
      busy={busy}
      error={error}
      onSubmit={submit}
      onClose={onClose}
      secondary={
        hasWindow ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void save({ from: null, to: null, note: null })}
          >
            Clear window
          </Button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Drink from" error={errors.windowFrom}>
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            inputMode="numeric"
            maxLength={4}
            placeholder="2027"
            autoComplete="off"
            className="tabular-nums"
          />
        </Field>
        <Field label="Drink to" error={errors.windowTo}>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            inputMode="numeric"
            maxLength={4}
            placeholder="2040"
            autoComplete="off"
            className="tabular-nums"
          />
        </Field>
      </div>
      <Field label="Why this window" hint="Optional, for example from a critic or a tasting.">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
    </SheetForm>
  );
}
