import clsx from "clsx";

/** Placeholder shape while content loads. Hidden from assistive tech. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx("animate-pulse rounded-lg bg-surface-muted", className)}
    />
  );
}

/** A few lines of text-shaped skeletons; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={clsx("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={clsx("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
