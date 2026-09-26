import { GlassWater, NotebookPen } from "lucide-react";
import { Link } from "react-router";
import { Card } from "../../components/ui/Card";
import { StarRating } from "../../components/ui/StarRating";
import { bottles } from "../../domain/labels";
import type { WineDetail } from "../../domain/selectors";
import { formatDate } from "../../lib/format";

type Entry =
  | {
      kind: "drink";
      id: string;
      date: string;
      createdAt: string;
      detail: WineDetail["consumptions"][number];
    }
  | {
      kind: "note";
      id: string;
      date: string;
      createdAt: string;
      detail: WineDetail["notes"][number];
    };

/** Drinks (with the notes written for them) and tasting notes, newest first (R3, KTD9). */
export function TastingHistory({ detail }: { detail: WineDetail }) {
  const notesByDrink = new Map(
    detail.notes.filter((n) => n.consumptionId).map((n) => [n.consumptionId, n]),
  );
  const entries: Entry[] = [
    ...detail.consumptions.map((c) => ({
      kind: "drink" as const,
      id: c.id,
      date: c.date,
      createdAt: c.createdAt,
      detail: c,
    })),
    ...detail.notes
      .filter((n) => !n.consumptionId || !detail.consumptions.some((c) => c.id === n.consumptionId))
      .map((n) => ({
        kind: "note" as const,
        id: n.id,
        date: n.date,
        createdAt: n.createdAt,
        detail: n,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  return (
    <Card padding="lg">
      <h2 className="mb-4 text-xl font-semibold">Drinks and notes</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-subtle">
          Nothing yet. Notes you write when you drink a bottle appear here.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {entries.map((entry) => {
            const note = entry.kind === "drink" ? notesByDrink.get(entry.id) : entry.detail;
            const rating = entry.detail.rating;
            return (
              <li key={entry.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted [&_svg]:size-4"
                >
                  {entry.kind === "drink" ? <GlassWater /> : <NotebookPen />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-medium text-ink">
                      {entry.kind === "drink"
                        ? `Drank ${bottles(entry.detail.quantity)}${entry.detail.occasion ? ` · ${entry.detail.occasion}` : ""}`
                        : "Tasting note"}
                    </p>
                    {rating !== null && <StarRating value={rating} size="sm" />}
                    <time dateTime={entry.date} className="ml-auto text-sm text-ink-subtle">
                      {formatDate(entry.date)}
                    </time>
                  </div>
                  {note && <p className="mt-1 whitespace-pre-line text-ink-muted">{note.text}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/** Recent changes to this wine, with a way into History for undo. */
export function WineActivity({ detail }: { detail: WineDetail }) {
  const recent = detail.history.slice(0, 6);
  if (recent.length === 0) return null;
  return (
    <Card padding="lg">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Activity</h2>
        <Link to="/history" className="text-sm font-medium text-primary hover:underline">
          All history
        </Link>
      </div>
      <ol className="flex flex-col gap-2 text-sm">
        {recent.map((batch) => (
          <li key={batch.id} className="flex gap-3">
            <time dateTime={batch.createdAt} className="w-24 shrink-0 text-ink-subtle">
              {formatDate(batch.createdAt)}
            </time>
            <span className={batch.undoneAt ? "text-ink-subtle line-through" : "text-ink-muted"}>
              {batch.summary}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
