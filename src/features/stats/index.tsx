import { ChartColumn } from "lucide-react";
import type { ReactNode } from "react";
import { BarChart, type BarChartDatum } from "../../components/ui/BarChart";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { SkeletonText } from "../../components/ui/Skeleton";
import { pluralize } from "../../lib/format";
import { useStats } from "../../domain/selectors";
import type { SeriesPoint } from "../../domain/selectors";

const bottleValue = (v: number) => pluralize(v, "bottle");

function withColourFill(points: SeriesPoint[]): BarChartDatum[] {
  return points.map((p) => ({ ...p, className: `fill-wine-${p.key}` }));
}

const STATUS_FILL: Record<string, string> = {
  hold: "fill-hold",
  ready: "fill-ready",
  "drink-soon": "fill-soon",
  "past-peak": "fill-past",
  none: "fill-none",
};

function withStatusFill(points: SeriesPoint[]): BarChartDatum[] {
  return points.map((p) => ({ ...p, className: STATUS_FILL[p.key] ?? "fill-primary" }));
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
      {children}
    </Card>
  );
}

export default function StatsPage() {
  const stats = useStats();

  if (stats === undefined) {
    return (
      <>
        <PageHeader title="Stats" subtitle="Your cellar in numbers." />
        <SkeletonText lines={8} />
      </>
    );
  }

  const totalBottles = stats.byColour.reduce((sum, p) => sum + p.value, 0);
  const totalDrunk = stats.drunkPerMonth.reduce((sum, p) => sum + p.value, 0);

  if (totalBottles === 0 && totalDrunk === 0) {
    return (
      <>
        <PageHeader title="Stats" subtitle="Your cellar in numbers." />
        <EmptyState
          icon={<ChartColumn />}
          title="No stats yet"
          description="Charts appear once your cellar has some wines."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Stats" subtitle="Your cellar in numbers." />
      <p className="mb-8 text-lg text-ink-muted">
        {pluralize(totalBottles, "bottle")} in the cellar
        {totalDrunk > 0 ? `, ${pluralize(totalDrunk, "bottle")} drunk in the last year` : ""}.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Bottles by colour">
          <BarChart
            title="Bottles by colour"
            data={withColourFill(stats.byColour)}
            formatValue={bottleValue}
            emptyMessage="No bottles yet."
          />
        </ChartCard>
        <ChartCard title="Bottles by country">
          <BarChart
            title="Bottles by country"
            data={stats.byCountry}
            formatValue={bottleValue}
            emptyMessage="No bottles yet."
          />
        </ChartCard>
        <ChartCard title="Bottles by vintage decade">
          <BarChart
            title="Bottles by vintage decade"
            data={stats.byVintageDecade}
            formatValue={bottleValue}
            emptyMessage="No bottles yet."
          />
        </ChartCard>
        <ChartCard title="Bottles by window status">
          <BarChart
            title="Bottles by window status"
            data={withStatusFill(stats.byStatus)}
            formatValue={bottleValue}
            emptyMessage="No bottles yet."
          />
        </ChartCard>
      </div>
      <div className="mt-6">
        <ChartCard title="Bottles drunk per month">
          <BarChart
            title="Bottles drunk per month"
            data={stats.drunkPerMonth}
            formatValue={bottleValue}
            emptyMessage="No drinks recorded in the last 12 months."
          />
        </ChartCard>
      </div>
    </>
  );
}
