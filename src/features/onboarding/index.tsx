import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { BrandMark } from "../../app/Brand";
import { buttonClasses } from "../../components/ui/buttonStyles";

// Full-screen placeholder from the app shell (U4); the onboarding unit replaces this page.
export default function WelcomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <BrandMark className="mb-8 size-16 rounded-2xl" />
      <h1 className="text-4xl font-semibold text-balance sm:text-5xl">Welcome to Vintry</h1>
      <p className="mt-4 max-w-md text-lg text-ink-muted">
        Your wine cellar, organised. Know what to drink and when, and keep your records safe on this
        computer.
      </p>
      <Link to="/" className={buttonClasses({ size: "lg", className: "mt-10" })}>
        Get started
        <ArrowRight aria-hidden="true" className="size-5" />
      </Link>
    </main>
  );
}
