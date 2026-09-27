import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import type { ValueFormErrors, ValueFormValues } from "./value";

export interface ValueFieldsProps {
  values: ValueFormValues;
  onChange: (patch: Partial<ValueFormValues>) => void;
  defaultCurrency: string;
  errors?: ValueFormErrors;
}

/** The collector's own value per bottle, in the Edit wine sheet. Never filled by AI. */
export function ValueFields({ values, onChange, defaultCurrency, errors = {} }: ValueFieldsProps) {
  return (
    <fieldset className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
      <legend className="mb-2 text-sm font-semibold text-ink">
        Your value <span className="font-normal text-ink-subtle">(optional)</span>
      </legend>
      <Field
        label="Value per bottle"
        error={errors.amount}
        hint="What a bottle is worth to you today. Leave blank for none."
      >
        <Input
          value={values.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          inputMode="decimal"
          autoComplete="off"
          className="tabular-nums"
        />
      </Field>
      <Field label="Currency" error={errors.currency}>
        <Input
          value={values.currency ?? defaultCurrency}
          onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
          maxLength={3}
          autoComplete="off"
          className="uppercase"
        />
      </Field>
    </fieldset>
  );
}
