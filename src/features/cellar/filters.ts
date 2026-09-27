import type { CellarQuery, CellarSort } from "../../domain/selectors";
import { COLOURS, type Colour } from "../../domain/types";
import { WINDOW_STATUSES, type WindowStatus } from "../../domain/window";

/**
 * Cellar filters as they live in the URL (so Home can link to `/cellar?status=none` and the back
 * button keeps them). Lists are comma-separated: `?colour=red,white&status=ready`.
 */
export interface CellarFilters {
  q: string;
  colours: Colour[];
  statuses: WindowStatus[];
  locations: string[];
  countries: string[];
  regions: string[];
  /** Show only wines with a bottle drunk, even with bottles left, or with none left (R3). */
  drunk: boolean;
  sort: CellarSort;
}

export const SORTS: { value: CellarSort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "vintage", label: "Vintage, oldest first" },
  { value: "window", label: "Drink first" },
  { value: "recent", label: "Recently added" },
  { value: "bottles", label: "Most bottles" },
  { value: "cost", label: "Cost per bottle, highest first" },
  { value: "value", label: "Your value, highest first" },
];

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (value: string): value is T =>
    (values as readonly string[]).includes(value);

function readList(params: URLSearchParams, key: string): string[] {
  const values = params
    .getAll(key)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

export function readFilters(params: URLSearchParams): CellarFilters {
  const sort = params.get("sort") ?? "";
  return {
    q: params.get("q") ?? "",
    colours: readList(params, "colour").filter(isOneOf(COLOURS)),
    statuses: readList(params, "status").filter(isOneOf(WINDOW_STATUSES)),
    locations: readList(params, "location"),
    countries: readList(params, "country"),
    regions: readList(params, "region"),
    drunk: params.get("drunk") === "1",
    sort: isOneOf(SORTS.map((s) => s.value))(sort) ? sort : "name",
  };
}

export function writeFilters(filters: CellarFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q);
  const lists: [string, string[]][] = [
    ["status", filters.statuses],
    ["colour", filters.colours],
    ["location", filters.locations],
    ["country", filters.countries],
    ["region", filters.regions],
  ];
  for (const [key, values] of lists) if (values.length) params.set(key, values.join(","));
  if (filters.drunk) params.set("drunk", "1");
  if (filters.sort !== "name") params.set("sort", filters.sort);
  return params;
}

/**
 * The selector query. "Ready" also shows Drink soon wines: they are ready to drink too, just
 * with less time left.
 */
export function toCellarQuery(filters: CellarFilters): CellarQuery {
  const statuses =
    filters.statuses.includes("ready") && !filters.statuses.includes("drink-soon")
      ? [...filters.statuses, "drink-soon" as const]
      : filters.statuses;
  return {
    search: filters.q,
    colours: filters.colours,
    statuses,
    locationIds: filters.locations,
    countries: filters.countries,
    regions: filters.regions,
    drunkOnly: filters.drunk,
    sort: filters.sort,
  };
}

/** Number of active filters, not counting search, sort, or the Drunk view. */
export function activeFilterCount(filters: CellarFilters): number {
  return (
    filters.colours.length +
    filters.statuses.length +
    filters.locations.length +
    filters.countries.length +
    filters.regions.length
  );
}

export function toggle<T>(list: T[], value: T, on: boolean): T[] {
  return on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value);
}
