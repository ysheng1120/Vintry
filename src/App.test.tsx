import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { createMemoryRouter, RouterProvider, useLocation, type RouteObject } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useBanner } from "./app/useBanner";
import { AppProviders } from "./app/providers";
import { installMatchMedia, resetTestPwa, resetTestSettings } from "./app/testing";

vi.mock("./db/settings", async () => (await import("./app/testing")).settingsModule);
vi.mock("./db/db", async () => (await import("./app/testing")).dbModule);
vi.mock("./app/pwaRegister", async () => (await import("./app/testing")).pwaModule);

function Page({ title, children }: { title: string; children?: React.ReactNode }) {
  const location = useLocation();
  return (
    <>
      <h1>{title}</h1>
      <p data-testid="path">{location.pathname}</p>
      {children}
    </>
  );
}

function BannerDemo() {
  const { showBanner } = useBanner();
  useEffect(() => {
    showBanner({ id: "demo", title: "Sample cellar loaded" });
  }, [showBanner]);
  return <Page title="Home" />;
}

const testRoutes: RouteObject[] = [
  {
    element: (
      <AppProviders>
        <App />
      </AppProviders>
    ),
    children: [
      { path: "/", element: <BannerDemo /> },
      {
        path: "/cellar",
        element: (
          <Page title="Cellar">
            <label>
              Search
              <input id="cellar-search" />
            </label>
          </Page>
        ),
      },
      { path: "/wine/:id", element: <Page title="Wine" /> },
      { path: "/add", element: <Page title="Add wine" /> },
      { path: "/sommelier", element: <Page title="Sommelier" /> },
      { path: "/more", element: <Page title="More" /> },
      { path: "/settings", element: <Page title="Settings" /> },
    ],
  },
];

function renderAt(path: string) {
  const router = createMemoryRouter(testRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const NAV_NAMES = ["Home", "Cellar", "Add wine", "Sommelier", "More"];

beforeEach(() => {
  resetTestSettings();
  resetTestPwa();
});

describe("App shell layout", () => {
  it("shows five navigation items with accessible names and tour anchors", async () => {
    installMatchMedia({ width: 1280 });
    renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(nav).toHaveAttribute("data-layout", "sidebar");
    for (const name of NAV_NAMES) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    const tours = Array.from(nav.querySelectorAll("[data-tour]")).map((el) =>
      el.getAttribute("data-tour"),
    );
    expect(tours.sort()).toEqual(
      ["tour-add", "tour-cellar", "tour-home", "tour-more", "tour-sommelier"].sort(),
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("marks the current section with aria-current", async () => {
    installMatchMedia({ width: 1280 });
    renderAt("/cellar");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Cellar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    await userEvent.click(within(nav).getByRole("link", { name: "Sommelier" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sommelier" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Sommelier" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("treats wine detail as Cellar and the More pages as More", async () => {
    installMatchMedia({ width: 1280 });
    renderAt("/wine/abc");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Cellar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await act(async () => {
      await userEvent.click(within(nav).getByRole("link", { name: "More" }));
    });
    expect(within(nav).getByRole("link", { name: "More" })).toHaveAttribute("aria-current", "page");
  });

  it("collapses to an icon rail below 1100px and a bottom bar below 720px with the same items", async () => {
    const media = installMatchMedia({ width: 1000 });
    renderAt("/");
    let nav = await screen.findByRole("navigation", { name: "Main" });
    expect(nav).toHaveAttribute("data-layout", "rail");
    for (const name of NAV_NAMES) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }

    act(() => media.set({ width: 600 }));
    nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toHaveAttribute("data-layout", "bottom");
    for (const name of NAV_NAMES) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("renders registered banners at the top of the main content", async () => {
    installMatchMedia({ width: 1280 });
    renderAt("/");
    const main = await screen.findByRole("main");
    expect(await within(main).findByText("Sample cellar loaded")).toBeInTheDocument();
  });
});

describe("Keyboard shortcuts", () => {
  it('"/" opens the cellar and focuses its search box', async () => {
    installMatchMedia({ width: 1280 });
    renderAt("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    await userEvent.keyboard("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Cellar" })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("");
  });

  it('"n" opens Add, but not while typing in a field', async () => {
    installMatchMedia({ width: 1280 });
    const router = renderAt("/cellar");
    const search = await screen.findByRole("textbox", { name: "Search" });
    await userEvent.type(search, "nebbiolo");
    expect(router.state.location.pathname).toBe("/cellar");
    expect(search).toHaveValue("nebbiolo");

    search.blur();
    await userEvent.keyboard("n");
    expect(await screen.findByRole("heading", { level: 1, name: "Add wine" })).toBeInTheDocument();
  });
});
