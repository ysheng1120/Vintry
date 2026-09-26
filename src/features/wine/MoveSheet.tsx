import { useState } from "react";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Stepper } from "../../components/ui/Stepper";
import { createLocation, moveBottles, type CommandResult } from "../../domain/commands";
import { bottles, wineLabel } from "../../domain/labels";
import { useLocations, type LotWithLocation } from "../../domain/selectors";
import type { Wine } from "../../domain/types";
import { errorMessage } from "../cellar/feedback";
import { NEW_LOCATION, resolveLotLocation } from "../add/draft";
import { LocationSelect } from "../locations/LocationSelect";
import { lotLabel } from "./lotLabel";
import { SheetForm } from "./SheetForm";

export interface MoveSheetProps {
  wine: Wine;
  lots: LotWithLocation[];
  initialLotId?: string;
  onClose: () => void;
  onDone: (result: CommandResult) => void;
}

/** Move some or all bottles of a lot; a partial move splits the lot (KTD5). */
export function MoveSheet({ wine, lots, initialLotId, onClose, onDone }: MoveSheetProps) {
  const locations = useLocations();
  const [lotId, setLotId] = useState(initialLotId ?? lots[0]?.id ?? "");
  const lot = lots.find((l) => l.id === lotId) ?? lots[0];
  const [quantity, setQuantity] = useState(lot?.quantity ?? 1);
  // null until the user picks: then the first other location (or a new one) is suggested.
  const [destination, setDestination] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [bin, setBin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();

  if (!lot) return null;
  const count = Math.min(quantity, lot.quantity);
  const suggested =
    (locations ?? []).find((l) => l.id !== lot.locationId)?.id ??
    (locations === undefined ? "" : NEW_LOCATION);
  const target = destination ?? suggested;

  const submit = async () => {
    setError(null);
    setNameError(undefined);
    if (target === NEW_LOCATION && !newName.trim()) {
      setNameError("Name the new location");
      return;
    }
    setBusy(true);
    try {
      const where = resolveLotLocation(
        { location: target, newLocationName: newName },
        locations ?? [],
        null,
      );
      let toLocationId: string | null = null;
      if (where.kind === "id") toLocationId = where.id;
      if (where.kind === "new") {
        const created = await createLocation({ name: where.name });
        toLocationId = created.touched.locationIds[0] ?? null;
      }
      const result = await moveBottles({
        lotId: lot.id,
        quantity: count,
        toLocationId,
        bin,
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
      title="Move bottles"
      description={wineLabel(wine)}
      submitLabel={`Move ${bottles(count)}`}
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
              const next = lots.find((l) => l.id === e.target.value);
              setLotId(e.target.value);
              setQuantity(next?.quantity ?? 1);
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
      {lots.length === 1 && <p className="text-sm text-ink-muted">From {lotLabel(lot)}</p>}
      <Field
        label="How many"
        hint={
          count < lot.quantity ? `${lot.quantity - count} stay where they are.` : "All of them."
        }
      >
        <Stepper value={count} min={1} max={lot.quantity} onChange={setQuantity} />
      </Field>
      <LocationSelect
        label="To"
        value={target}
        onChange={setDestination}
        newName={newName}
        onNewNameChange={setNewName}
        locations={locations ?? []}
        error={nameError}
      />
      <Field label="Bin" hint="Shelf or slot at the new place (optional).">
        <Input value={bin} onChange={(e) => setBin(e.target.value)} autoComplete="off" />
      </Field>
    </SheetForm>
  );
}
