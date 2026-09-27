import clsx from "clsx";

export interface BarChartDatum {
  key: string;
  label: string;
  value: number;
  /** Tailwind fill class for this bar, e.g. "fill-wine-red". Defaults to the chart's `barClassName`. */
  className?: string;
}

export interface BarChartProps {
  /** Used to build the accessible summary and the hidden table's caption. */
  title: string;
  data: BarChartDatum[];
  /** Formats a value for the summary, the value labels, and the table. Defaults to the plain number. */
  formatValue?: (value: number) => string;
  /** Fill class used for bars that do not set their own `className`. */
  barClassName?: string;
  /** Shown instead of the chart when there is nothing to plot. */
  emptyMessage?: string;
  className?: string;
}

const ROW_HEIGHT = 28;
const BAR_HEIGHT = 14;
const CHART_WIDTH = 560;
const LABEL_WIDTH = 148;
const VALUE_WIDTH = 96;
const BAR_AREA = CHART_WIDTH - LABEL_WIDTH - VALUE_WIDTH;

/**
 * A horizontal SVG bar chart (KTD18: no charting library). The SVG carries the whole visual and
 * is hidden from assistive tech behind one `role="img"` summary; a visually-hidden table gives
 * screen reader users the same numbers row by row.
 */
export function BarChart({
  title,
  data,
  formatValue = (value) => String(value),
  barClassName = "fill-primary",
  emptyMessage = "No data yet.",
  className,
}: BarChartProps) {
  const max = Math.max(0, ...data.map((d) => d.value));

  if (data.length === 0 || max === 0) {
    return (
      <p role="img" aria-label={`${title}: ${emptyMessage}`} className="text-sm text-ink-muted">
        {emptyMessage}
      </p>
    );
  }

  const height = data.length * ROW_HEIGHT;
  const summary = `${title}: ${data.map((d) => `${d.label} ${formatValue(d.value)}`).join(", ")}`;

  return (
    <div className={clsx("w-full", className)}>
      <div role="img" aria-label={summary}>
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${height}`}
          width={CHART_WIDTH}
          height={height}
          aria-hidden="true"
          className="h-auto w-full"
        >
          {data.map((d, i) => {
            const y = i * ROW_HEIGHT;
            const barWidth = d.value > 0 ? Math.max((d.value / max) * BAR_AREA, 3) : 0;
            return (
              <g key={d.key}>
                <title>
                  {d.label}: {formatValue(d.value)}
                </title>
                <text x={0} y={y + ROW_HEIGHT / 2 + 4} fontSize={12} className="fill-ink-muted">
                  {d.label}
                </text>
                <rect
                  x={LABEL_WIDTH}
                  y={y + (ROW_HEIGHT - BAR_HEIGHT) / 2}
                  width={barWidth}
                  height={BAR_HEIGHT}
                  rx={4}
                  className={d.className ?? barClassName}
                />
                <text
                  x={CHART_WIDTH}
                  y={y + ROW_HEIGHT / 2 + 4}
                  fontSize={12}
                  textAnchor="end"
                  className="fill-ink-muted tabular-nums"
                >
                  {formatValue(d.value)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{formatValue(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
