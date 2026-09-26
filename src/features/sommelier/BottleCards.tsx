import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { ColorDot } from "../../components/ui/ColorDot";
import { db } from "../../db/db";
import { bottles, wineLabel } from "../../domain/labels";
import type { Wine } from "../../domain/types";
import { windowStatus, type WindowStatus } from "../../domain/window";
import { StatusBadge } from "../cellar/StatusBadge";

interface BottleCardData {
  wine: Wine;
  bottles: number;
  status: WindowStatus;
}

async function loadCards(wineIds: string[]): Promise<BottleCardData[]> {
  const wines = await db.wines.bulkGet(wineIds);
  const lots = await db.lots.where("wineId").anyOf(wineIds).toArray();
  return wines
    .filter((wine): wine is Wine => wine !== undefined && !wine.deletedAt)
    .map((wine) => ({
      wine,
      bottles: lots.filter((l) => l.wineId === wine.id).reduce((sum, l) => sum + l.quantity, 0),
      status: windowStatus(wine),
    }));
}

/**
 * Cards for the wines the sommelier showed, each linking to the wine's page. Ids that do not
 * (or no longer) exist are dropped.
 */
export function BottleCards({ wineIds }: { wineIds: string[] }) {
  const cards = useLiveQuery(() => loadCards(wineIds), [wineIds.join(",")]);
  if (!cards?.length) return null;
  return (
    <ul aria-label="Bottles" className="grid gap-2 sm:grid-cols-2">
      {cards.map(({ wine, bottles: count, status }) => (
        <li key={wine.id}>
          <Link
            to={`/wine/${encodeURIComponent(wine.id)}`}
            className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ColorDot color={wine.colour} decorative />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{wineLabel(wine)}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                {[wine.region, wine.country].filter(Boolean).join(", ") || null}
                <span>{bottles(count)}</span>
                <StatusBadge status={status} />
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
