/** One coach mark: the `data-tour` anchor it points at, and one short sentence (R29). */
export interface TourStep {
  anchor: string;
  title: string;
  body: string;
}

/** The anchors are on the main navigation items (src/app/navItems.ts), in every layout. */
export const TOUR_STEPS: TourStep[] = [
  {
    anchor: "tour-home",
    title: "Home",
    body: "See what is ready to drink, what to drink soon, and what is past its peak.",
  },
  {
    anchor: "tour-cellar",
    title: "Cellar",
    body: "Search, filter, and sort every bottle you own. Press / to search from anywhere.",
  },
  {
    anchor: "tour-add",
    title: "Add wine",
    body: "Scan a label, type a sentence, fill a short form, or import a file. Press N to start.",
  },
  {
    anchor: "tour-sommelier",
    title: "Sommelier",
    body: "Ask what to open tonight. It suggests only bottles you have.",
  },
  {
    anchor: "tour-more",
    title: "More",
    body: "History with undo, backups, settings, and help live here.",
  },
];
