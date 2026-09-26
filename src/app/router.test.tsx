import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../routes";
import { installMatchMedia, resetTestPwa, resetTestSettings } from "./testing";

vi.mock("../db/settings", async () => (await import("./testing")).settingsModule);
vi.mock("../db/db", async () => (await import("./testing")).dbModule);
vi.mock("./pwaRegister", async () => (await import("./testing")).pwaModule);

/** Every route and the H1 its page renders. Feature units keep these titles or update this list. */
const ROUTE_TITLES: [path: string, title: string | RegExp][] = [
  ["/", "Home"],
  ["/cellar", "Cellar"],
  ["/wine/w1", "Wine details"],
  ["/add", "Add wine"],
  ["/add/scan", "Scan a label"],
  ["/add/describe", "Describe it"],
  ["/add/manual", "Add by hand"],
  ["/import", "Import"],
  ["/sommelier", "Sommelier"],
  ["/sommelier/t1", "Conversation"],
  ["/more", "More"],
  ["/history", "History"],
  ["/wishlist", "Wishlist"],
  ["/stats", "Stats"],
  ["/locations", "Locations"],
  ["/settings", "Settings"],
  ["/backup", "Backup & restore"],
  ["/help", "How to use Vintry"],
  ["/whats-new", "What's new"],
  ["/welcome", "Welcome to Vintry"],
  ["/no-such-page", "Page not found"],
];

beforeEach(() => {
  // ScrollRestoration calls scrollTo, which jsdom does not implement.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  installMatchMedia({ width: 1280 });
  // A returning collector: the first-run redirect (U11) sends only new collectors to /welcome,
  // and the "What's new" notice stays quiet for the version already seen.
  resetTestSettings({ onboardingDone: true, lastSeenVersion: __APP_VERSION__ });
  resetTestPwa();
});

describe("router smoke test", () => {
  it.each(ROUTE_TITLES)("%s renders its page", async (path, title) => {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: title }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows /welcome full screen, without the main navigation", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/welcome"] });
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Welcome to Vintry" });
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("links home from the 404 page", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/nope"] });
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Page not found" });
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/");
  });
});
