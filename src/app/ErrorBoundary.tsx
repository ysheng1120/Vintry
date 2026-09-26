import { AlertTriangle, RotateCw } from "lucide-react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button } from "../components/ui/Button";
import { buttonClasses } from "../components/ui/buttonStyles";
import { browser } from "./browser";
import { NotFound } from "./NotFound";

function messageOf(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

/** Route-level error boundary: a friendly message, Reload, and a way home. */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;

  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : messageOf(error);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center"
    >
      <div
        aria-hidden="true"
        className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger"
      >
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="text-3xl font-semibold">Something went wrong on this screen</h1>
      <p className="mt-3 text-ink-muted">
        Your cellar data is safe. Reloading usually fixes this, especially right after Vintry
        updates.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Button icon={<RotateCw className="size-4" />} onClick={() => browser.reload()}>
          Reload
        </Button>
        <Link to="/" className={buttonClasses({ variant: "secondary" })}>
          Go to Home
        </Link>
      </div>
      {detail && (
        <details className="mt-8 w-full rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm">
          <summary className="cursor-pointer font-medium text-ink-muted">Technical details</summary>
          <p className="mt-2 font-mono text-xs break-words text-ink-muted">{detail}</p>
        </details>
      )}
    </div>
  );
}
