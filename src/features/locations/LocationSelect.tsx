import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import type { Location } from "../../domain/types";
import { NEW_LOCATION, NO_LOCATION } from "../add/draft";

export interface LocationSelectProps {
  label: string;
  /** A location id, NO_LOCATION (""), or NEW_LOCATION. */
  value: string;
  onChange: (value: string) => void;
  newName: string;
  onNewNameChange: (name: string) => void;
  locations: Location[];
  error?: string;
  hint?: string;
  className?: string;
}

/** A location picker with "No location" and an inline "New location…" name field (R7). */
export function LocationSelect({
  label,
  value,
  onChange,
  newName,
  onNewNameChange,
  locations,
  error,
  hint,
  className,
}: LocationSelectProps) {
  const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className={className}>
      <Field label={label} hint={hint}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value={NO_LOCATION}>No location</option>
          {sorted.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
          <option value={NEW_LOCATION}>New location…</option>
        </Select>
      </Field>
      {value === NEW_LOCATION && (
        <Field label="New location name" error={error} className="mt-3">
          <Input
            value={newName}
            onChange={(e) => onNewNameChange(e.target.value)}
            placeholder="For example Wine fridge"
            autoComplete="off"
          />
        </Field>
      )}
    </div>
  );
}
