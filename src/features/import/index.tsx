import { FileSpreadsheet } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { suggestCsvMapping } from "../../ai/features/mapCsv";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { buttonClasses } from "../../components/ui/buttonStyles";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { createLocation, importRows } from "../../domain/commands";
import { useLocations } from "../../domain/selectors";
import { parseCsvFile } from "../../lib/csv";
import { errorMessage, useCommandFeedback } from "../cellar/feedback";
import { MappingEditor } from "./MappingEditor";
import { detectImportSource, presetMapping, type CsvMapping, type ImportSourceId } from "./presets";
import { buildImportRows, type ImportPreview } from "./rows";

type Step = "file" | "mapping" | "defaults" | "preview" | "done";

interface ParsedFile {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

const NEW_LOCATION = "__new__";
const ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

function describeWineForRow(draft: NonNullable<ImportPreview["rows"][number]["draft"]>): string {
  const year = draft.vintage == null ? "NV" : String(draft.vintage);
  return [draft.producer, draft.name, year].filter(Boolean).join(" ");
}

/** CSV import: pick a file, map its columns, set defaults, preview, then import (R20). */
export default function ImportPage() {
  const { done, failed } = useCommandFeedback();
  const locations = useLocations();

  const [step, setStep] = useState<Step>("file");
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [source, setSource] = useState<ImportSourceId>("generic");
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionNotes, setSuggestionNotes] = useState<string[] | undefined>();
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const [locationMode, setLocationMode] = useState<"existing" | "new">("existing");
  const [existingLocationId, setExistingLocationId] = useState("");
  const [newLocationName, setNewLocationName] = useState("");
  const [currency, setCurrency] = useState("GBP");

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setFileError(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["csv", "tsv", "txt"].includes(ext)) {
      setFileError("Choose a .csv, .tsv, or .txt file.");
      return;
    }
    let headers: string[];
    let rows: Record<string, string>[];
    try {
      const buffer = await file.arrayBuffer();
      ({ headers, rows } = parseCsvFile(buffer));
    } catch (error) {
      setFileError(errorMessage(error));
      return;
    }
    if (headers.length === 0 || rows.length === 0) {
      setFileError("That file has no rows Vintry can read.");
      return;
    }
    const detected = detectImportSource(headers);
    setParsed({ fileName: file.name, headers, rows });
    setSource(detected);
    setMapping(presetMapping(detected, headers));
    setSuggestionNotes(undefined);
    setSuggestionError(null);
    setStep("mapping");
  }

  async function handleSuggest() {
    if (!parsed) return;
    setSuggesting(true);
    setSuggestionError(null);
    try {
      const sample = parsed.rows.slice(0, 20).map((row) => parsed.headers.map((h) => row[h] ?? ""));
      const suggestion = await suggestCsvMapping(parsed.headers, sample);
      setMapping((current) => ({ ...current, ...suggestion.mapping }));
      setSuggestionNotes(suggestion.notes);
    } catch (error) {
      setSuggestionError(errorMessage(error));
    } finally {
      setSuggesting(false);
    }
  }

  function goToDefaults() {
    if (!mapping.producer) {
      setSuggestionError('Map a "Producer" column to continue.');
      return;
    }
    setSuggestionError(null);
    setStep("defaults");
  }

  function buildPreview(defaultLocationId: string | null) {
    if (!parsed) return;
    setPreview(
      buildImportRows(parsed.rows, {
        source,
        mapping,
        defaultLocationId,
        defaultCurrency: currency.trim().toUpperCase() || null,
        locations: locations?.map((l) => ({ id: l.id, name: l.name })),
      }),
    );
    setStep("preview");
  }

  function goToPreview() {
    buildPreview(locationMode === "existing" ? existingLocationId || null : null);
  }

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setImportError(null);
    try {
      let locationId = locationMode === "existing" ? existingLocationId || null : null;
      if (locationMode === "new" && newLocationName.trim()) {
        const created = await createLocation({ name: newLocationName.trim() });
        locationId = created.touched.locationIds[0] ?? null;
      }
      const finalPreview = buildImportRows(parsed.rows, {
        source,
        mapping,
        defaultLocationId: locationId,
        defaultCurrency: currency.trim().toUpperCase() || null,
        locations: locations?.map((l) => ({ id: l.id, name: l.name })),
      });
      if (finalPreview.drafts.length === 0) {
        setImportError("Nothing to import: every row is missing a producer.");
        return;
      }
      const result = await importRows({ rows: finalPreview.drafts });
      setSummary(result.summary);
      setStep("done");
      done(result, { description: `${finalPreview.skippedCount} rows were skipped.` });
    } catch (error) {
      setImportError(errorMessage(error));
      failed(error, "Import didn't finish");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStep("file");
    setFileError(null);
    setParsed(null);
    setMapping({});
    setSuggestionNotes(undefined);
    setSuggestionError(null);
    setLocationMode("existing");
    setExistingLocationId("");
    setNewLocationName("");
    setPreview(null);
    setImportError(null);
    setSummary(null);
  }

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Bring in a CSV from CellarTracker, Vivino, or a spreadsheet."
      />

      {step === "file" && (
        <Card padding="lg">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
            className="rounded-2xl border-2 border-dashed border-border-strong bg-surface/60 px-6 py-12 text-center"
          >
            <FileSpreadsheet aria-hidden="true" className="mx-auto mb-4 size-10 text-primary" />
            <p className="font-medium text-ink">Drop a CSV file here, or</p>
            <Button type="button" className="mt-3" onClick={() => fileInputRef.current?.click()}>
              Choose file
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              aria-label="CSV, TSV, or text file to import"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFile(file);
              }}
            />
          </div>
          {fileError && (
            <p role="alert" className="mt-3 text-sm font-medium text-danger">
              {fileError}
            </p>
          )}
        </Card>
      )}

      {step === "mapping" && parsed && (
        <Card padding="lg" className="space-y-6">
          <MappingEditor
            headers={parsed.headers}
            source={source}
            mapping={mapping}
            onChange={setMapping}
            onSuggest={handleSuggest}
            suggesting={suggesting}
            suggestionNotes={suggestionNotes}
            suggestionError={suggestionError}
          />
          <div className="flex justify-between">
            <Button type="button" variant="secondary" onClick={reset}>
              Back
            </Button>
            <Button type="button" onClick={goToDefaults}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === "defaults" && (
        <Card padding="lg" className="space-y-6">
          <Field label="Default location" hint="Used for rows with no location of their own.">
            <Select
              value={locationMode === "new" ? NEW_LOCATION : existingLocationId}
              onChange={(e) => {
                if (e.target.value === NEW_LOCATION) setLocationMode("new");
                else {
                  setLocationMode("existing");
                  setExistingLocationId(e.target.value);
                }
              }}
            >
              <option value="">No default location</option>
              {locations?.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
              <option value={NEW_LOCATION}>Add a new location…</option>
            </Select>
          </Field>
          {locationMode === "new" && (
            <Field label="New location name">
              <Input
                value={newLocationName}
                onChange={(e) => setNewLocationName(e.target.value)}
                placeholder="e.g. Kitchen rack"
              />
            </Field>
          )}
          <Field label="Default currency" hint="Used for rows with no currency of their own.">
            <Input
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>
          <div className="flex justify-between">
            <Button type="button" variant="secondary" onClick={() => setStep("mapping")}>
              Back
            </Button>
            <Button type="button" onClick={goToPreview}>
              Preview import
            </Button>
          </div>
        </Card>
      )}

      {step === "preview" && preview && (
        <Card padding="lg" className="space-y-6">
          <p className="text-lg font-medium text-ink">
            {preview.includedCount} {preview.includedCount === 1 ? "wine" : "wines"} will be added
            {preview.skippedCount > 0 &&
              `, ${preview.skippedCount} ${preview.skippedCount === 1 ? "row" : "rows"} skipped`}
            .
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Wine</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 20).map((row) => (
                  <tr key={row.rowIndex} className={row.draft ? undefined : "bg-danger-soft/40"}>
                    <td className="px-3 py-2 tabular-nums text-ink-subtle">{row.rowIndex + 1}</td>
                    <td className="px-3 py-2">
                      {row.draft ? describeWineForRow(row.draft) : "(skipped)"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.draft?.lots?.[0]?.quantity ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {row.issues.map((issue) => (
                        <Badge
                          key={issue.message}
                          tone={issue.kind === "skipped" ? "danger" : "warning"}
                          className="mr-1 mb-1"
                        >
                          {issue.message}
                        </Badge>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 20 && (
            <p className="text-sm text-ink-subtle">
              Showing the first 20 of {preview.rows.length} rows.
            </p>
          )}
          {importError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {importError}
            </p>
          )}
          <div className="flex justify-between">
            <Button type="button" variant="secondary" onClick={() => setStep("defaults")}>
              Back
            </Button>
            <Button
              type="button"
              onClick={handleImport}
              loading={importing}
              disabled={preview.includedCount === 0}
            >
              Import {preview.includedCount} {preview.includedCount === 1 ? "wine" : "wines"}
            </Button>
          </div>
        </Card>
      )}

      {step === "done" && (
        <Card padding="lg" className="space-y-4 text-center">
          <p className="text-lg font-medium text-ink">{summary}</p>
          <div className="flex justify-center gap-3">
            <Button type="button" variant="secondary" onClick={reset}>
              Import another file
            </Button>
            <Link to="/cellar" className={buttonClasses({ variant: "primary" })}>
              Go to cellar
            </Link>
          </div>
        </Card>
      )}
    </>
  );
}
