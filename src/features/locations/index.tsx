import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, ChevronDown, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { db } from "../../db/db";
import { createLocation, deleteLocation, renameLocation } from "../../domain/commands";
import { bottles } from "../../domain/labels";
import { useLocationsWithCounts, type LocationWithCounts } from "../../domain/selectors";
import { pluralize } from "../../lib/format";
import { errorMessage, useCommandFeedback } from "../../app/commandFeedback";
import { binLabel, countLots, filterBinGroups, groupLotsByBin, type BinGroup } from "./bins";

/** Above this many lots, an expanded location gets a search box to narrow what's shown. */
const SEARCH_THRESHOLD = 12;

/** Where bottles live (R7): add, rename, and delete locations. */
export default function LocationsPage() {
  const rows = useLocationsWithCounts();
  const { done } = useCommandFeedback();
  const [name, setName] = useState("");
  const [addError, setAddError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setAddError("Type a name, for example Kitchen rack");
      return;
    }
    setAdding(true);
    setAddError(undefined);
    try {
      done(await createLocation({ name }));
      setName("");
    } catch (error) {
      setAddError(errorMessage(error));
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <PageHeader title="Locations" subtitle="Racks, fridges, and bins where your bottles live." />

      <Card className="mb-6">
        <form noValidate onSubmit={(e) => void add(e)} className="flex flex-wrap items-start gap-3">
          <Field label="New location" error={addError} className="min-w-56 flex-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="For example EuroCave A"
              autoComplete="off"
            />
          </Field>
          <Button
            type="submit"
            loading={adding}
            icon={<Plus aria-hidden="true" className="size-4" />}
            className="sm:mt-7"
          >
            Add location
          </Button>
        </form>
      </Card>

      {rows === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MapPin />}
          title="No locations yet"
          description="Add places like “Kitchen rack” or “EuroCave A”. You can also create one while adding or moving bottles."
        />
      ) : (
        <ul aria-label="Locations" className="flex flex-col gap-2">
          {rows.map((row) => (
            <LocationRow key={row.location.id} row={row} />
          ))}
        </ul>
      )}
    </>
  );
}

function LocationRow({ row }: { row: LocationWithCounts }) {
  const { location } = row;
  const { done } = useCommandFeedback();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(location.name);
  const [renameError, setRenameError] = useState<string | undefined>();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const contentsId = useId();

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() === location.name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      done(await renameLocation({ locationId: location.id, name: draft }));
      setEditing(false);
      setRenameError(undefined);
    } catch (error) {
      setRenameError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setRefusal(null);
    setBusy(true);
    try {
      done(await deleteLocation({ locationId: location.id }));
    } catch (error) {
      setRefusal(
        row.bottles > 0
          ? `${location.name} still holds ${bottles(row.bottles)} in ${pluralize(row.openLots, "lot")}. Move or drink them first.`
          : errorMessage(error),
      );
      setBusy(false);
    }
  };

  return (
    <li className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"
        >
          <MapPin className="size-5" />
        </span>
        {editing ? (
          <form
            noValidate
            onSubmit={(e) => void rename(e)}
            className="flex min-w-0 flex-1 flex-wrap items-start gap-2"
          >
            <Field
              label={`Name for ${location.name}`}
              hideLabel
              error={renameError}
              className="min-w-48 flex-1"
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(false);
                    setDraft(location.name);
                  }
                }}
              />
            </Field>
            <Button type="submit" size="sm" loading={busy}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setDraft(location.name);
                setRenameError(undefined);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <span className="truncate">{location.name}</span>
                {location.isSample && <Badge>Sample</Badge>}
              </p>
              <p className="text-sm text-ink-muted">
                {row.bottles > 0
                  ? `${bottles(row.bottles)} in ${pluralize(row.openLots, "lot")} · ${pluralize(row.wines, "wine")}`
                  : row.deletedBottles > 0
                    ? "Only bottles of wines in Recently deleted"
                    : "Empty"}
              </p>
            </div>
            {row.bottles > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={expanded}
                  aria-controls={contentsId}
                  icon={
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  }
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? "Hide contents" : "Show contents"}
                </Button>
                <Link
                  to={`/cellar?location=${encodeURIComponent(location.id)}`}
                  className="min-h-10 content-center rounded-xl px-3 text-sm font-medium text-primary hover:bg-primary-soft"
                >
                  View bottles<span className="sr-only"> in {location.name}</span>
                </Link>
              </>
            )}
            <IconButton
              label={`Rename ${location.name}`}
              icon={<Pencil />}
              onClick={() => {
                setDraft(location.name);
                setEditing(true);
              }}
            />
            <IconButton
              label={`Delete ${location.name}`}
              icon={<Trash2 />}
              disabled={busy}
              onClick={() => void remove()}
            />
          </>
        )}
      </div>
      {refusal && (
        <p
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {refusal}
        </p>
      )}
      {expanded && row.bottles > 0 && (
        <div id={contentsId} className="mt-3 border-t border-border pt-3">
          <LocationBins locationId={location.id} />
        </div>
      )}
    </li>
  );
}

/** What's inside a location, grouped by bin (R7). Loads only while expanded. */
function LocationBins({ locationId }: { locationId: string }) {
  const groups = useLiveQuery(async () => {
    const lots = await db.lots.where("locationId").equals(locationId).toArray();
    const here = lots.filter((l) => l.quantity > 0);
    const wines = await db.wines.bulkGet([...new Set(here.map((l) => l.wineId))]);
    const live = new Map(wines.flatMap((w) => (w && !w.deletedAt ? [[w.id, w] as const] : [])));
    return groupLotsByBin(here, live);
  }, [locationId]);
  const [search, setSearch] = useState("");
  const searchId = useId();

  if (groups === undefined) {
    return <Skeleton className="h-12 rounded-xl" />;
  }

  const showSearch = countLots(groups) > SEARCH_THRESHOLD;
  const visible = showSearch ? filterBinGroups(groups, search) : groups;

  return (
    <div className="flex flex-col gap-3">
      {showSearch && (
        <Field label="Find a wine in this location" hideLabel id={searchId} className="max-w-sm">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
            />
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search wines in this location…"
              autoComplete="off"
              className="pl-9"
            />
          </div>
        </Field>
      )}
      {visible.length === 0 ? (
        <p className="text-sm text-ink-muted">No wines match “{search}”.</p>
      ) : (
        visible.map((group) => <BinCard key={group.bin ?? ""} group={group} />)
      )}
    </div>
  );
}

function BinCard({ group }: { group: BinGroup }) {
  return (
    <div className="rounded-xl bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">{binLabel(group.bin)}</h3>
        <span className="text-sm text-ink-muted">{bottles(group.bottles)}</span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {group.rows.map((row) => (
          <li key={row.lotId} className="flex items-center justify-between gap-3 text-sm">
            <Link
              to={`/wine/${row.wineId}`}
              className="min-w-0 truncate text-primary hover:underline"
            >
              {row.label}
            </Link>
            <span className="shrink-0 text-ink-muted">{bottles(row.quantity)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
