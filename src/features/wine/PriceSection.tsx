import { AlertTriangle, ExternalLink, Tag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isHttpUrl } from "../../ai/features/criticsConsensus";
import { generateWinePriceCheck, NO_PRICES_MESSAGE } from "../../ai/features/priceCheck";
import { aiStatusNote, useAiStatus } from "../../ai/useAiStatus";
import { useCommandFeedback } from "../../app/commandFeedback";
import { Button } from "../../components/ui/Button";
import { setWinePriceCheck, type CommandResult } from "../../domain/commands";
import { bottleSizeLabel } from "../../domain/labels";
import { formatMoney } from "../../domain/money";
import type { Wine, WinePriceCheck } from "../../domain/types";
import { formatDate } from "../../lib/format";
import { SetValueSheet } from "./SetValueSheet";

export interface PriceSectionProps {
  wine: Wine;
}

type PriceRange = WinePriceCheck["ranges"][number];
type PriceListing = WinePriceCheck["listings"][number];

const LINK_CLASS =
  "inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline";

const isIso = (currency: string) => /^[A-Z]{3}$/.test(currency);

/** "£225" for a whole amount, "£212.50" otherwise; an unclear currency keeps its own symbol. */
function moneyText(amount: number, currency: string): string {
  const digits = Number.isInteger(amount)
    ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (!isIso(currency)) return `${currency}${amount.toLocaleString(undefined, digits)}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, ...digits }).format(
      amount,
    );
  } catch {
    return formatMoney(amount, currency);
  }
}

/** "GBP £200 to £240, middle £225 (3 prices)", or one amount when the range has one price. */
function rangeText(range: PriceRange): string {
  const code = isIso(range.currency) ? `${range.currency} ` : "";
  const money = (amount: number) => moneyText(amount, range.currency);
  if (range.count <= 1 || range.low === range.high) {
    return `${code}${money(range.middle)} (${range.count === 1 ? "1 price" : `${range.count} prices`})`;
  }
  return `${code}${money(range.low)} to ${money(range.high)}, middle ${money(range.middle)} (${range.count} prices)`;
}

/**
 * "Checked for 2019; this wine is now 2018" when the wine's producer, name, vintage, or bottle
 * size has changed since the check ran (KTD6, R8), or null when it still matches.
 */
function outOfDateText(checked: WinePriceCheck["checkedFor"], wine: Wine): string | null {
  const was: string[] = [];
  const now: string[] = [];
  if (checked.producer !== wine.producer || checked.name !== wine.name) {
    was.push([checked.producer, checked.name].filter(Boolean).join(" "));
    now.push([wine.producer, wine.name].filter(Boolean).join(" "));
  }
  if (checked.vintage !== wine.vintage) {
    was.push(checked.vintage === null ? "NV" : String(checked.vintage));
    now.push(wine.vintage === null ? "NV" : String(wine.vintage));
  }
  if (checked.bottleSize !== wine.bottleSize) {
    was.push(bottleSizeLabel(checked.bottleSize));
    now.push(bottleSizeLabel(wine.bottleSize));
  }
  if (was.length === 0) return null;
  return `Checked for ${was.join(", ")}; this wine is now ${now.join(", ")}.`;
}

/** "£1,250 per case, 750 ml, in bond or ex-tax, sold out": what an other listing is. */
function listingText(listing: PriceListing, vintage: number | null): string {
  const unit = listing.unit === "bottle" ? " a bottle" : listing.unit === "case" ? " per case" : "";
  const details = [`${listing.amount}${unit}`];
  if (listing.sizeMl !== null) details.push(bottleSizeLabel(listing.sizeMl));
  if (listing.vintage !== null && listing.vintage !== vintage) {
    details.push(`${listing.vintage} vintage`);
  }
  if (listing.basis === "in bond or ex-tax" || listing.basis === "aggregate average") {
    details.push(listing.basis);
  }
  if (listing.availability !== "unknown") details.push(listing.availability);
  return details.join(", ");
}

/** The shop's name, linked to its page in a new tab; a non-http(s) source is plain text. */
function ShopLink({ listing }: { listing: PriceListing }) {
  if (!isHttpUrl(listing.source.url)) return <span>{listing.merchant}</span>;
  return (
    <a
      href={listing.source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={listing.source.title}
      aria-label={`${listing.merchant} (opens in a new tab)`}
      className={LINK_CLASS}
    >
      {listing.merchant}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

/**
 * The "Shop prices" section of the About this wine card: on request, Claude searches a fixed
 * list of wine shops for this exact wine, and the app shows the verified bottle prices grouped
 * by currency, never converted (R5), each with its source (R6). Checking, refreshing, and
 * removing are undoable commands (R11). A result is never the wine's value: Use this price only
 * opens a sheet the collector saves (R7, KTD7), and it is withheld for a result checked for
 * another producer, name, vintage, or size (R8), for a sample wine, and for an unclear currency.
 */
export default function PriceSection({ wine }: PriceSectionProps) {
  const status = useAiStatus();
  const { done, failed } = useCommandFeedback();
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [using, setUsing] = useState<PriceRange | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Set synchronously, so a double click cannot start a second request before React re-renders.
  const runningRef = useRef(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const check = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setChecking(true);
    try {
      const result = await generateWinePriceCheck(wine, { signal: controller.signal });
      if (!controller.signal.aborted) done(result);
    } catch (error) {
      if (!controller.signal.aborted) failed(error, "Couldn't check prices");
    } finally {
      runningRef.current = false;
      if (!controller.signal.aborted) setChecking(false);
    }
  };

  const remove = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRemoving(true);
    try {
      done(await setWinePriceCheck({ wineId: wine.id, priceCheck: null }));
    } catch (error) {
      failed(error, "Couldn't remove the prices");
    } finally {
      runningRef.current = false;
      setRemoving(false);
    }
  };

  const finishUsing = (result: CommandResult | null) => {
    setUsing(null);
    if (result) done(result);
  };

  const prices = wine.priceCheck;
  const note = aiStatusNote(status);
  const busy = checking || removing;
  const disabled = status.state !== "ready" || busy;
  const outOfDate = prices ? outOfDateText(prices.checkedFor, wine) : null;
  const others = prices?.listings.filter((listing) => !listing.inRange) ?? [];

  /** Why Use this price is withheld for a row, or null when it is offered. */
  const withheldReason = (range: PriceRange): string | null => {
    if (wine.isSample) return "Sample wine. Prices can't be used as a value.";
    if (!range.usable) return "Currency unclear. Enter your value in Edit wine.";
    return null;
  };

  return (
    <section>
      <h3 className="mb-1 text-base font-semibold">Shop prices</h3>
      {!prices ? (
        <>
          <p className="text-sm text-ink-muted">
            Searches a fixed list of wine shops. Uses your AI key (up to 5 web searches).
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Tag aria-hidden="true" className="size-4" />}
              loading={checking}
              disabled={disabled}
              title={note ?? undefined}
              onClick={() => void check()}
            >
              {checking ? "Checking…" : "Check price"}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {outOfDate && (
            <p className="flex items-start gap-2 text-sm font-medium text-ink">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              {outOfDate}
            </p>
          )}
          {!prices.found ? (
            <p className="text-ink-muted">{NO_PRICES_MESSAGE}</p>
          ) : (
            <>
              {prices.ranges.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {prices.ranges.map((range) => {
                    const shops = prices.listings.filter(
                      (listing, index, all) =>
                        listing.inRange &&
                        listing.currency === range.currency &&
                        all.findIndex((other) => other.source.url === listing.source.url) === index,
                    );
                    const reason = withheldReason(range);
                    const text = rangeText(range);
                    return (
                      <li key={range.currency} className="flex flex-col items-start gap-1">
                        <p className="text-sm font-semibold text-ink tabular-nums">{text}</p>
                        {shops.length > 0 && (
                          <p className="text-xs text-ink-muted">
                            From{" "}
                            {shops.map((listing, index) => (
                              <span key={listing.source.url}>
                                <ShopLink listing={listing} />
                                {index < shops.length - 1 && ", "}
                              </span>
                            ))}
                          </p>
                        )}
                        {!outOfDate &&
                          (reason ? (
                            <p className="text-xs text-ink-subtle">{reason}</p>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label={`Use this price, ${range.currency} ${moneyText(range.middle, range.currency)}`}
                              onClick={() => setUsing(range)}
                            >
                              Use this price
                            </Button>
                          ))}
                      </li>
                    );
                  })}
                </ul>
              )}
              {others.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-ink">Other listings</h4>
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-ink-muted">
                    {others.map((listing, index) => (
                      <li key={`${listing.source.url}-${listing.amount}-${index}`}>
                        <ShopLink listing={listing} />:{" "}
                        <span>{listingText(listing, prices.checkedFor.vintage)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <p className="text-xs text-ink-subtle">
            Checked by AI on {formatDate(prices.generatedAt)}. Shop prices are often above auction
            or collector prices.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-label="Refresh prices"
              variant="ghost"
              size="sm"
              loading={checking}
              disabled={disabled}
              title={note ?? undefined}
              onClick={() => void check()}
            >
              Refresh
            </Button>
            <Button
              aria-label="Remove prices"
              variant="ghost"
              size="sm"
              loading={removing}
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
      {using && (
        <SetValueSheet
          wine={wine}
          amount={using.middle}
          currency={using.currency}
          onClose={() => setUsing(null)}
          onDone={finishUsing}
        />
      )}
    </section>
  );
}
