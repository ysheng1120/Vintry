import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Info, Link2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { SkeletonText } from "../../components/ui/Skeleton";
import { Stepper } from "../../components/ui/Stepper";
import { db } from "../../db/db";
import { getSetting, SETTING_KEYS } from "../../db/settings";
import { currentYear } from "../../domain/clock";
import { addBottles, createLocation } from "../../domain/commands";
import { bottles, wineLabel } from "../../domain/labels";
import { findMatchingWine, normalizeName } from "../../domain/match";
import { getLocations } from "../../domain/selectors";
import type { Location } from "../../domain/types";
import { errorMessage } from "../cellar/feedback";
import { LocationSelect } from "../locations/LocationSelect";
import { WineFieldsForm } from "../wine/WineFieldsForm";
import {
  convertPriceText,
  defaultLocationId,
  draftFormState,
  hasErrors,
  lotFormValues,
  lotLocationSelectValue,
  NEW_LOCATION,
  resolveLotLocation,
  toWineDraft,
  totalBottles,
  validateDraftForm,
  yearOrNull,
  type DraftCardProps,
  type DraftFormErrors,
  type DraftFormState,
  type LotFormValues,
  type PriceBasis,
  type WineFormValues,
} from "./draft";

export type { BottleDraft, BottleLotDraft, DraftCardProps, PriceBasis } from "./draft";

const FALLBACK_CURRENCY = "GBP";

/**
 * The one editable confirm card for new bottles (see the contract in ./draft.ts). Waits for the
 * locations and the currency setting, then lets the user check and edit every field.
 */
export function DraftCard(props: DraftCardProps) {
  const setup = useLiveQuery(async () => {
    const [currency, locations, defaultLocation] = await Promise.all([
      getSetting<string>(SETTING_KEYS.currency, FALLBACK_CURRENCY),
      getLocations(),
      defaultLocationId(),
    ]);
    return {
      currency: /^[A-Z]{3}$/.test(currency) ? currency : FALLBACK_CURRENCY,
      locations,
      defaultLocation,
    };
  }, []);
  if (!setup) {
    return (
      <Card aria-busy="true">
        <SkeletonText lines={6} />
      </Card>
    );
  }
  return <DraftEditor {...props} {...setup} />;
}

interface EditorProps extends DraftCardProps {
  currency: string;
  locations: Location[];
  defaultLocation: string | null;
}

