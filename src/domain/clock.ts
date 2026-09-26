/**
 * The app clock. Timestamps are strictly increasing within a tab, so two writes in the same
 * millisecond still get different `updatedAt` values (undo relies on that, KTD7).
 */
let source: () => number = () => Date.now();
let last = 0;

export function now(): Date {
  let t = source();
  if (t <= last) t = last + 1;
  last = t;
  return new Date(t);
}

export function nowIso(): string {
  return now().toISOString();
}

/** The current calendar year, used by window status. */
export function currentYear(): number {
  return new Date(source()).getFullYear();
}

/** Test hook: pin the clock to a fixed time (or a function). Pass null to restore real time. */
export function setClock(value: Date | string | (() => number) | null): void {
  last = 0;
  if (value === null) source = () => Date.now();
  else if (typeof value === "function") source = value;
  else {
    const t = new Date(value).getTime();
    source = () => t;
  }
}
