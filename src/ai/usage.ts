import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { now, nowIso } from "../domain/clock";
import type { AiUsage } from "../domain/types";
import { newId } from "../lib/id";
import { estimateCostUsd, roundUsd } from "./models";

/** Feature names used in usage rows, with the label Settings shows for each (R19). */
export const FEATURE_LABELS: Record<string, string> = {
  scan: "Label scan",
  describe: "Describe in words",
  window: "Drinking windows",
  note: "Tasting notes",
  profile: "About this wine",
  critics: "What others say",
  // Check price was removed in 1.5.0; kept so older usage rows still show a name.
  price: "Check price",
  csv: "CSV mapping",
  chat: "Sommelier",
  "key-test": "Key checks",
};

export function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

/**
 * One stored request. `costUsd` is null when the served model has no known price, so the UI
 * can say "price unknown" instead of showing a wrong number (KTD3).
 */
export type UsageRow = AiUsage;

export interface UsageInput {
  feature: string;
  /** The model the response reports as served. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export async function recordUsage(input: UsageInput): Promise<UsageRow> {
  const at = nowIso();
  const row: UsageRow = {
    id: newId(),
    createdAt: at,
    updatedAt: at,
    feature: input.feature,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    cacheWriteTokens: input.cacheWriteTokens ?? 0,
    costUsd: estimateCostUsd(input.model, input),
  };
  await db.aiUsage.add(row);
  return row;
}

export async function listUsage(): Promise<UsageRow[]> {
  return db.aiUsage.toArray();
}

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Sum of the known costs. */
  costUsd: number;
  /** Requests whose model had no known price (their cost is not in costUsd). */
  unpricedRequests: number;
}

export interface FeatureUsage extends UsageTotals {
  feature: string;
  label: string;
}

export interface UsagePeriod extends UsageTotals {
  /** Largest cost first, then most requests. */
  byFeature: FeatureUsage[];
}

export interface UsageSummary {
  thisMonth: UsagePeriod;
  allTime: UsagePeriod;
}

function emptyTotals(): UsageTotals {
  return { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedRequests: 0 };
}

function add(totals: UsageTotals, row: UsageRow) {
  totals.requests += 1;
  totals.inputTokens += row.inputTokens + (row.cacheReadTokens ?? 0) + (row.cacheWriteTokens ?? 0);
  totals.outputTokens += row.outputTokens;
  if (row.costUsd === null || row.costUsd === undefined) totals.unpricedRequests += 1;
  else totals.costUsd = roundUsd(totals.costUsd + row.costUsd);
}

function summarizePeriod(rows: UsageRow[]): UsagePeriod {
  const totals = emptyTotals();
  const features = new Map<string, FeatureUsage>();
  for (const row of rows) {
    add(totals, row);
    let feature = features.get(row.feature);
    if (!feature) {
      feature = { feature: row.feature, label: featureLabel(row.feature), ...emptyTotals() };
      features.set(row.feature, feature);
    }
    add(feature, row);
  }
  const byFeature = [...features.values()].sort(
    (a, b) => b.costUsd - a.costUsd || b.requests - a.requests,
  );
  return { ...totals, byFeature };
}

/** Totals for the current calendar month (local time) and for all time, by feature. */
export function summarizeUsage(rows: UsageRow[], reference: Date = now()): UsageSummary {
  const month = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;
  const current = month(reference);
  const thisMonth = rows.filter((row) => month(new Date(row.createdAt)) === current);
  return { thisMonth: summarizePeriod(thisMonth), allTime: summarizePeriod(rows) };
}

/** Live usage summary for Settings; undefined while loading. */
export function useUsageSummary(): UsageSummary | undefined {
  return useLiveQuery(async () => summarizeUsage(await listUsage()), []);
}
