import { Compass, House, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { useAiStatus } from "../../ai/useAiStatus";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { buttonClasses } from "../../components/ui/buttonStyles";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { SkeletonText } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/useToast";
import { now } from "../../domain/clock";
import { loadSampleCellar } from "../../domain/commands/sample";
import { undoBatch } from "../../domain/undo";
import { commandErrorMessage } from "../cellar/feedback";
import { formatMoney } from "../../domain/money";
import { useHomeSections, type CellarRow, type HomeSections } from "../../domain/selectors";
import { pluralize } from "../../lib/format";
import { greetingFor } from "./greeting";
import { WineCard } from "./WineCard";

function Section({ title, rows }: { title: string; rows: CellarRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold text-ink">{title}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li key={row.wine.id}>
            <WineCard row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NoWindowSection({ count }: { count: number }) {
  const aiStatus = useAiStatus();
  if (count === 0) return null;
  return (
    <section className="mb-10 rounded-2xl border border-dashed border-border-strong bg-surface-muted/50 p-5">
      <div className="flex items-center gap-2">
        <Badge tone="no-window">No window</Badge>
        <h2 className="text-lg font-semibold text-ink">No drinking window yet ({count})</h2>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        Set a window by hand, or, with an AI key, estimate them all at once.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/cellar?status=none" className={buttonClasses({ variant: "secondary" })}>
          Set windows
        </Link>
        {aiStatus.state === "ready" && (
          <Link
            to="/cellar?status=none&estimate=all"
            className={buttonClasses({ variant: "primary" })}
          >
            <Sparkles aria-hidden="true" className="size-4" />
            Estimate all with AI
          </Link>
        )}
      </div>
    </section>
  );
}

function CostSection({ home }: { home: HomeSections }) {
  if (home.costByCurrency.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold text-ink">Cellar cost</h2>
      <ul className="flex flex-wrap gap-3">
        {home.costByCurrency.map((c) => (
          <li
            key={c.currency}
            className="rounded-xl border border-border bg-surface px-4 py-3 shadow-card"
          >
            <span className="block text-xs text-ink-subtle">{c.currency}</span>
            <span className="block text-lg font-semibold text-ink tabular-nums">
              {formatMoney(c.total, c.currency)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyCellar() {
  const { toast } = useToast();

  async function onSample() {
    try {
      const result = await loadSampleCellar();
      toast({
        title: result.summary,
        tone: "success",
        action: result.batchId
          ? { label: "Undo", onClick: () => void undoBatch(result.batchId!) }
          : undefined,
      });
    } catch (err) {
      toast({
        title: commandErrorMessage(err, "Could not load the sample cellar."),
        tone: "danger",
      });
    }
  }

  return (
    <>
      <PageHeader title="Home" subtitle="What is ready to drink, and what is coming up." />
      <EmptyState
        icon={<House />}
        title="Your cellar is empty"
        description="Add a wine by hand, scan a label, or explore with a sample cellar first."
        action={
          <>
            <Link to="/add" className={buttonClasses({ variant: "primary" })}>
              Add your first wine
            </Link>
            <Button variant="secondary" icon={<Compass aria-hidden="true" />} onClick={onSample}>
              Explore a sample cellar
            </Button>
          </>
        }
      />
    </>
  );
}

export default function HomePage() {
  const home = useHomeSections();

  if (home === undefined) {
    return (
      <>
        <PageHeader title="Home" subtitle="What is ready to drink, and what is coming up." />
        <SkeletonText lines={6} />
      </>
    );
  }

  if (home.isEmpty) return <EmptyCellar />;

  const greeting = greetingFor(now().getHours());

  return (
    <>
      <PageHeader
        title={greeting}
        subtitle={`You have ${pluralize(home.counts.bottles, "bottle")} across ${pluralize(home.counts.wines, "wine")}.`}
      />
      <Section title="Ready now" rows={home.ready} />
      <Section title="Drink soon" rows={home.drinkSoon} />
      <Section title="Past peak" rows={home.pastPeak} />
      <Section title="Coming into window" rows={home.comingIntoWindow} />
      <NoWindowSection count={home.counts.byStatus.none} />
      <Section title="Recently added" rows={home.recentlyAdded} />
      <CostSection home={home} />
    </>
  );
}
