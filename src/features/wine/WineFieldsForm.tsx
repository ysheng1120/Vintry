import clsx from "clsx";
import { useId } from "react";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { bottleSizeLabel } from "../../domain/labels";
import { useFilterOptions } from "../../domain/selectors";
import { COLOUR_LABELS, COLOURS, type Colour } from "../../domain/types";
import { BOTTLE_SIZES, type WineFormErrors, type WineFormValues } from "../add/draft";

const SIZE_NAMES: Partial<Record<number, string>> = {
  375: "half",
  750: "standard",
  1500: "magnum",
  3000: "double magnum",
};

export interface WineFieldsFormProps {
  values: WineFormValues;
  onChange: (patch: Partial<WineFormValues>) => void;
  errors?: WineFormErrors;
  /** Field names to highlight for checking (from an AI draft). */
  lowConfidence?: string[];
  /** Show the Drink from / Drink to fields. */
  showWindow?: boolean;
  /** Show the free-text notes field. */
  showNotes?: boolean;
  autoFocus?: boolean;
}

const CHECK_HINT = "Please check this: it may be wrong.";

/** The editable wine fields shared by the add card and the Edit sheet (R1, R2). */
export function WineFieldsForm({
  values,
  onChange,
  errors = {},
  lowConfidence = [],
  showWindow = false,
  showNotes = false,
  autoFocus = false,
}: WineFieldsFormProps) {
  const options = useFilterOptions();
  const listId = useId();
  const nvId = useId();
  const unsure = (field: string) => lowConfidence.includes(field);
  const hint = (field: string, fallback?: string) => (unsure(field) ? CHECK_HINT : fallback);
  const flag = (field: string) => (unsure(field) ? "border-warning bg-warning-soft/40" : undefined);

  const sizes: number[] = [...BOTTLE_SIZES];
  const size = Number(values.bottleSize);
  if (size > 0 && !sizes.includes(size)) sizes.push(size);
  sizes.sort((a, b) => a - b);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Producer" required error={errors.producer} hint={hint("producer")}>
        <Input
          value={values.producer}
          onChange={(e) => onChange({ producer: e.target.value })}
          placeholder="For example Ridge"
          autoComplete="off"
          autoFocus={autoFocus}
          className={flag("producer")}
        />
      </Field>
      <Field label="Wine name" error={errors.name} hint={hint("name", "Cuvée or label name")}>
        <Input
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="For example Monte Bello"
          autoComplete="off"
          className={flag("name")}
        />
      </Field>

      <div className="flex items-start gap-3">
        <Field
          label="Vintage"
          required={!values.nv}
          error={errors.vintage}
          hint={hint("vintage")}
          className="flex-1"
        >
          <Input
            value={values.nv ? "" : values.vintage}
            onChange={(e) => onChange({ vintage: e.target.value })}
            inputMode="numeric"
            maxLength={4}
            placeholder={values.nv ? "Non-vintage" : "2019"}
            disabled={values.nv}
            autoComplete="off"
            className={clsx("tabular-nums", flag("vintage"))}
          />
        </Field>
        <div className="flex min-h-10 items-center gap-2 pt-7">
          <input
            id={nvId}
            type="checkbox"
            checked={values.nv}
            onChange={(e) => onChange({ nv: e.target.checked })}
            className="size-5 accent-primary"
          />
          <label htmlFor={nvId} className="text-sm font-medium text-ink">
            NV
          </label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Colour" hint={hint("colour")}>
          <Select
            value={values.colour}
            onChange={(e) => onChange({ colour: e.target.value as Colour })}
            className={flag("colour")}
          >
            {COLOURS.map((colour) => (
              <option key={colour} value={colour}>
                {COLOUR_LABELS[colour]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bottle size" error={errors.bottleSize} hint={hint("bottleSize")}>
          <Select
            value={values.bottleSize}
            onChange={(e) => onChange({ bottleSize: e.target.value })}
            className={flag("bottleSize")}
          >
            {sizes.map((ml) => (
              <option key={ml} value={String(ml)}>
                {bottleSizeLabel(ml)}
                {SIZE_NAMES[ml] ? ` (${SIZE_NAMES[ml]})` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Country" hint={hint("country")}>
        <Input
          value={values.country}
          onChange={(e) => onChange({ country: e.target.value })}
          list={`${listId}-countries`}
          autoComplete="off"
          className={flag("country")}
        />
      </Field>
      <Field label="Region" hint={hint("region")}>
        <Input
          value={values.region}
          onChange={(e) => onChange({ region: e.target.value })}
          list={`${listId}-regions`}
          autoComplete="off"
          className={flag("region")}
        />
      </Field>
      <Field label="Appellation" hint={hint("appellation")}>
        <Input
          value={values.appellation}
          onChange={(e) => onChange({ appellation: e.target.value })}
          autoComplete="off"
          className={flag("appellation")}
        />
      </Field>
      <Field label="Grapes" hint={hint("grapes", "Separate with commas")}>
        <Input
          value={values.grapes}
          onChange={(e) => onChange({ grapes: e.target.value })}
          autoComplete="off"
          className={flag("grapes")}
        />
      </Field>

      {showWindow && (
        <fieldset className="grid grid-cols-2 gap-3 sm:col-span-2">
          <legend className="mb-2 text-sm font-semibold text-ink">
            Drinking window <span className="font-normal text-ink-subtle">(optional)</span>
          </legend>
          <Field label="Drink from" error={errors.windowFrom} hint={hint("windowFrom")}>
            <Input
              value={values.windowFrom}
              onChange={(e) => onChange({ windowFrom: e.target.value })}
              inputMode="numeric"
              maxLength={4}
              placeholder="2027"
              autoComplete="off"
              className={clsx("tabular-nums", flag("windowFrom"))}
            />
          </Field>
          <Field label="Drink to" error={errors.windowTo} hint={hint("windowTo")}>
            <Input
              value={values.windowTo}
              onChange={(e) => onChange({ windowTo: e.target.value })}
              inputMode="numeric"
              maxLength={4}
              placeholder="2040"
              autoComplete="off"
              className={clsx("tabular-nums", flag("windowTo"))}
            />
          </Field>
        </fieldset>
      )}

      {showNotes && (
        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            value={values.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            rows={3}
          />
        </Field>
      )}

      <datalist id={`${listId}-countries`}>
        {options?.countries.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id={`${listId}-regions`}>
        {options?.regions.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </div>
  );
}
