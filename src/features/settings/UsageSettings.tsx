import { formatUsd } from "../../ai/models";
import { useUsageSummary, type UsagePeriod, type UsageTotals } from "../../ai/usage";
import { SkeletonText } from "../../components/ui/Skeleton";

const tokens = new Intl.NumberFormat();

function costText(totals: UsageTotals): string {
  if (totals.requests === 0) return formatUsd(0);
  if (totals.unpricedRequests === totals.requests) return "price unknown";
  const known = formatUsd(totals.costUsd);
  return totals.unpricedRequests > 0 ? `${known} + price unknown` : known;
}

function UsageTable({ title, period }: { title: string; period: UsagePeriod }) {
  if (period.requests === 0) {
    return (
      <div>
        <p className="mb-2 font-medium text-ink">{title}</p>
        <p className="text-sm text-ink-muted">No AI requests in this period.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="mb-2 text-left font-medium text-ink">{title}</caption>
        <thead>
          <tr className="border-b border-border text-left text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              Feature
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Requests
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Tokens in / out
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Est. cost
            </th>
          </tr>
        </thead>
        <tbody>
          {period.byFeature.map((row) => (
            <tr key={row.feature} className="border-b border-border">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                {row.label}
              </th>
              <td className="py-2 pr-3 text-right tabular-nums">{row.requests}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {tokens.format(row.inputTokens)} / {tokens.format(row.outputTokens)}
              </td>
              <td className="py-2 text-right tabular-nums">{costText(row)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-medium text-ink">
            <th scope="row" className="py-2 pr-3 text-left">
              Total
            </th>
            <td className="py-2 pr-3 text-right tabular-nums">{period.requests}</td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {tokens.format(period.inputTokens)} / {tokens.format(period.outputTokens)}
            </td>
            <td className="py-2 text-right tabular-nums">{costText(period)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** AI usage this month and all time, per feature (R19). */
export function UsageSettings() {
  const summary = useUsageSummary();
  if (!summary) return <SkeletonText lines={3} />;
  if (summary.allTime.requests === 0) {
    return <p className="text-sm text-ink-muted">No AI requests yet.</p>;
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <UsageTable title="This month" period={summary.thisMonth} />
      <UsageTable title="All time" period={summary.allTime} />
    </div>
  );
}
