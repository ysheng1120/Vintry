import clsx from "clsx";
import { Link } from "react-router";
import { Badge } from "../../components/ui/Badge";
import { ColorDot } from "../../components/ui/ColorDot";
import { bottles, wineLabel } from "../../domain/labels";
import type { CellarRow } from "../../domain/selectors";
import { WINDOW_STATUS_LABELS } from "../../domain/window";
import { badgeToneForStatus } from "./statusTone";

/** A compact card for one wine, used across Home's sections. */
export function WineCard({ row, className }: { row: CellarRow; className?: string }) {
  return (
    <Link
      to={`/wine/${row.wine.id}`}
      className={clsx(
        "flex h-full flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card",
        "transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-ink-subtle">
        <ColorDot color={row.wine.colour} />
        <span className="truncate">{row.wine.country ?? row.locationNames[0] ?? "Cellar"}</span>
      </div>
      <p className="min-w-0 flex-1 font-display font-semibold text-ink">{wineLabel(row.wine)}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink-muted">{bottles(row.bottles)}</span>
        <Badge tone={badgeToneForStatus(row.status)}>{WINDOW_STATUS_LABELS[row.status]}</Badge>
      </div>
    </Link>
  );
}
