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
    version: "1.2.0",
    date: "2026-09-27",
    headline: "About this wine, your year in wine, what is in each bin, and merging duplicates.",
    changes: [
      "About this wine: with an AI key, get a short profile of any wine, with food pairings and serving tips.",
      "Stats has a Year in wine recap: bottles bought and drunk, money spent, and your top wines.",
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
