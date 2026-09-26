import clsx from "clsx";
import { useEffect, useRef } from "react";
import { Link, Outlet, useLocation, useNavigation } from "react-router";
import { BannerSlot } from "./app/Banners";
import { BrandMark, BrandWordmark } from "./app/Brand";
import { useLayoutMode } from "./app/layoutMode";
import { Navigation } from "./app/Navigation";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";

/** Height of the bottom bar, shared with fixed overlays such as toasts. */
const BOTTOM_BAR_OFFSET = "4.5rem";

/** The main layout: navigation, banner slot, and the current page. */
export default function App() {
  const mode = useLayoutMode();
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const firstRender = useRef(true);

  useKeyboardShortcuts();

  // Keep toasts above the bottom bar.
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "bottom") root.style.setProperty("--vt-bottom-offset", BOTTOM_BAR_OFFSET);
    else root.style.removeProperty("--vt-bottom-offset");
  }, [mode]);

  // After navigating, move focus to the new page unless the page already took it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const main = mainRef.current;
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div data-layout={mode} className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      {navigation.state === "loading" && (
        <div
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary"
        />
      )}
      <Navigation mode={mode} />
      <div
        className={clsx(
          mode === "sidebar" && "pl-64",
          mode === "rail" && "pl-20",
          mode === "bottom" && "pb-[calc(4.5rem+env(safe-area-inset-bottom))]",
        )}
      >
        {mode === "bottom" && (
          <header className="flex items-center gap-2.5 border-b border-border bg-surface/80 px-5 py-3 backdrop-blur">
            <Link to="/" aria-label="Vintry home" className="flex items-center gap-2.5 rounded-xl">
              <BrandMark className="size-8" />
              <BrandWordmark className="text-xl" />
            </Link>
          </header>
        )}
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-5 py-8 focus:outline-none sm:px-8 lg:px-12 lg:py-12"
        >
          <BannerSlot />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
