import { useId, type ReactNode } from "react";
import { Card } from "../../components/ui/Card";

/** A titled Settings section; it is a landmark region named by its heading. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <Card padding="lg">
        <h2 id={headingId} className="text-xl font-semibold text-ink">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        <div className="mt-5 flex flex-col gap-6">{children}</div>
      </Card>
    </section>
  );
}
