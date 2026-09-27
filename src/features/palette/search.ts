import {
  Camera,
  Compass,
  FileSpreadsheet,
  MessageSquareText,
  Moon,
  PenLine,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { MORE_LINKS, NAV_ITEMS } from "../../app/navItems";
import { resolveTheme, type ThemePreference } from "../../app/theme";
import { bottles, wineLabel } from "../../domain/labels";
import { normalizeName } from "../../domain/match";
import type { CellarRow } from "../../domain/selectors";
import type { Colour } from "../../domain/types";

/** What choosing an item does. Kept as data so the search stays pure and testable. */
export type PaletteRun =
  { kind: "navigate"; to: string } | { kind: "tour" } | { kind: "toggle-theme" };

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  /** Extra words that find this item but are not shown. */
  keywords?: string;
  icon?: LucideIcon;
  /** Wines show their colour instead of an icon. */
  colour?: Colour;
  run: PaletteRun;
}

export interface PaletteGroup {
  id: "pages" | "actions" | "wines";
  heading: string;
  items: PaletteItem[];
}

export const MAX_WINES = 8;

function navItem(id: (typeof NAV_ITEMS)[number]["id"]) {
  const item = NAV_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown nav item ${id}`);
  return item;
}

function page(
  to: string,
  label: string,
  hint: string,
  icon: LucideIcon,
  keywords?: string,
): PaletteItem {
  return { id: `page:${to}`, label, hint, icon, keywords, run: { kind: "navigate", to } };
}

const home = navItem("home");
const cellar = navItem("cellar");
const add = navItem("add");
const sommelier = navItem("sommelier");

const MORE_KEYWORDS: Record<string, string> = {
  "/history": "undo changes log",
  "/wishlist": "buy shopping",
  "/stats": "numbers charts value",
  "/locations": "racks fridges bins storage",
  "/backup": "export save file",
  "/settings": "ai key theme currency preferences",
  "/help": "guide how to faq",
  "/whats-new": "changes release updates",
};

export const PAGES: PaletteItem[] = [
  page(home.to, home.label, "Your cellar at a glance", home.icon, "start dashboard"),
  page(cellar.to, cellar.label, "Every bottle you own", cellar.icon, "wines list browse"),
  page(add.to, add.label, "Scan, describe, or type", add.icon, "new bottle"),
  page("/add/scan", "Scan a label", "Take or upload a photo", Camera, "photo camera add"),
  page("/add/describe", "Describe", "One sentence, and AI fills it in", MessageSquareText, "add"),
  page("/add/manual", "Add by hand", "A short form", PenLine, "manual form"),
  page("/import", "Import", "A CSV from another app", FileSpreadsheet, "csv cellartracker vivino"),
  page(sommelier.to, sommelier.label, "Ask about your wines", sommelier.icon, "chat pairing"),
  ...MORE_LINKS.map((link) =>
    page(link.to, link.label, link.description, link.icon, MORE_KEYWORDS[link.to]),
  ),
];

export const ACTIONS: PaletteItem[] = [
  {
    id: "action:backup",
    label: "Back up now",
    hint: "Save a backup file",
    icon: ShieldCheck,
    keywords: "export",
    run: { kind: "navigate", to: "/backup" },
  },
  {
    id: "action:tour",
    label: "Take the tour",
    hint: "A quick look around Vintry",
    icon: Compass,
    keywords: "guide",
    run: { kind: "tour" },
  },
  {
    id: "action:theme",
    label: "Toggle dark mode",
    hint: "Switch between light and dark",
    icon: Moon,
    keywords: "theme light night",
    run: { kind: "toggle-theme" },
  },
];

function queryWords(query: string): string[] {
  return normalizeName(query).split(" ").filter(Boolean);
}

/** Every word of the query appears in the text, ignoring case, accents and punctuation. */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = normalizeName(text);
  return queryWords(query).every((word) => haystack.includes(word));
}

const itemText = (item: PaletteItem) => `${item.label} ${item.keywords ?? ""}`;

function wineItems(query: string, rows: CellarRow[]): PaletteItem[] {
  const matching = rows.filter((row) => matchesQuery(wineLabel(row.wine), query));
  // Wines with bottles left come first; the list keeps its name order otherwise.
  const ordered = [...matching.filter((r) => r.bottles > 0), ...matching.filter((r) => !r.bottles)];
  return ordered.slice(0, MAX_WINES).map((row) => ({
    id: `wine:${row.wine.id}`,
    label: wineLabel(row.wine),
    hint: row.bottles > 0 ? bottles(row.bottles) : "None left",
    colour: row.wine.colour,
    run: { kind: "navigate", to: `/wine/${row.wine.id}` },
  }));
}

/**
 * Pages, actions and wines matching the query, as non-empty groups. Wines appear only once
 * something is typed, so the empty palette stays a short list of places to go.
 */
export function searchPalette(query: string, rows: CellarRow[]): PaletteGroup[] {
  const hasQuery = queryWords(query).length > 0;
  const groups: PaletteGroup[] = [
    {
      id: "pages",
      heading: "Pages",
      items: PAGES.filter((i) => matchesQuery(itemText(i), query)),
    },
    {
      id: "actions",
      heading: "Actions",
      items: ACTIONS.filter((i) => matchesQuery(itemText(i), query)),
    },
    { id: "wines", heading: "Wines", items: hasQuery ? wineItems(query, rows) : [] },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/**
 * The theme "Toggle dark mode" switches to: always the opposite of what is showing, and back to
 * following the system when the system already gives that look.
 */
export function nextThemeFor(current: ThemePreference, systemDark: boolean): ThemePreference {
  const target = resolveTheme(current, systemDark) === "dark" ? "light" : "dark";
  return resolveTheme("system", systemDark) === target ? "system" : target;
}
