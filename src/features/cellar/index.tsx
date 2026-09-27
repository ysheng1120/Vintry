import { Plus, Search, SlidersHorizontal, Wine, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { buttonClasses } from "../../components/ui/buttonStyles";
import { FilterChip } from "../../components/ui/Chip";
import { ColorDot } from "../../components/ui/ColorDot";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { CELLAR_SEARCH_ID } from "../../app/useKeyboardShortcuts";
import { loadSampleCellar } from "../../domain/commands";
import { bottles } from "../../domain/labels";
import {
  filterCellarRows,
  useCellarList,
  useLocations,
  type CellarRow,
  type CellarSort,
} from "../../domain/selectors";
import { COLOUR_LABELS, COLOURS } from "../../domain/types";
import { WINDOW_STATUS_LABELS, type WindowStatus } from "../../domain/window";
import { pluralize } from "../../lib/format";
import { useCommandFeedback } from "./feedback";
import {
  activeFilterCount,
  readFilters,
  SORTS,
  toCellarQuery,
  toggle,
  writeFilters,
  type CellarFilters,
} from "./filters";
import BulkEstimate, { BulkEstimateButton } from "../wine/BulkEstimate";
import { PrintableCellarTable, PrintListButton } from "./PrintList";
import { StatusBadge } from "./StatusBadge";

const STATUS_CHIPS: WindowStatus[] = ["ready", "drink-soon", "hold", "past-peak", "none"];

/** Search written by this page carries this state, so typing is not undone by the URL sync. */
const FROM_SEARCH = { cellarSearch: true };

/** The cellar list (R3, R5): search, filters and sort, all kept in the URL. */
export default function CellarPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const filters = readFilters(params);
  const allRows = useCellarList({ includeDrunk: true });
  const locations = useLocations();
  const { done, failed } = useCommandFeedback();

  // The search box updates at once; the URL follows. Navigation from elsewhere resets it.
  const [search, setSearch] = useState(filters.q);
  const [syncedKey, setSyncedKey] = useState(location.key);
  if (syncedKey !== location.key) {
    setSyncedKey(location.key);
    const state = location.state as typeof FROM_SEARCH | null;
    if (!state?.cellarSearch && filters.q !== search) setSearch(filters.q);
  }

  const [moreOpen, setMoreOpen] = useState(
    filters.locations.length + filters.countries.length + filters.regions.length > 0,
  );
  const [loadingSample, setLoadingSample] = useState(false);

  const apply = (next: Partial<CellarFilters>) =>
    setParams(writeFilters({ ...filters, q: search, ...next }), { replace: true });

  const onSearch = (value: string) => {
    setSearch(value);
    setParams(writeFilters({ ...filters, q: value }), { replace: true, state: FROM_SEARCH });
  };

  const clearAll = () => {
    setSearch("");
    setParams(writeFilters({ ...readFilters(new URLSearchParams()), drunk: filters.drunk }), {
      replace: true,
    });
  };

  const view = useMemo(() => {
    if (!allRows) return undefined;
    const current = { ...filters, q: search };
    // Rows in this view (in the cellar, or drunk) before other filters: the chip counts.
    const base = filterCellarRows(allRows, { drunkOnly: current.drunk });
    const visible = filterCellarRows(allRows, toCellarQuery(current));
    const drunkCount = allRows.filter((r) => r.bottles === 0).length;
    return { base, visible, drunkCount };
    // `filters` is derived from `params`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, params, search]);

  const loadSample = async () => {
    setLoadingSample(true);
    try {
      done(await loadSampleCellar());
    } catch (error) {
      failed(error, "Couldn't load the sample cellar");
    } finally {
      setLoadingSample(false);
    }
  };

  const header = (
    <PageHeader
      title="Cellar"
      className="print:hidden"
      actions={
        <>
          <BulkEstimateButton />
          {allRows && allRows.length > 0 && <PrintListButton />}
          <Link to="/add" className={buttonClasses({ variant: "primary" })}>
            <Plus aria-hidden="true" className="size-4" />
            Add wine
          </Link>
        </>
      }
    />
  );

  if (!view) {
    return (
      <>
        {header}
        <div aria-busy="true" aria-label="Loading your cellar" className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (allRows?.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<Wine />}
          title="Your cellar is empty"
          description="Add your first bottle, or explore Vintry with a sample cellar you can clear in one tap."
          action={
            <>
              <Link to="/add" className={buttonClasses({ variant: "primary" })}>
                Add a wine
              </Link>
              <Button variant="secondary" loading={loadingSample} onClick={() => void loadSample()}>
                Load the sample cellar
              </Button>
            </>
          }
        />
      </>
    );
  }

  const { base, visible, drunkCount } = view;
  const filtered = activeFilterCount(filters) > 0 || search.trim() !== "";
  const noun = filters.drunk ? "drunk wine" : "wine";
  const summary = filtered
    ? `${visible.length} of ${pluralize(base.length, noun)}`
    : pluralize(base.length, noun);
  const bottleTotal = visible.reduce((sum, r) => sum + r.bottles, 0);

  const statusCount = (status: WindowStatus) =>
    base.filter((r) => r.status === status || (status === "ready" && r.status === "drink-soon"))
      .length;
  const colours = COLOURS.filter((c) => base.some((r) => r.wine.colour === c));
  const countOf = (pick: (r: CellarRow) => string[]) => {
    const counts = new Map<string, number>();
    for (const row of base) for (const v of pick(row)) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
  };
  const byLocation = countOf((r) => r.locationIds);
  const byCountry = countOf((r) => (r.wine.country ? [r.wine.country] : []));
  const byRegion = countOf((r) => (r.wine.region ? [r.wine.region] : []));
  const sortedKeys = (counts: Map<string, number>) =>
    [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const moreCount = filters.locations.length + filters.countries.length + filters.regions.length;

  return (
    <>
      {header}
      <div className="print:hidden">
        <BulkEstimate />

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="relative min-w-60 flex-1">
            <label htmlFor={CELLAR_SEARCH_ID} className="sr-only">
              Search your cellar
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
            />
            <input
              id={CELLAR_SEARCH_ID}
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search producer, wine, region, grape…"
              aria-keyshortcuts="/"
              autoComplete="off"
              className="min-h-11 w-full rounded-xl border border-border-strong bg-surface py-2 pr-3 pl-9 text-[0.95rem] text-ink placeholder:text-ink-subtle hover:border-ink-subtle focus:border-primary focus:outline-2 focus:outline-offset-0 focus:outline-ring/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="cellar-sort" className="text-sm font-medium text-ink-muted">
              Sort
            </label>
            <Select
              id="cellar-sort"
              value={filters.sort}
              onChange={(e) => apply({ sort: e.target.value as CellarSort })}
              className="w-48"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mb-3 flex flex-col gap-2">
          <ChipRow label="Drinking window">
            {STATUS_CHIPS.map((status) => (
              <FilterChip
                key={status}
                selected={filters.statuses.includes(status)}
                onToggle={(on) => apply({ statuses: toggle(filters.statuses, status, on) })}
                count={statusCount(status)}
              >
                {WINDOW_STATUS_LABELS[status]}
              </FilterChip>
            ))}
            <FilterChip
              selected={filters.drunk}
              onToggle={(on) => apply({ drunk: on })}
              count={drunkCount}
            >
              Drunk
            </FilterChip>
          </ChipRow>
          {colours.length > 1 || filters.colours.length > 0 ? (
            <ChipRow label="Colour">
              {colours.map((colour) => (
                <FilterChip
                  key={colour}
                  selected={filters.colours.includes(colour)}
                  onToggle={(on) => apply({ colours: toggle(filters.colours, colour, on) })}
                  icon={<ColorDot color={colour} decorative />}
                  count={base.filter((r) => r.wine.colour === colour).length}
                >
                  {COLOUR_LABELS[colour]}
                </FilterChip>
              ))}
            </ChipRow>
          ) : null}
          <div>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={moreOpen}
              aria-controls="cellar-more-filters"
              icon={<SlidersHorizontal aria-hidden="true" className="size-4" />}
              onClick={() => setMoreOpen((open) => !open)}
            >
              {moreOpen ? "Fewer filters" : "Location, country, region"}
              {moreCount > 0 && <Badge tone="primary">{moreCount}</Badge>}
            </Button>
          </div>
          {moreOpen && (
            <div id="cellar-more-filters" className="flex flex-col gap-2">
              <ChipRow label="Location">
                {(locations ?? []).length === 0 && (
                  <span className="text-sm text-ink-subtle">No locations yet.</span>
                )}
                {(locations ?? []).map((loc) => (
                  <FilterChip
                    key={loc.id}
                    selected={filters.locations.includes(loc.id)}
                    onToggle={(on) => apply({ locations: toggle(filters.locations, loc.id, on) })}
                    count={byLocation.get(loc.id) ?? 0}
                  >
                    {loc.name}
                  </FilterChip>
                ))}
              </ChipRow>
              <ChipRow label="Country">
                {sortedKeys(byCountry).map((country) => (
                  <FilterChip
                    key={country}
                    selected={filters.countries.includes(country)}
                    onToggle={(on) => apply({ countries: toggle(filters.countries, country, on) })}
                    count={byCountry.get(country)}
                  >
                    {country}
                  </FilterChip>
                ))}
              </ChipRow>
              <ChipRow label="Region">
                {sortedKeys(byRegion).map((region) => (
                  <FilterChip
                    key={region}
                    selected={filters.regions.includes(region)}
                    onToggle={(on) => apply({ regions: toggle(filters.regions, region, on) })}
                    count={byRegion.get(region)}
                  >
                    {region}
                  </FilterChip>
                ))}
              </ChipRow>
            </div>
          )}
        </div>

        <div className="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm text-ink-muted">
            <span className="font-medium text-ink">{summary}</span>
            {!filters.drunk && ` · ${bottles(bottleTotal)}`}
          </p>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              icon={<X aria-hidden="true" className="size-4" />}
              onClick={clearAll}
            >
              Clear filters
            </Button>
          )}
        </div>

        {visible.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Search />}
              title="No wines match"
              description="Try another word, or clear the filters to see everything."
              action={<Button onClick={clearAll}>Clear filters</Button>}
            />
          ) : filters.drunk ? (
            <EmptyState
              icon={<Wine />}
              title="Nothing drunk yet"
              description="When you drink the last bottle of a wine, it moves here with its notes."
            />
          ) : (
            <EmptyState
              icon={<Wine />}
              title="No bottles left"
              description="Every wine here has been drunk. You'll find them under Drunk."
              action={
                <Link to="/add" className={buttonClasses({ variant: "primary" })}>
                  Add a wine
                </Link>
              }
            />
          )
        ) : (
          <ul aria-label="Wines" className="flex flex-col gap-2">
            {visible.map((row) => (
              <li key={row.wine.id}>
                <CellarRowLink row={row} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <PrintableCellarTable rows={visible} />
    </>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {children}
    </div>
  );
}

function CellarRowLink({ row }: { row: CellarRow }) {
  const { wine } = row;
  const place = [wine.region, wine.country].filter(Boolean).join(", ");
  const meta = [place, row.locationNames.join(", ")].filter(Boolean).join(" · ");
  return (
    <Link
      to={`/wine/${wine.id}`}
      className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ColorDot color={wine.colour} />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-semibold text-ink">{wine.producer}</span>
          {wine.name && <span className="text-ink-muted"> {wine.name}</span>}
        </p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-ink-subtle">
          <StatusBadge status={row.status} />
          {wine.windowSource === "ai" && (
            <Badge tone="accent" title="Drinking window estimated by AI">
              AI
            </Badge>
          )}
          {wine.isSample && <Badge>Sample</Badge>}
          {meta && <span className="min-w-0 truncate">{meta}</span>}
        </div>
      </div>
      <span className="w-12 shrink-0 text-right font-display text-lg text-ink tabular-nums">
        {wine.vintage ?? "NV"}
      </span>
      <span className="w-20 shrink-0 text-right tabular-nums">
        <span className="font-semibold text-ink">{row.bottles}</span>{" "}
        <span className="text-sm text-ink-muted">{row.bottles === 1 ? "bottle" : "bottles"}</span>
      </span>
    </Link>
  );
}
