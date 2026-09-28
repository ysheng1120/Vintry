/**
 * Release notes shown on the What's New page (R30, KTD16). Add a new entry at the top for each
 * release, with the same version as package.json. Keep each line short and plain.
 */

export interface ChangelogEntry {
  /** Semantic version, e.g. "1.2.0". */
  version: string;
  /** Release date, YYYY-MM-DD. */
  date: string;
  /** One line that sums up the release. */
  headline: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.6.0",
    date: "2026-09-28",
    headline: "Smarter re-imports, backups kept by day, week and month, and a lighter History.",
    changes: [
      "Import a newer CellarTracker export at any time: Vintry adds only the new bottles, and never adds the same bottles twice.",
      "Automatic backups keep the newest 20, plus the last one of each of the past 14 days, 8 weeks, and 12 months, so a busy day or a second browser can't push out older backups. A backup with no wines is not saved over one that has wines.",
      "History takes far less space: editing a wine no longer stores copies of its label photo. It keeps the last 90 days, and always your latest 500 changes. A wine deleted forever is also wiped from History.",
      "Settings offers Claude Opus 5.5, newer and cheaper than Opus 5. Opus 5 stays the default for now.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-09-27",
    headline: "Safer CellarTracker imports, merges, and restores.",
    changes: [
      "CellarTracker import: Champagne comes in as sparkling, Port as fortified, and sweet wines as dessert. The producer is no longer repeated in the wine name. Rows with bottles only on order are skipped.",
      "A row with 0 bottles is now skipped instead of being imported as 1 bottle.",
      "Merge lists only wines with the same bottle size, so magnums never turn into 750 ml bottles. Cellar rows show sizes other than 750 ml.",
      "A drinking window the sommelier suggests is always marked as an AI estimate, even after you confirm it.",
      "Drink soon now means the window ends this year.",
      "Restore refuses a backup file that is cut short, and shows how many wines and bottles it has before you replace your data.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-27",
    headline: "Suggested price, locations kept on import, and more ways to sort.",
    changes: [
      "Suggested price: with an AI key, see prices for a wine from reputable wine shops and price sites, below What critics say, with a link to each page. It never changes what you paid or your own value.",
      "Importing a file with a location column now puts the bottles in those locations, and creates any location you do not have yet. The preview lists them first.",
      "A wine now shows under Drunk as soon as you drink one bottle, with how many you drank and how many are left.",
      "Sort the cellar by most bottles, cost per bottle, or your own value.",
      "Home shows up to 6 wines in each section, with Show all for the rest.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-09-27",
    headline: "Automatic backups, What critics say, and a guard against double imports.",
    changes: [
      "When you start Vintry with the launcher, it saves a backup to Documents/Vintry Backups after your changes, in every browser. The 30 newest are kept.",
      "What critics say: with an AI key, get a short summary of critics' views from reputable wine sites, with a link to each review. Scores show only when the source shows them.",
      "Importing the same file twice no longer doubles your bottles: rows already in your cellar are left out unless you include them.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-09-27",
    headline: "About this wine, your year in wine, what is in each bin, and merging duplicates.",
    changes: [
      "About this wine: with an AI key, get a short profile of any wine, with food pairings and serving tips.",
      "Scan up to 12 labels at once: choose several photos and check each wine before you save it.",
      "Stats has a Year in wine recap: bottles bought and drunk, money spent, and your top wines.",
      "Stats shows What you like, from your own ratings, and the sommelier uses it when it recommends.",
      "Stats shows what you spent on wine each year.",
      "On Locations, open a location to see its bottles, bin by bin.",
      "Merge two records of the same wine from the wine's page. Bottles, drinks, and notes move over, and you can undo it.",
      "Buy again puts a wine on your wishlist in one click, and Home lists your last bottles of wines you love.",
      "Large cellars open faster: the cellar list shows 100 wines at a time, with Show more.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-09-27",
    headline: "Track what your wines are worth, and ask the sommelier in one tap.",
    changes: [
      "Note what a wine is worth to you, per bottle, in Edit wine. Only you set it; AI never does.",
      "Home shows your cellar value next to what it cost, in each currency.",
      "Wines added by scanning a label now show the label photo on their page.",
      'Home asks "Not sure what to open tonight?" with three quick questions for the sommelier.',
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-26",
    headline: "Vintry's first release.",
    changes: [
      "Keep your cellar on your own computer: wines, bottles, locations, and bins.",
      "Add wine by scanning a label, typing one sentence, filling a short form, or importing a file.",
      "Import from CellarTracker and Vivino, or any CSV file.",
      "Home shows what is ready to drink, what to drink soon, and what is past its peak.",
      "Drinking windows, set by you or estimated by AI and clearly marked.",
      "Ask the sommelier about your own bottles. It suggests changes, and you confirm them.",
      "Undo any change from the toast or from History.",
      "Back up and restore your cellar, with reminders and safety copies.",
      "Wishlist, stats, and a tasting-note helper.",
      "Works offline and without an AI key. Add your own key at any time.",
    ],
  },
];

/** Compares two "major.minor.patch" versions: negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Changelog entries, newest version first. */
export function changelogNewestFirst(
  entries: readonly ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  return [...entries].sort((a, b) => compareVersions(b.version, a.version));
}

/** The entry for a version, if the changelog has one. */
export function changelogEntry(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((entry) => entry.version === version);
}
