import { now } from "../../domain/clock";

const UNITS: [string, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 hours ago", "2 days ago"; "Just now" under a minute. Uses the app clock as "now". */
export function relativeTime(iso: string, reference: Date = now()): string {
  const diff = reference.getTime() - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 60_000) return "Just now";
  for (const [unit, ms] of UNITS) {
    const value = Math.floor(diff / ms);
    if (value >= 1) return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
  }
  return "Just now";
}
