import type { ReactNode, Ref } from "react";

export interface StepProps {
  /** Put on the step's H1; the wizard focuses it when the step opens. */
  headingRef: Ref<HTMLHeadingElement>;
  onNext: () => void;
}

/** One onboarding step: an H1, a short intro, the body, and the buttons at the bottom. */
export function StepLayout({
  headingRef,
  title,
  intro,
  children,
  footer,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  title: string;
  intro?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="animate-fade-in">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-3xl font-semibold text-balance focus:outline-none sm:text-4xl"
      >
        {title}
      </h1>
      {intro && <p className="mt-3 text-lg text-ink-muted">{intro}</p>}
      {children && <div className="mt-8">{children}</div>}
      {footer && <div className="mt-10 flex flex-wrap items-center gap-3">{footer}</div>}
    </section>
  );
}
