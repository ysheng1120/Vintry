/**
 * Test helpers for the onboarding tests. Import only from `*.test.tsx` files.
 */
/* eslint-disable react-refresh/only-export-components -- test-only module, never hot-reloaded */
import { render } from "@testing-library/react";
import { Outlet, createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { BannerProvider, BannerSlot } from "../../app/Banners";
import { ToastProvider } from "../../components/ui/Toast";
import { TourHost } from "../tour/TourHost";
import { FirstRunRedirect } from "./FirstRunRedirect";
import WelcomePage from "./index";
import { SafariTabWarning } from "./SafariTabWarning";
import { SampleDataWatcher } from "./SampleDataWatcher";

export const USER_AGENTS = {
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
};

/** Pretends to be a browser: its user agent, and whether Vintry runs as an installed app. */
export function setBrowser(userAgent: string, { standalone = false } = {}) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  window.matchMedia = ((query: string) => ({
    matches: standalone && query.includes("display-mode: standalone"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** A `beforeinstallprompt` event as Chrome and Edge fire it. */
export function installPromptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  return event;
}

function Shell() {
  return (
    <ToastProvider>
      <BannerProvider>
        <FirstRunRedirect />
        <SampleDataWatcher />
        <SafariTabWarning />
        <TourHost />
        <BannerSlot />
        <Outlet />
      </BannerProvider>
    </ToastProvider>
  );
}

const page = (title: string) => (
  <>
    <h1>{title}</h1>
    <a href="#" data-tour="tour-home">
      Home link
    </a>
  </>
);

/** The app shell's first-run pieces around the welcome page and stand-in pages. */
export function renderApp(path = "/") {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: "/", element: page("Home") },
          { path: "/welcome", element: <WelcomePage /> },
          { path: "/add/scan", element: page("Scan a label") },
          { path: "/add/describe", element: page("Describe it") },
          { path: "/add/manual", element: page("Add by hand") },
          { path: "/import", element: page("Import") },
          { path: "/help", element: page("How to use Vintry") },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, view };
}
