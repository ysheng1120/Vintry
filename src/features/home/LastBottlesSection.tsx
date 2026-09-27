import { Link } from "react-router";
import { ColorDot } from "../../components/ui/ColorDot";
import { StarRating } from "../../components/ui/StarRating";
import { wineLabel } from "../../domain/labels";
import { useLastBottles, type LastBottleRow } from "../../domain/lastBottles";

function LastBottleCard({ row }: { row: LastBottleRow }) {
  return (
    <Link
      to={`/wine/${row.wine.id}`}
      className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card
        transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised"
    >
      <div className="flex items-center gap-2">
        <ColorDot color={row.wine.colour} decorative />
        <StarRating value={row.rating} size="sm" />
      </div>
      <p className="min-w-0 flex-1 font-display font-semibold text-ink">{wineLabel(row.wine)}</p>
      <span className="text-sm font-medium text-primary">Buy again</span>
    </Link>
  );
}

/** Favourites down to their last bottle, so the collector remembers to restock them. */
export function LastBottlesSection() {
  const rows = useLastBottles();
  if (!rows || rows.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold text-ink">Last bottles</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li key={row.wine.id}>
            <LastBottleCard row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}
