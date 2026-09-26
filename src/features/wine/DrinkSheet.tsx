import { useState } from "react";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Stepper } from "../../components/ui/Stepper";
import { Textarea } from "../../components/ui/Textarea";
import { consumeBottles, type CommandResult } from "../../domain/commands";
import { wineLabel } from "../../domain/labels";
import type { LotWithLocation } from "../../domain/selectors";
import type { Wine } from "../../domain/types";
import { toIsoDate } from "../../lib/format";
import { errorMessage } from "../cellar/feedback";
import { RatingField } from "./RatingField";
import { isValidIsoDate } from "../add/draft";
import { lotLabel } from "./lotLabel";
import { SheetForm } from "./SheetForm";

export interface DrinkSheetProps {
  wine: Wine;
  /** Open lots, largest first. */
  lots: LotWithLocation[];
  initialLotId?: string;
  onClose: () => void;
  onDone: (result: CommandResult) => void;
}

/** Record drinking bottles (R3): quantity, date, rating, note, occasion. */
export function DrinkSheet({ wine, lots, initialLotId, onClose, onDone }: DrinkSheetProps) {
  const [lotId, setLotId] = useState(initialLotId ?? lots[0]?.id ?? "");
  const lot = lots.find((l) => l.id === lotId) ?? lots[0];
  const [quantity, setQuantity] = useState(1);
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [occasion, setOccasion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!lot) return null;
  const count = Math.min(quantity, lot.quantity);

  const submit = async () => {
    if (!isValidIsoDate(date)) {
      setError("Enter the date you drank it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await consumeBottles({
        lotId: lot.id,
        quantity: count,
        date,
        rating,
        note,
        occasion,
        expectedQuantity: lot.quantity,
      });
      onDone(result);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <SheetForm
      title={count > 1 ? `Drink ${count} bottles` : "Drink a bottle"}
      description={wineLabel(wine)}
      submitLabel="Record drink"
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {lots.length > 1 && (
        <Field label="From">
          <Select
            value={lot.id}
            onChange={(e) => {
              setLotId(e.target.value);
              setQuantity(1);
            }}
          >
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {lotLabel(l)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex flex-wrap gap-4">
        <Field label="How many" hint={`${lot.quantity} in this lot`}>
          <Stepper value={count} min={1} max={lot.quantity} onChange={setQuantity} />
        </Field>
        <Field label="Date" className="flex-1">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <RatingField value={rating} onChange={setRating} />
      <Field label="Tasting note" hint="Saved with this bottle in the wine's notes.">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="How was it?"
        />
      </Field>
      <Field label="Occasion">
        <Input
          value={occasion}
          onChange={(e) => setOccasion(e.target.value)}
          placeholder="For example Sunday lunch"
          autoComplete="off"
        />
      </Field>
    </SheetForm>
  );
}
