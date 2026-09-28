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
import { db } from "../../db/db";
import { createLocation, importRows } from "../../domain/commands";
import { normalizeName } from "../../domain/match";
import { useLocations } from "../../domain/selectors";
import { parseCsvFile } from "../../lib/csv";
import { errorMessage, useCommandFeedback } from "../../app/commandFeedback";
import { NEW_LOCATION } from "../add/draft";
import {
  draftsToImport,
  leftOutRowIndexes,
  planImportRows,
  rowPlanLabel,
  type ExistingCellar,
  type RowPlan,
} from "./duplicates";
import { MappingEditor } from "./MappingEditor";
import { detectImportSource, presetMapping, type CsvMapping, type ImportSourceId } from "./presets";
import { buildImportRows, type ImportPreview } from "./rows";

type Step = "file" | "mapping" | "defaults" | "preview" | "done";

interface ParsedFile {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

const ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

/**
 * Stands in for a default location the collector typed but Vintry doesn't have yet, while
 * planning the preview: rows put there can't match bottles already in the cellar.
 */
const NEW_DEFAULT_LOCATION = "new-default-location";

function describeWineForRow(draft: NonNullable<ImportPreview["rows"][number]["draft"]>): string {
  const year = draft.vintage == null ? "NV" : String(draft.vintage);
  return [draft.producer, draft.name, year].filter(Boolean).join(" ");
}

/** The new locations that the given rows put bottles in: rows left out create none. */
function newLocationsUsedBy(
  rows: { draft: ImportPreview["rows"][number]["draft"] }[],
  newLocations: ImportPreview["newLocations"],
): ImportPreview["newLocations"] {
  const used = new Set(rows.flatMap((row) => row.draft?.lots?.map((lot) => lot.locationId) ?? []));
  return newLocations.filter((location) => used.has(location.id));
}

function locationLabel(
  draft: NonNullable<ImportPreview["rows"][number]["draft"]>,
  names: Map<string, string>,
): string {
  const lot = draft.lots?.[0];
  const name = lot?.locationId ? (names.get(lot.locationId) ?? "Unknown location") : "No location";
  return lot?.bin ? `${name} · ${lot.bin}` : name;
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
  const [plans, setPlans] = useState<Map<number, RowPlan>>(new Map());
  const [includedDuplicates, setIncludedDuplicates] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const duplicateRowIndexes = leftOutRowIndexes(plans);
  const duplicateCount = duplicateRowIndexes.size;
  const includedLeftOut = [...duplicateRowIndexes].filter((i) => includedDuplicates.has(i));
  // "Looks already imported" only when every row that would otherwise be added is a duplicate.
  const allRowsDuplicate =
    !!preview && preview.drafts.length > 0 && duplicateCount === preview.drafts.length;
  const topUpCount = [...plans].filter(
    ([rowIndex, plan]) => plan.kind === "topUp" && !includedDuplicates.has(rowIndex),
  ).length;
  const locationNames = new Map([
    ...(locations ?? []).map((l) => [l.id, l.name] as const),
    ...(preview?.newLocations ?? []).map((l) => [l.id, l.name] as const),
  ]);
  const rowsToImport = preview ? draftsToImport(preview.rows, plans, includedDuplicates) : [];
  const willImportCount = rowsToImport.length;
  const locationsToCreate = newLocationsUsedBy(rowsToImport, preview?.newLocations ?? []);

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

  /** The live cellar a preview checks rows against, so a re-import of the same rows can be spotted. */
  async function loadExistingCellar(): Promise<ExistingCellar> {
    const [wines, lots] = await Promise.all([db.wines.toArray(), db.lots.toArray()]);
    return { wines, lots, locations: locations?.map((l) => ({ id: l.id, name: l.name })) ?? [] };
  }

  /**
   * The default location rows with none of their own will go to on import: the chosen one, or,
   * for a typed new name, the existing location with that name, else a new one.
   */
  function defaultLocationForImport(): string | null {
    if (locationMode === "existing") return existingLocationId || null;
    const name = newLocationName.trim();
    if (!name) return null;
    const existing = locations?.find((l) => normalizeName(l.name) === normalizeName(name));
    return existing?.id ?? NEW_DEFAULT_LOCATION;
  }

  async function buildPreview(defaultLocationId: string | null) {
    if (!parsed) return;
    const options = {
      source,
      mapping,
      defaultCurrency: currency.trim().toUpperCase() || null,
      locations: locations?.map((l) => ({ id: l.id, name: l.name })),
    };
    const built = buildImportRows(parsed.rows, { ...options, defaultLocationId });
    // Compare with the cellar where the bottles will really go, so a new default location
    // (which has no bottles yet) never matches bottles already in the cellar.
    const planDefault = defaultLocationForImport();
    const planned =
      planDefault === defaultLocationId
        ? built
        : buildImportRows(parsed.rows, { ...options, defaultLocationId: planDefault });
    const cellar = await loadExistingCellar();
    setPreview(built);
    // A CellarTracker export lists the whole cellar, so its counts can be compared with Vintry's.
    setPlans(planImportRows(planned.rows, cellar, { compareCounts: source === "cellartracker" }));
    setIncludedDuplicates(new Set());
    setStep("preview");
  }

  function goToPreview() {
    void buildPreview(locationMode === "existing" ? existingLocationId || null : null);
  }

  function toggleIncluded(rowIndex: number, include: boolean) {
    setIncludedDuplicates((current) => {
      const next = new Set(current);
      if (include) next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
  }

  function includeAllDuplicates() {
    setIncludedDuplicates((current) => new Set([...current, ...duplicateRowIndexes]));
  }

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setImportError(null);
    try {
      let locationId = locationMode === "existing" ? existingLocationId || null : null;
      if (locationMode === "new" && newLocationName.trim()) {
        const name = newLocationName.trim();
        // Reuse a location whose name already matches (case- and accent-insensitively), the way
        // resolveLotLocation does for the Add flow: a retry after a failed import, or simply
        // typing a name that already exists, must not hit the "already exists" refusal.
        const existing = locations?.find((l) => normalizeName(l.name) === normalizeName(name));
        if (existing) {
          locationId = existing.id;
        } else {
          const created = await createLocation({ name });
          locationId = created.touched.locationIds[0] ?? null;
        }
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
      const kept = draftsToImport(finalPreview.rows, plans, includedDuplicates);
      if (kept.length === 0) {
        setImportError("Nothing to import: every row already looks like it's in your cellar.");
        return;
      }
      const result = await importRows({
        rows: kept.map((k) => k.draft),
        newLocations: newLocationsUsedBy(kept, finalPreview.newLocations),
      });
      const leftOut = [...duplicateRowIndexes].filter((i) => !includedDuplicates.has(i)).length;
      setSummary(result.summary);
      setStep("done");
      done(result, {
        description: [
          finalPreview.skippedCount > 0 && `${finalPreview.skippedCount} rows were skipped.`,
          leftOut > 0 && `${leftOut} rows already in your cellar were left out.`,
        ]
          .filter(Boolean)
          .join(" "),
      });
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
    setPlans(new Map());
    setIncludedDuplicates(new Set());
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
          {duplicateCount > 0 && (
            <div className="space-y-2 rounded-xl border border-warning-soft bg-warning-soft/40 p-4 text-sm text-ink">
              <p>
                {allRowsDuplicate ? (
                  "This file looks already imported."
                ) : (
                  <>
                    {duplicateCount} of {preview.rows.length}{" "}
                    {preview.rows.length === 1 ? "row" : "rows"} look already in your cellar.
                  </>
                )}{" "}
                They are left out.{" "}
                <button
                  type="button"
                  onClick={includeAllDuplicates}
                  disabled={includedLeftOut.length === duplicateCount}
                  className="font-medium text-primary underline underline-offset-2 disabled:cursor-not-allowed disabled:text-ink-subtle disabled:no-underline"
                >
                  Include them anyway
                </button>
              </p>
            </div>
          )}
          {topUpCount > 0 && (
            <p className="rounded-xl border border-border bg-surface-muted/60 p-4 text-sm text-ink">
              {topUpCount === 1
                ? "1 row has more bottles than your cellar. Only the new ones are added."
                : `${topUpCount} rows have more bottles than your cellar. Only the new ones are added.`}
            </p>
          )}
          {locationsToCreate.length > 0 && (
            <div className="space-y-1 rounded-xl border border-border bg-surface-muted/60 p-4 text-sm text-ink">
              <p className="font-medium">
                {locationsToCreate.length === 1
                  ? "1 new location will be created:"
                  : `${locationsToCreate.length} new locations will be created:`}
              </p>
              <p className="text-ink-muted">{locationsToCreate.map((l) => l.name).join(", ")}</p>
            </div>
          )}
          <p className="text-lg font-medium text-ink">
            {willImportCount} {willImportCount === 1 ? "wine" : "wines"} will be imported
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
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                  <th className="px-3 py-2 font-medium">Include anyway</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 20).map((row) => {
                  const plan = plans.get(row.rowIndex);
                  const isDuplicate = duplicateRowIndexes.has(row.rowIndex);
                  const isTopUp = plan?.kind === "topUp";
                  const planLabel = rowPlanLabel(plan);
                  return (
                    <tr
                      key={row.rowIndex}
                      className={
                        !row.draft
                          ? "bg-danger-soft/40"
                          : isDuplicate
                            ? "bg-warning-soft/20"
                            : undefined
                      }
                    >
                      <td className="px-3 py-2 tabular-nums text-ink-subtle">{row.rowIndex + 1}</td>
                      <td className="px-3 py-2">
                        {row.draft ? describeWineForRow(row.draft) : "(skipped)"}
                        {planLabel && (
                          <Badge tone={isTopUp ? "info" : "warning"} className="ml-2">
                            {planLabel}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {row.draft?.lots?.[0]?.quantity ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.draft ? locationLabel(row.draft, locationNames) : "—"}
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
                      <td className="px-3 py-2">
                        {(isDuplicate || isTopUp) && (
                          <input
                            type="checkbox"
                            checked={includedDuplicates.has(row.rowIndex)}
                            onChange={(e) => toggleIncluded(row.rowIndex, e.target.checked)}
                            className="size-4 accent-primary"
                            aria-label={
                              isTopUp
                                ? `Import all of row ${row.rowIndex + 1} anyway`
                                : `Include row ${row.rowIndex + 1} anyway`
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
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
              disabled={willImportCount === 0}
            >
              Import {willImportCount} {willImportCount === 1 ? "wine" : "wines"}
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
