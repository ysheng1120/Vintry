import { ChartColumn } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router";
import { BarChart, type BarChartDatum } from "../../components/ui/BarChart";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Field } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { SkeletonText } from "../../components/ui/Skeleton";
import { StarRating } from "../../components/ui/StarRating";
import { currentYear } from "../../domain/clock";
import { formatMoney } from "../../domain/money";
import { useStats } from "../../domain/selectors";
import type { SeriesPoint } from "../../domain/selectors";
import {
  useSpendingPerYear,
  useYearInWine,
  useYearsWithData,
  type SpendingPerYear,
  type YearInWine,
} from "../../domain/yearStats";
import { pluralize } from "../../lib/format";

const bottleValue = (v: number) => pluralize(v, "bottle");

// Written out in full (not built with a template literal) so Tailwind's scanner can see each
// class name literally and generate its CSS; a dynamic `fill-wine-${key}` only ever produced
// `fill-wine-red` (the one spelled out elsewhere, in BarChart.test.tsx), leaving every other
// wine colour's bar with the SVG default black fill.
const COLOUR_FILL: Record<string, string> = {
  red: "fill-wine-red",
  white: "fill-wine-white",
  rose: "fill-wine-rose",
  sparkling: "fill-wine-sparkling",
  dessert: "fill-wine-dessert",
  fortified: "fill-wine-fortified",
  orange: "fill-wine-orange",
};

function withColourFill(points: SeriesPoint[]): BarChartDatum[] {
  return points.map((p) => ({ ...p, className: COLOUR_FILL[p.key] ?? "fill-primary" }));
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

/** One number or short answer in the year recap. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card>
      <p className="text-sm text-ink-subtle">{label}</p>
      <div className="mt-1 text-2xl font-semibold text-ink tabular-nums">{children}</div>
    </Card>
  );
}

function SpendingStat({ recap }: { recap: YearInWine }) {
  if (recap.spentByCurrency.length === 0) return <Stat label="Money spent">Nothing spent</Stat>;
  return (
    <Stat label="Money spent">
      <ul className="flex flex-col gap-0.5">
        {recap.spentByCurrency.map((t) => (
          <li key={t.currency}>{formatMoney(t.total, t.currency)}</li>
        ))}
      </ul>
    </Stat>
  );
}

/** Wines with the most bottles drunk that year, at most 3, each linking to its wine page. */
function TopWinesCard({ recap }: { recap: YearInWine }) {
  return (
    <Card className="sm:col-span-2">
      <h3 className="mb-3 text-sm text-ink-subtle">Top wines drunk</h3>
      {recap.topWines.length === 0 ? (
        <p className="text-ink-muted">No bottles drunk this year.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {recap.topWines.map((wine, i) => (
            <li key={wine.wineId} className="flex items-center justify-between gap-3">
              <Link
                to={`/wine/${wine.wineId}`}
                className="min-w-0 truncate font-medium text-primary underline-offset-2 hover:underline"
              >
                {i + 1}. {wine.label}
              </Link>
              <span className="shrink-0 text-sm text-ink-muted tabular-nums">
                {pluralize(wine.bottles, "bottle")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** A year picker for the year recap, offering every year with data (and the chosen year even
 * before the list has loaded). */
function YearPicker({
  year,
  years,
  onChange,
}: {
  year: number;
  years: number[] | undefined;
  onChange: (year: number) => void;
}) {
  const options = years && years.length > 0 ? years : [year];
  return (
    <Field label="Year" className="w-28">
      <Select value={year} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** A recap of one calendar year: what came in, what went out, and what it was like. */
function YearInWineSection() {
  const years = useYearsWithData();
  const [chosenYear, setChosenYear] = useState<number | null>(null);
  const fallbackYear =
    years === undefined || years.length === 0
      ? currentYear()
      : (years.find((y) => y === currentYear()) ?? years[0] ?? currentYear());
  const year = chosenYear ?? fallbackYear;
  const recap = useYearInWine(year);

  if (years !== undefined && years.length === 0) return null;

  return (
    <section aria-labelledby="year-in-wine-heading" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <h2 id="year-in-wine-heading" className="text-lg font-semibold text-ink">
          Year in wine
        </h2>
        <YearPicker year={year} years={years} onChange={setChosenYear} />
      </div>
      {recap === undefined ? (
        <SkeletonText lines={4} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Bottles bought">{pluralize(recap.bottlesBought, "bottle")}</Stat>
          <SpendingStat recap={recap} />
          <Stat label="Bottles drunk">{pluralize(recap.bottlesDrunk, "bottle")}</Stat>
          <Stat label="Average rating">
            {recap.averageRating === null ? (
              "No ratings yet"
            ) : (
              <StarRating value={recap.averageRating} size="sm" />
            )}
          </Stat>
          <TopWinesCard recap={recap} />
          <Card className="sm:col-span-2">
            <h3 className="mb-3 text-sm text-ink-subtle">Colours drunk</h3>
            <BarChart
              title={`Colours drunk in ${year}`}
              data={withColourFill(recap.byColour)}
              formatValue={bottleValue}
              emptyMessage="No bottles drunk this year."
            />
          </Card>
        </div>
      )}
    </section>
  );
}

/** How much was spent buying bottles, per year, for the last few years with purchases. Currencies
 * are never added together, so only the currency with the most spending is charted; a note below
 * says when money was also spent in others. */
function SpendingPerYearCard({ spending }: { spending: SpendingPerYear | undefined }) {
  if (spending === undefined) {
    return (
      <ChartCard title="Spending per year">
        <SkeletonText lines={3} />
      </ChartCard>
    );
  }
  const currency = spending.currency ?? "USD";
  return (
    <ChartCard title="Spending per year">
      <BarChart
        title="Spending per year"
        data={spending.points}
        formatValue={(v) => formatMoney(v, currency)}
        emptyMessage="No purchases recorded yet."
      />
      {spending.otherCurrencies.length > 0 && (
        <p className="mt-3 text-sm text-ink-subtle">
          Also spent in {spending.otherCurrencies.join(", ")}, not shown here.
        </p>
      )}
    </ChartCard>
  );
}

export default function StatsPage() {
  const stats = useStats();
  const spending = useSpendingPerYear();

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
        <ChartCard title="Bottles by region">
          <BarChart
            title="Bottles by region"
            data={stats.byRegion}
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
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Bottles drunk per month">
          <BarChart
            title="Bottles drunk per month"
            data={stats.drunkPerMonth}
            formatValue={bottleValue}
            emptyMessage="No drinks recorded in the last 12 months."
          />
        </ChartCard>
        <SpendingPerYearCard spending={spending} />
      </div>
      <YearInWineSection />
    </>
  );
}
