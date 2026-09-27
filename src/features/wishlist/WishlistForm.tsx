import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Sheet } from "../../components/ui/Sheet";
import { Textarea } from "../../components/ui/Textarea";
import { commandErrorMessage, useCommandFeedback } from "../cellar/feedback";
import { addWishlistItem, updateWishlistItem } from "../../domain/commands/wishlist";
import { COLOUR_LABELS, COLOURS, type WishlistItem } from "../../domain/types";
import { useCurrency } from "../settings/currency";

export interface WishlistFormProps {
  open: boolean;
  /** The item being edited, or null when adding a new one. */
  item: WishlistItem | null;
  onClose: () => void;
}

interface FormState {
  producer: string;
  name: string;
  vintage: string;
  colour: string;
  country: string;
  region: string;
  notes: string;
  targetPrice: string;
}

function stateFor(item: WishlistItem | null): FormState {
  return {
    producer: item?.producer ?? "",
    name: item?.name ?? "",
    vintage: item?.vintage?.toString() ?? "",
    colour: item?.colour ?? "",
    country: item?.country ?? "",
    region: item?.region ?? "",
    notes: item?.notes ?? "",
    targetPrice: item?.targetPrice?.toString() ?? "",
  };
}

/** Add or edit a wishlist item (R8). Saving shows an Undo toast, per KTD7. */
export function WishlistForm({ open, item, onClose }: WishlistFormProps) {
  const { done } = useCommandFeedback();
  const defaultCurrency = useCurrency();
  const [form, setForm] = useState<FormState>(() => stateFor(item));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the draft whenever a different item (or a fresh add) opens.
  const key = item?.id ?? "new";
  const [openedFor, setOpenedFor] = useState(key);
  if (open && openedFor !== key) {
    setOpenedFor(key);
    setForm(stateFor(item));
    setError(null);
  }

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const fields = {
        producer: form.producer,
        name: form.name,
        vintage: form.vintage.trim() === "" ? null : Number(form.vintage),
        colour: form.colour === "" ? null : (form.colour as (typeof COLOURS)[number]),
        country: form.country,
        region: form.region,
        notes: form.notes,
        targetPrice: form.targetPrice.trim() === "" ? null : Number(form.targetPrice),
        currency: item?.currency ?? defaultCurrency,
      };
      const result = item
        ? await updateWishlistItem({ itemId: item.id, patch: fields })
        : await addWishlistItem(fields);
      done(result);
      onClose();
    } catch (err) {
      setError(commandErrorMessage(err, "Could not save that item."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item ? "Edit wishlist item" : "Add to wishlist"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="wishlist-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="wishlist-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Producer" required error={error ?? undefined}>
          <Input required value={form.producer} onChange={(e) => set("producer", e.target.value)} />
        </Field>
        <Field label="Wine">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Vintage" hint="Leave blank for NV">
            <Input
              type="number"
              inputMode="numeric"
              value={form.vintage}
              onChange={(e) => set("vintage", e.target.value)}
            />
          </Field>
          <Field label="Colour">
            <Select value={form.colour} onChange={(e) => set("colour", e.target.value)}>
              <option value="">Not set</option>
              {COLOURS.map((c) => (
                <option key={c} value={c}>
                  {COLOUR_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Country">
            <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
          </Field>
          <Field label="Region">
            <Input value={form.region} onChange={(e) => set("region", e.target.value)} />
          </Field>
        </div>
        <Field label="Target price per bottle" hint={`In ${item?.currency ?? defaultCurrency}`}>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={form.targetPrice}
            onChange={(e) => set("targetPrice", e.target.value)}
          />
        </Field>
        <Field label="Note">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </form>
    </Sheet>
  );
}
