import { ArrowRight, Compass } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { HELP_SECTIONS, type HelpBlock } from "../../content/help";
import { startTour } from "../tour/tourStore";

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "text":
      return <p>{block.text}</p>;
    case "steps":
      return (
        <ol className="list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-ink-subtle">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-subtle">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "shortcuts":
      return (
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
          {block.items.map(({ keys, action }) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="inline-flex min-w-8 justify-center rounded-md border border-border-strong bg-surface-muted px-2 py-0.5 font-sans text-sm font-semibold text-ink">
                  {keys}
                </kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

/** "How to use Vintry" (R29): task-based help from src/content/help.ts, plus the tour again. */
export function HelpPage() {
  const { hash } = useLocation();
  const navigate = useNavigate();

  // Deep links such as /help#ai-key land on their section.
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    if (!id) return;
    document.getElementById(id)?.scrollIntoView?.({ block: "start" });
  }, [hash]);

  function takeTour() {
    startTour();
    void navigate("/");
  }

  return (
    <>
      <PageHeader
        title="How to use Vintry"
        subtitle="Short answers for everyday tasks."
        actions={
          <Button
            variant="secondary"
            icon={<Compass aria-hidden="true" className="size-4" />}
            onClick={takeTour}
          >
            Take the tour again
          </Button>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Contents" className="lg:sticky lg:top-8 lg:self-start">
          <h2 className="mb-2 text-xs font-semibold tracking-[0.12em] text-ink-subtle uppercase">
            Contents
          </h2>
          <ul className="flex flex-col gap-0.5">
            {HELP_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="flex min-h-10 items-center rounded-xl px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-5">
          {HELP_SECTIONS.map((section) => (
            <Card
              key={section.id}
              padding="lg"
              id={section.id}
              role="region"
              aria-labelledby={`${section.id}-title`}
              className="scroll-mt-6 space-y-3 text-ink-muted"
            >
              <h2
                id={`${section.id}-title`}
                className="font-display text-xl font-semibold text-ink"
              >
                {section.title}
              </h2>
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
              {section.links && (
                <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                  {section.links.map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg font-medium text-primary hover:underline"
                    >
                      Open {link.label}
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Link>
                  ))}
                </p>
              )}
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
