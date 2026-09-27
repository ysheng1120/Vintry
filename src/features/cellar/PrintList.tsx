import { Printer } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { CellarRow } from "../../domain/selectors";
import { COLOUR_LABELS } from "../../domain/types";
import { printListTitle, windowRangeLabel } from "./printList";

/** Opens the browser print dialog for the current filtered list (R-print). */
export function PrintListButton() {
  return (
    <Button
      variant="secondary"
      icon={<Printer aria-hidden="true" className="size-4" />}
      onClick={() => window.print()}
    >
      Print list
    </Button>
  );
}

/**
 * A plain table of the current filtered rows, hidden on screen and shown only when printing (the
 * print stylesheet in src/styles/index.css hides everything else). Columns: Wine, Vintage,
 * Colour, Region, Location/bin, Bottles, Window.
 */
export function PrintableCellarTable({ rows }: { rows: CellarRow[] }) {
  return (
    <div className="hidden print:block">
      <h2 className="mb-4 text-lg font-semibold text-black">{printListTitle(rows)}</h2>
      <table className="w-full border-collapse text-sm text-black">
        <thead>
          <tr>
            <th className="border-b border-black py-1 text-left">Wine</th>
            <th className="border-b border-black py-1 text-left">Vintage</th>
            <th className="border-b border-black py-1 text-left">Colour</th>
            <th className="border-b border-black py-1 text-left">Region</th>
            <th className="border-b border-black py-1 text-left">Location/bin</th>
            <th className="border-b border-black py-1 text-right">Bottles</th>
            <th className="border-b border-black py-1 text-left">Window</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { wine } = row;
            const region = [wine.region, wine.country].filter(Boolean).join(", ");
            return (
              <tr key={wine.id} className="print-row">
                <td className="border-b border-black/20 py-1">
                  {[wine.producer, wine.name].filter(Boolean).join(" ")}
                </td>
                <td className="border-b border-black/20 py-1">{wine.vintage ?? "NV"}</td>
                <td className="border-b border-black/20 py-1">{COLOUR_LABELS[wine.colour]}</td>
                <td className="border-b border-black/20 py-1">{region || "—"}</td>
                <td className="border-b border-black/20 py-1">
                  {row.locationNames.join(", ") || "—"}
                </td>
                <td className="border-b border-black/20 py-1 text-right">{row.bottles}</td>
                <td className="border-b border-black/20 py-1">{windowRangeLabel(wine)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
