import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { changelogNewestFirst } from "../../content/changelog";
import { formatDate } from "../../lib/format";

/** What's New (R30, KTD16): every release from src/content/changelog.ts, newest first. */
export default function WhatsNewPage() {
  const entries = changelogNewestFirst();
  return (
    <>
      <PageHeader title="What's new" subtitle="Recent changes to Vintry." />
      <p className="-mt-4 mb-6 text-sm text-ink-subtle">You are using version {__APP_VERSION__}.</p>
      <ol className="flex flex-col gap-5">
        {entries.map((entry) => (
          <li key={entry.version}>
            <Card padding="lg" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-xl font-semibold text-ink">
                  Version {entry.version}
                </h2>
                <time dateTime={entry.date} className="text-sm text-ink-subtle">
                  {formatDate(entry.date)}
                </time>
              </div>
              <p className="text-ink">{entry.headline}</p>
              <ul className="list-disc space-y-1.5 pl-5 text-ink-muted">
                {entry.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
