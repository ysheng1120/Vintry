import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Navigation } from "../../app/Navigation";
import type { LayoutMode } from "../../app/layoutMode";
import { useKeyboardShortcuts } from "../../app/useKeyboardShortcuts";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { getSetting } from "../../db/settings";
import { makeLot, makeWine, resetDatabase } from "../../db/testing";
import { stopTour, useTourActive } from "../tour/tourStore";
import { PaletteHost } from "./PaletteHost";
import { closePaletteDialogs } from "./paletteStore";

function Layout({ mode }: { mode?: LayoutMode }) {
  useKeyboardShortcuts();
  const { pathname } = useLocation();
  const tour = useTourActive();
  return (
    <>
      {mode && <Navigation mode={mode} />}
      <button type="button">Before</button>
      <label>
        Note
        <input />
      </label>
      <p data-testid="path">{pathname}</p>
      {tour && <p>Tour running</p>}
      <PaletteHost />
      <Outlet />
    </>
  );
}

function renderApp(mode?: LayoutMode) {
  const router = createMemoryRouter(
    [{ path: "/", element: <Layout mode={mode} />, children: [{ path: "*", element: null }] }],
    { initialEntries: ["/"] },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return { user: userEvent.setup(), router };
}

const path = () => screen.getByTestId("path").textContent;
const palette = () => screen.getByRole("dialog", { name: "Search Vintry" });
const searchBox = () => within(palette()).getByRole("combobox", { name: "Search" });
const activeOption = () => {
  const id = searchBox().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
};

async function openWithShortcut(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}k{/Control}");
  return palette();
}

beforeEach(async () => {
  await resetDatabase();
  const margaux = makeWine({ producer: "Château Margaux", name: "", vintage: 2015 });
  const drunk = makeWine({ producer: "Château Margaux", name: "", vintage: 2005 });
  const ridge = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
  await db.wines.bulkAdd([margaux, drunk, ridge]);
  await db.lots.bulkAdd([
    makeLot({ wineId: margaux.id, quantity: 3 }),
    makeLot({ wineId: drunk.id, quantity: 0 }),
    makeLot({ wineId: ridge.id, quantity: 6 }),
  ]);
});

afterEach(() => {
  act(() => {
    closePaletteDialogs();
    stopTour();
  });
  vi.restoreAllMocks();
});

describe("command palette", () => {
  it("opens with Ctrl+K, focuses the search box, and Escape closes it and returns focus", async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole("button", { name: "Before" }));
    const dialog = await openWithShortcut(user);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(searchBox()).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
  });

  it("opens with Cmd+K on a Mac (and not Ctrl+K)", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { user } = renderApp();
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(palette()).toBeInTheDocument();
  });

  it("opens from an input too, since Ctrl+K is not typing", async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole("textbox", { name: "Note" }));
    await openWithShortcut(user);
    expect(searchBox()).toHaveFocus();
  });

  it("filters pages by every word and runs the match with Enter", async () => {
    const { user } = renderApp();
    await openWithShortcut(user);
    await user.type(searchBox(), "add HAND");
    const pages = within(palette()).getByRole("group", { name: "Pages" });
    expect(
      within(pages)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining("Add by hand")]);
    expect(within(palette()).queryByRole("group", { name: "Actions" })).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(path()).toBe("/add/manual");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("finds wines, accent-insensitive, with open wines first", async () => {
    const { user } = renderApp();
    await openWithShortcut(user);
    await user.type(searchBox(), "chateau margaux");
    const wines = await within(palette()).findByRole("group", { name: "Wines" });
    const options = within(wines).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Château Margaux 2015"),
      expect.stringContaining("Château Margaux 2005"),
    ]);
    expect(options[1]).toHaveTextContent("None left");

    await user.keyboard("{ArrowDown}{Enter}");
    const drunk = await db.wines.where("vintage").equals(2005).first();
    expect(path()).toBe(`/wine/${drunk!.id}`);
  });

  it("moves the active option with the arrow keys, wrapping at the ends", async () => {
    const { user } = renderApp();
    await openWithShortcut(user);
    expect(activeOption()).toHaveTextContent("Home");
    expect(activeOption()).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}");
    expect(activeOption()).toHaveTextContent("Cellar");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(activeOption()).toHaveTextContent("Toggle dark mode");
    await user.keyboard("{ArrowDown}");
    expect(activeOption()).toHaveTextContent("Home");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(path()).toBe("/cellar");
  });

  it("runs an option on click", async () => {
    const { user } = renderApp();
    await openWithShortcut(user);
    await user.click(within(palette()).getByRole("option", { name: /Stats/ }));
    expect(path()).toBe("/stats");
  });

  it("says when nothing matches", async () => {
    const { user } = renderApp();
    await openWithShortcut(user);
    await user.type(searchBox(), "zzzz");
    expect(within(palette()).getByText(/No matches/)).toBeInTheDocument();
    expect(within(palette()).queryAllByRole("option")).toHaveLength(0);
  });

  it("runs actions: back up, take the tour, toggle dark mode", async () => {
    const { user } = renderApp();
    await openWithShortcut(user);
    await user.type(searchBox(), "back up now{Enter}");
    expect(path()).toBe("/backup");

    await openWithShortcut(user);
    await user.type(searchBox(), "tour{Enter}");
    expect(path()).toBe("/");
    expect(screen.getByText("Tour running")).toBeInTheDocument();
    act(() => stopTour());

    await openWithShortcut(user);
    await user.type(searchBox(), "dark mode{Enter}");
    await waitFor(async () => expect(await getSetting("theme", null)).toBe("dark"));
    expect(await screen.findByText("Dark mode on")).toBeInTheDocument();
  });

  it("opens from the sidebar Search button, which the bottom bar does not show", async () => {
    const { user } = renderApp("sidebar");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(palette()).toBeInTheDocument();
    expect(searchBox()).toHaveFocus();
  });

  it("has no Search button in the bottom bar layout", () => {
    renderApp("bottom");
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });
});

describe("keyboard shortcuts help", () => {
  it("opens with ? and lists the shortcuts, with Ctrl on Windows", async () => {
    const { user } = renderApp();
    await user.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const text = dialog.textContent ?? "";
    for (const item of ["Search your cellar", "Add wine", "Open the command palette", "Ctrl"]) {
      expect(text).toContain(item);
    }
    expect(text).not.toContain("⌘");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows ⌘ on a Mac", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { user } = renderApp();
    await user.keyboard("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveTextContent("⌘");
  });

  it("does nothing while typing in an input", async () => {
    const { user } = renderApp();
    await user.type(screen.getByRole("textbox", { name: "Note" }), "why?n");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(path()).toBe("/");
  });
});
