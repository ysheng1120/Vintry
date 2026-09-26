import { Compass } from "lucide-react";
import { Link } from "react-router";
import { buttonClasses } from "../components/ui/buttonStyles";

export function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <div
        aria-hidden="true"
        className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary"
      >
        <Compass className="size-7" />
      </div>
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="mt-3 text-ink-muted">
        This page does not exist. It may have moved, or the link has a typo.
      </p>
      <Link to="/" className={buttonClasses({ className: "mt-7" })}>
        Go to Home
      </Link>
    </div>
  );
}
