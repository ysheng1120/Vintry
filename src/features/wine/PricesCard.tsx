import { ExternalLink, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  generateWinePrices,
  NO_PRICES_MESSAGE,
  PRICE_KIND_LABELS,
  priceRanges,
} from "../../ai/features/suggestedPrice";
import { isHttpUrl } from "../../ai/features/webResearch";
import { aiStatusNote, useAiStatus } from "../../ai/useAiStatus";
import { useCommandFeedback } from "../../app/commandFeedback";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { setWinePrices } from "../../domain/commands";
import { formatMoney } from "../../domain/money";
import type { CriticSource, Wine } from "../../domain/types";
import { formatDate } from "../../lib/format";

export interface PricesCardProps {
  wine: Wine;
}

const LINK_CLASS =
  "inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline";

/** A link to a price's page, in a new tab, named by its site. Anything but http(s) renders nothing. */
function SourceLink({ source }: { source: CriticSource }) {
  if (!isHttpUrl(source.url)) return null;
  const site = new URL(source.url).hostname.replace(/^www\./, "");
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={source.title}
      aria-label={`Source: ${source.title} (opens in a new tab)`}
      className={LINK_CLASS}
    >
      {site}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

/**
 * "Suggested price": on request, Claude searches reputable price and merchant sites for this
 * wine and the app lists the prices found, each linked to its page. A price is shown only when
 * the text cited from its page shows the amount and currency (checked in suggestedPrice.ts).
 * Display only: it never sets a lot's price or the collector's value, and currencies are never
 * converted or mixed. Finding, refreshing, and removing it are undoable commands (KTD4); only
 * the wine's identity is sent.
 */
export default function PricesCard({ wine }: PricesCardProps) {
  const status = useAiStatus();
  const { done, failed } = useCommandFeedback();
  const [finding, setFinding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Set synchronously, so a double click cannot start a second request before React re-renders.
  const runningRef = useRef(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const find = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setFinding(true);
    try {
      const result = await generateWinePrices(wine, { signal: controller.signal });
      if (!controller.signal.aborted) done(result);
    } catch (error) {
      if (!controller.signal.aborted) failed(error, "Couldn't find prices");
    } finally {
      runningRef.current = false;
      if (!controller.signal.aborted) setFinding(false);
    }
  };

  const remove = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRemoving(true);
    try {
      done(await setWinePrices({ wineId: wine.id, prices: null }));
    } catch (error) {
      failed(error, "Couldn't remove suggested prices");
    } finally {
      runningRef.current = false;
      setRemoving(false);
    }
  };

  const prices = wine.prices;
  const note = aiStatusNote(status);
  const busy = finding || removing;
  const disabled = status.state !== "ready" || busy;
  // A price is shown only with a link to its page. A range needs two prices in one currency.
  const points = (prices?.points ?? []).filter((point) => isHttpUrl(point.source.url));
  const ranges = priceRanges(points).filter((range) => range.count > 1);

  return (
    <Card padding="lg">
      <h2 className="mb-2 text-lg font-semibold">Suggested price</h2>
      {!prices ? (
        <>
          <p className="text-sm text-ink-muted">
            Searches reputable wine shops and price sites. Uses your AI key (a few web searches).
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Search aria-hidden="true" className="size-4" />}
              loading={finding}
              disabled={disabled}
              title={note ?? undefined}
              onClick={() => void find()}
            >
              {finding ? "Searching…" : "Find prices"}
            </Button>
            {note && <span className="text-xs text-ink-muted">{note}</span>}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {!prices.found || points.length === 0 ? (
            <p className="text-ink-muted">{NO_PRICES_MESSAGE}</p>
          ) : (
            <>
              {prices.summary && <p className="text-ink-muted">{prices.summary}</p>}
              {ranges.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm font-medium text-ink">
                  {ranges.map((range) => (
                    <li key={range.currency}>
                      From {formatMoney(range.low, range.currency)} to{" "}
                      {formatMoney(range.high, range.currency)}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="flex flex-col gap-1 text-sm text-ink-muted">
                {points.map((point, index) => (
                  <li key={`${point.source.url}-${point.currency}-${point.amount}-${index}`}>
                    {PRICE_KIND_LABELS[point.kind]}: {formatMoney(point.amount, point.currency)}{" "}
                    <SourceLink source={point.source} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-xs text-ink-subtle">
            Prices found on the web by AI on {formatDate(prices.generatedAt)}, not your value. Check
            the linked pages.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              loading={finding}
              disabled={disabled}
              title={note ?? undefined}
              onClick={() => void find()}
            >
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={removing}
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
            {note && <span className="text-xs text-ink-muted">{note}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
