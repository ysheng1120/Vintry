import { Sparkles } from "lucide-react";
import type { ImportField } from "../../ai/features/mapCsv";
import { useAiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Select } from "../../components/ui/Select";
import { IMPORT_SOURCE_LABELS, type CsvMapping, type ImportSourceId } from "./presets";

const FIELDS: { field: ImportField; label: string; required?: boolean }[] = [
  { field: "producer", label: "Producer", required: true },
  { field: "name", label: "Cuvée / wine name" },
  { field: "vintage", label: "Vintage" },
  { field: "colour", label: "Colour" },
  { field: "country", label: "Country" },
  { field: "region", label: "Region" },
  { field: "appellation", label: "Appellation" },
  { field: "grapes", label: "Grapes" },
  { field: "bottleSize", label: "Bottle size" },
  { field: "quantity", label: "Quantity" },
  { field: "location", label: "Location" },
  { field: "bin", label: "Bin" },
  { field: "purchaseDate", label: "Purchase date" },
  { field: "pricePerBottle", label: "Price per bottle" },
  { field: "currency", label: "Currency" },
  { field: "store", label: "Store" },
  { field: "windowFrom", label: "Drink from (year)" },
  { field: "windowTo", label: "Drink by (year)" },
  { field: "rating", label: "Rating" },
  { field: "notes", label: "Notes" },
];

export interface MappingEditorProps {
  headers: string[];
  source: ImportSourceId;
  mapping: CsvMapping;
  onChange: (mapping: CsvMapping) => void;
  /** Runs the AI column-mapping suggestion; omit to hide the button entirely. */
  onSuggest?: () => void;
  suggesting?: boolean;
  suggestionNotes?: string[];
  suggestionError?: string | null;
}

/**
 * One CSV-header select per Vintry field (R20). For a generic file with a key, an AI suggestion
 * button fills the mapping and shows its plain-language notes; the user can still change any of it.
 */
export function MappingEditor({
  headers,
  source,
  mapping,
  onChange,
  onSuggest,
  suggesting = false,
  suggestionNotes,
  suggestionError,
}: MappingEditorProps) {
  const aiStatus = useAiStatus();
  const canSuggest = source === "generic" && onSuggest && aiStatus.state === "ready";

  function setField(field: ImportField, header: string) {
    const next = { ...mapping };
    if (header) next[field] = header;
    else delete next[field];
    onChange(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          Detected format:{" "}
          <span className="font-medium text-ink">{IMPORT_SOURCE_LABELS[source]}</span>
        </p>
        {canSuggest && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<Sparkles aria-hidden="true" className="size-4" />}
            loading={suggesting}
            onClick={onSuggest}
          >
            Suggest with AI
          </Button>
        )}
      </div>

      {suggestionError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {suggestionError}
        </p>
      )}

      {suggestionNotes && suggestionNotes.length > 0 && (
        <ul className="list-disc space-y-1 rounded-xl bg-info-soft py-3 pr-3 pl-7 text-sm text-info">
          {suggestionNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(({ field, label, required }) => (
          <Field key={field} label={label} required={required}>
            <Select value={mapping[field] ?? ""} onChange={(e) => setField(field, e.target.value)}>
              <option value="">Not in this file</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
    </div>
  );
}