function DraftEditor({
  drafts,
  source,
  onSaved,
  onCancel,
  saveLabel,
  save: customSave,
  currency,
  locations,
  defaultLocation,
}: EditorProps) {
  const [forms, setForms] = useState<DraftFormState[]>(() =>
    drafts.map((d) => draftFormState(d, currency)),
  );
  const [attempts, setAttempts] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const year = currentYear();

  const errors = forms.map((form) =>
    validateDraftForm(form, year, { attached: form.wineId !== null }),
  );
  const shownErrors = attempts > 0 ? errors : null;

  // After a failed save, move focus to the first field that needs attention.
  useEffect(() => {
    if (attempts === 0) return;
    rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempts]);

  const update = (index: number, next: (form: DraftFormState) => DraftFormState) =>
    setForms((list) => list.map((form, i) => (i === index ? next(form) : form)));

  const save = async () => {
    setSaveError(null);
    if (errors.some(hasErrors)) {
      setAttempts((n) => n + 1);
      return;
    }
    setSaving(true);
    try {
      // New locations typed inline are created first (each is its own small change).
      const created = new Map<string, string>();
      for (const form of forms) {
        for (const lot of form.lots) {
          const where = resolveLotLocation(lot, locations, defaultLocation);
          const key = where.kind === "new" ? normalizeName(where.name) : "";
          if (where.kind !== "new" || created.has(key)) continue;
          const result = await createLocation({ name: where.name }, { source });
          const [id] = result.touched.locationIds;
          if (id) created.set(key, id);
        }
      }
      const locationIdFor = (lot: LotFormValues) => {
        const where = resolveLotLocation(lot, locations, defaultLocation);
        if (where.kind === "id") return where.id;
        if (where.kind === "new") return created.get(normalizeName(where.name)) ?? null;
        return null;
      };
      const wineDrafts = [];
      for (const form of forms) {
        const attachedTo = form.wineId ? await db.wines.get(form.wineId) : undefined;
        if (form.wineId && (!attachedTo || attachedTo.deletedAt)) {
          throw new Error("That wine is no longer in your cellar.");
        }
        wineDrafts.push(toWineDraft(form, locationIdFor, attachedTo));
      }
      const result = customSave
        ? await customSave(wineDrafts)
        : await addBottles({ drafts: wineDrafts }, { source });
      onSaved(result);
    } catch (error) {
      setSaveError(errorMessage(error));
      setSaving(false);
    }
  };

  const total = totalBottles(forms);
  return (
    <form
      ref={rootRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-6"
    >
      {forms.map((form, index) => (
        <DraftSection
          key={form.key}
          form={form}
          errors={shownErrors?.[index] ?? null}
          heading={forms.length > 1 ? `Wine ${index + 1} of ${forms.length}` : undefined}
          locations={locations}
          defaultLocation={defaultLocation}
          currency={currency}
          onChange={(next) => update(index, next)}
        />
      ))}

      {shownErrors?.some(hasErrors) && (
        <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
          <AlertTriangle aria-hidden="true" className="size-4" />
          Please fix the highlighted fields.
        </p>
      )}
      {saveError && (
        <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
          <AlertTriangle aria-hidden="true" className="size-4" />
          {saveError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="lg" loading={saving}>
          {saveLabel ?? `Add ${bottles(total)}`}
        </Button>
      </div>
    </form>
  );
}

interface SectionProps {
  form: DraftFormState;
  errors: DraftFormErrors | null;
  heading?: string;
  locations: Location[];
  defaultLocation: string | null;
  currency: string;
  onChange: (next: (form: DraftFormState) => DraftFormState) => void;
}

function useMatchedWine(form: DraftFormState) {
  const { producer, name, nv, vintage, bottleSize } = form.wine;
  const year = nv ? null : yearOrNull(vintage);
  const canMatch = producer.trim() !== "" && (nv || year !== null);
  return useLiveQuery(async () => {
    if (form.wineId) return (await db.wines.get(form.wineId)) ?? null;
    if (!canMatch) return null;
    return (
      (await findMatchingWine({
        producer,
        name,
        vintage: year,
        bottleSize: Number(bottleSize) || undefined,
      })) ?? null
    );
  }, [form.wineId, canMatch, producer, name, year, bottleSize]);
}

function DraftSection({
  form,
  errors,
  heading,
  locations,
  defaultLocation,
  currency,
  onChange,
}: SectionProps) {
  const headingId = useId();
  const match = useMatchedWine(form);
  const attached = form.wineId !== null;
  const setWine = (patch: Partial<WineFormValues>) =>
    onChange((f) => ({ ...f, wine: { ...f.wine, ...patch } }));
  const setLot = (key: string, patch: Partial<LotFormValues>) =>
    onChange((f) => ({ ...f, lots: f.lots.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const previewLabel = [
    form.wine.producer.trim(),
    form.wine.name.trim(),
    form.wine.nv ? "NV" : form.wine.vintage.trim(),
  ]
    .filter(Boolean)
    .join(" ");
  const title = heading ?? (attached && match ? wineLabel(match) : previewLabel || "New wine");
  const aiWindow =
    form.initialWindow.source === "ai" &&
    form.wine.windowFrom === form.initialWindow.from &&
    form.wine.windowTo === form.initialWindow.to &&
    (form.initialWindow.from !== "" || form.initialWindow.to !== "");

  return (
    <Card padding="lg" aria-labelledby={headingId} role="group">
      <div className="mb-5 flex items-start gap-4">
        {form.thumbnail && (
          <img
            src={form.thumbnail}
            alt="Label photo"
            className="size-16 shrink-0 rounded-xl border border-border object-cover"
          />
        )}
        <h2 id={headingId} className="min-w-0 flex-1 text-xl font-semibold text-balance">
          {title}
        </h2>
      </div>

      {form.hints.length > 0 && (
        <ul className="mb-5 flex flex-col gap-1.5 rounded-xl bg-info-soft px-4 py-3 text-sm text-ink">
          {form.hints.map((hint) => (
            <li key={hint} className="flex items-start gap-2">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
              {hint}
            </li>
          ))}
        </ul>
      )}

      {match && (
        <div
          role="status"
          className="mb-5 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3"
        >
          <Link2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="font-medium text-ink">Add to existing wine: {wineLabel(match)}</p>
            <p className="text-sm text-ink-muted">
              These bottles join the wine already in your cellar. Its details and drinking window
              stay as they are.
            </p>
          </div>
        </div>
      )}
      {attached && match === null && (
        <p role="alert" className="mb-5 text-sm font-medium text-danger">
          That wine is no longer in your cellar.
        </p>
      )}

      {!attached && (
        <>
          <WineFieldsForm
            values={form.wine}
            onChange={setWine}
            errors={errors?.wine}
            lowConfidence={form.lowConfidence}
            showWindow
            showNotes
            autoFocus={!form.wine.producer}
          />
          {aiWindow && (
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
              <Badge tone="accent">
                <Sparkles aria-hidden="true" />
                AI estimate
              </Badge>
              Change the years to make it your own window.
            </p>
          )}
        </>
      )}

      <fieldset className="mt-6 border-t border-border pt-5">
        <legend className="mb-4 text-base font-semibold">Bottles</legend>
        <PriceBasisToggle
          basis={form.priceBasis}
          onChange={(basis) =>
            onChange((f) => ({
              ...f,
              priceBasis: basis,
              lots: f.lots.map((l) => ({
                ...l,
                price: convertPriceText(l.price, f.priceBasis, basis, l.quantity),
              })),
            }))
          }
        />
        <div className="mt-4 flex flex-col gap-5">
          {form.lots.map((lot, i) => (
            <LotFields
              key={lot.key}
              lot={lot}
              index={i}
              count={form.lots.length}
              basis={form.priceBasis}
              errors={errors?.lots[i] ?? {}}
              lowConfidence={form.lowConfidence}
              locations={locations}
              defaultLocation={defaultLocation}
              onChange={(patch) => setLot(lot.key, patch)}
              onRemove={() =>
                onChange((f) => ({ ...f, lots: f.lots.filter((l) => l.key !== lot.key) }))
              }
            />
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          icon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() =>
            onChange((f) => {
              const last = f.lots[f.lots.length - 1];
              const next = lotFormValues({ quantity: 1 }, f.priceBasis, last?.currency || currency);
              return { ...f, lots: [...f.lots, next] };
            })
          }
        >
          Add bottles in another place
        </Button>
      </fieldset>
    </Card>
  );
}

function PriceBasisToggle({
  basis,
  onChange,
}: {
  basis: PriceBasis;
  onChange: (basis: PriceBasis) => void;
}) {
  const name = useId();
  const choices: { value: PriceBasis; label: string }[] = [
    { value: "per-bottle", label: "Per bottle" },
    { value: "total", label: "For all bottles" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="How the price is given"
      className={clsx(
        "flex flex-wrap items-center gap-3 text-sm",
        basis === "unclear" && "rounded-xl bg-warning-soft px-3 py-2",
      )}
    >
      <span className="font-medium text-ink-muted">
        {basis === "unclear" ? "Is the price per bottle or for all bottles?" : "Price is"}
      </span>
      <div className="inline-flex rounded-xl border border-border-strong bg-surface p-0.5">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={clsx(
              "inline-flex min-h-9 cursor-pointer items-center rounded-[0.6rem] px-3 font-medium transition-colors",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
              basis === choice.value
                ? "bg-primary text-on-primary"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={basis === choice.value}
              onChange={() => onChange(choice.value)}
              className="sr-only"
            />
            {choice.label}
          </label>
        ))}
      </div>
    </div>
  );
}

interface LotFieldsProps {
  lot: LotFormValues;
  index: number;
  count: number;
  basis: PriceBasis;
  errors: DraftFormErrors["lots"][number];
  lowConfidence: string[];
  locations: Location[];
  defaultLocation: string | null;
  onChange: (patch: Partial<LotFormValues>) => void;
  onRemove: () => void;
}

function LotFields({
  lot,
  index,
  count,
  basis,
  errors,
  lowConfidence,
  locations,
  defaultLocation,
  onChange,
  onRemove,
}: LotFieldsProps) {
  const unsure = (field: string) =>
    lowConfidence.includes(field) ? "Please check this: it may be wrong." : undefined;
  const flag = (field: string) =>
    lowConfidence.includes(field) ? "border-warning bg-warning-soft/40" : undefined;
  const priceLabel =
    basis === "per-bottle"
      ? "Price per bottle"
      : basis === "total"
        ? "Price for all bottles"
        : "Price";

  return (
    <div
      role={count > 1 ? "group" : undefined}
      aria-label={count > 1 ? `Place ${index + 1}` : undefined}
      className={clsx(count > 1 && "rounded-xl border border-border p-4")}
    >
      {count > 1 && (
        <div className="mb-3 flex items-center justify-between">
          <p aria-hidden="true" className="text-sm font-semibold text-ink-muted">
            Place {index + 1}
          </p>
          <IconButton
            label={`Remove place ${index + 1}`}
            icon={<Trash2 />}
            size="sm"
            onClick={onRemove}
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[auto_1fr_8rem]">
        <Field label="Bottles" error={errors.quantity} hint={unsure("quantity")}>
          <Stepper
            value={lot.quantity}
            min={1}
            max={9999}
            onChange={(quantity) => onChange({ quantity })}
          />
        </Field>
        <LocationSelect
          label="Location"
          value={lotLocationSelectValue(lot, locations, defaultLocation)}
          onChange={(value) =>
            onChange({
              location: value,
              newLocationName: value === NEW_LOCATION ? lot.newLocationName : "",
            })
          }
          newName={lot.newLocationName}
          onNewNameChange={(newLocationName) => onChange({ newLocationName })}
          locations={locations}
          error={errors.location}
          hint={unsure("location")}
        />
        <Field label="Bin" hint={unsure("bin")}>
          <Input
            value={lot.bin}
            onChange={(e) => onChange({ bin: e.target.value })}
            placeholder="A3"
            autoComplete="off"
            className={flag("bin")}
          />
        </Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_6rem_1fr_1fr]">
        <Field label={priceLabel} error={errors.price} hint={unsure("price")}>
          <Input
            value={lot.price}
            onChange={(e) => onChange({ price: e.target.value })}
            inputMode="decimal"
            autoComplete="off"
            className={clsx("tabular-nums", flag("price"))}
          />
        </Field>
        <Field label="Currency" error={errors.currency} hint={unsure("currency")}>
          <Input
            value={lot.currency}
            onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
            maxLength={3}
            autoComplete="off"
            className={clsx("uppercase", flag("currency"))}
          />
        </Field>
        <Field label="Bought on" error={errors.purchaseDate} hint={unsure("purchaseDate")}>
          <Input
            type="date"
            value={lot.purchaseDate}
            onChange={(e) => onChange({ purchaseDate: e.target.value })}
            className={flag("purchaseDate")}
          />
        </Field>
        <Field label="Shop" hint={unsure("store")}>
          <Input
            value={lot.store}
            onChange={(e) => onChange({ store: e.target.value })}
            autoComplete="off"
            className={flag("store")}
          />
        </Field>
      </div>
    </div>
  );
}
