import { useState } from "react";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { TidyNoteButton } from "./TidyNoteButton";
import { addTastingNote, type CommandResult } from "../../domain/commands";
import { wineLabel } from "../../domain/labels";
import type { Wine } from "../../domain/types";
import { toIsoDate } from "../../lib/format";
import { errorMessage } from "../cellar/feedback";
import { RatingField } from "./RatingField";
import { isValidIsoDate } from "../add/draft";
import { SheetForm } from "./SheetForm";

export interface NoteSheetProps {
  wine: Wine;
  onClose: () => void;
  onDone: (result: CommandResult) => void;
}

/** Add a tasting note without drinking a bottle (KTD9: the same note record). */
export function NoteSheet({ wine, onClose, onDone }: NoteSheetProps) {
  const [text, setText] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | undefined>();

  const submit = async () => {
    setError(null);
    setTextError(text.trim() ? undefined : "Write a few words first");
    if (!text.trim()) return;
    if (!isValidIsoDate(date)) {
      setError("Enter the date of the note.");
      return;
    }
    setBusy(true);
    try {
      onDone(await addTastingNote({ wineId: wine.id, text, rating, date }));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <SheetForm
      title="Add a tasting note"
      description={wineLabel(wine)}
      submitLabel="Save note"
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field label="Note" error={textError}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Nose, palate, how it's developing…"
        />
      </Field>
      <TidyNoteButton text={text} onResult={setText} className="self-start" />
      <div className="flex flex-wrap items-end gap-4">
        <RatingField value={rating} onChange={setRating} />
        <Field label="Date" className="flex-1">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </SheetForm>
  );
}
