import { ArrowRightLeft, GlassWater, MapPin } from "lucide-react";
import { Link } from "react-router";
import { buttonClasses } from "../../components/ui/buttonStyles";
import { Card } from "../../components/ui/Card";
import { IconButton } from "../../components/ui/IconButton";
import { bottles } from "../../domain/labels";
import { formatMoney } from "../../domain/money";
import type { LotWithLocation, WineDetail } from "../../domain/selectors";
import { formatDate } from "../../lib/format";

interface Group {
  key: string;
  name: string;
  lots: LotWithLocation[];
}

/** Open lots grouped by location, "No location" last. */
function groupLots(lots: LotWithLocation[]): Group[] {
  const groups = new Map<string, Group>();
  for (const lot of lots) {
    const key = lot.locationId ?? "";
    const group = groups.get(key) ?? { key, name: lot.locationName ?? "No location", lots: [] };
    group.lots.push(lot);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.key === "") - Number(b.key === "") || a.name.localeCompare(b.name),
  );
}

function lotFacts(lot: LotWithLocation): string[] {
  const facts: string[] = [];
  if (lot.bin) facts.push(`Bin ${lot.bin}`);
  if (lot.pricePerBottle !== null && lot.currency) {
    facts.push(`${formatMoney(lot.pricePerBottle, lot.currency)} each`);
  }
  if (lot.purchaseDate) facts.push(`Bought ${formatDate(lot.purchaseDate)}`);
  if (lot.store) facts.push(lot.purchaseDate ? `at ${lot.store}` : `From ${lot.store}`);
  return facts;
}

export interface LotsCardProps {
  detail: WineDetail;
  onDrink: (lotId: string) => void;
  onMove: (lotId: string) => void;
}

/** Where the bottles are (R7, KTD5), with per-lot Drink and Move when there are several lots. */
export function LotsCard({ detail, onDrink, onMove }: LotsCardProps) {
  const groups = groupLots(detail.lots);
  const several = detail.lots.length > 1;

  return (
    <Card padding="lg">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Bottles</h2>
        <span className="text-sm text-ink-muted">{bottles(detail.bottles)}</span>
      </div>
      {groups.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-ink-muted">
            No bottles left. This wine stays under Drunk in your cellar with its notes.
          </p>
          <Link to="/add" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Add more
          </Link>
        </div>
      ) : (
        <ul aria-label="Bottles by location" className="flex flex-col gap-3">
          {groups.map((group) => {
            const total = group.lots.reduce((sum, l) => sum + l.quantity, 0);
            return (
              <li
                key={group.key}
                className="rounded-xl border border-border bg-surface-muted/40 p-4"
              >
                <div className="flex items-center gap-2">
                  <MapPin aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
                  <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{group.name}</h3>
                  <span className="text-sm font-medium text-ink tabular-nums">
                    {bottles(total)}
                  </span>
                </div>
                <div className="mt-2 flex flex-col gap-2">
                  {group.lots.map((lot) => {
                    const facts = lotFacts(lot);
                    const where = `${group.name}${lot.bin ? ` bin ${lot.bin}` : ""}`;
                    return (
                      <div key={lot.id} className="flex items-center gap-3 pl-6">
                        <p className="min-w-0 flex-1 text-sm text-ink-muted">
                          {group.lots.length > 1 && (
                            <span className="font-medium text-ink">{bottles(lot.quantity)} · </span>
                          )}
                          {facts.length > 0 ? facts.join(" · ") : "No purchase details"}
                        </p>
                        {several && (
                          <span className="flex shrink-0 gap-1">
                            <IconButton
                              label={`Drink from ${where}`}
                              icon={<GlassWater />}
                              size="sm"
                              onClick={() => onDrink(lot.id)}
                            />
                            <IconButton
                              label={`Move from ${where}`}
                              icon={<ArrowRightLeft />}
                              size="sm"
                              onClick={() => onMove(lot.id)}
                            />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
