import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { HELP_SECTIONS } from "../../content/help";
import { TourHost } from "../tour/TourHost";
import { stopTour } from "../tour/tourStore";
import HelpPage from "./index";

function renderHelp(path = "/help") {
  const router = createMemoryRouter(
    [
      { path: "/help", element: <HelpPage /> },
      {
        path: "/",
        element: (
          <>
            <h1>Home</h1>
            <a href="#" data-tour="tour-home">
              Home link
            </a>
            <TourHost />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("HelpPage", () => {
  beforeEach(() => {
    act(() => stopTour());
  });

  it("shows every task section with a contents link to it", () => {
    renderHelp();
    expect(
      screen.getByRole("heading", { level: 1, name: "How to use Vintry" }),
    ).toBeInTheDocument();
    const contents = screen.getByRole("navigation", { name: "Contents" });
    for (const title of [
      "Add a bottle",
      "Drink a bottle",
      "Move bottles",
      "Ask the sommelier",
      "Import from CellarTracker or Vivino",
      "Back up and move to a new computer",
      "Install Vintry as an app",
      "Get an AI key",
      "Privacy",
      "Updating Vintry",
      "Keyboard shortcuts",
    ]) {
      const section = HELP_SECTIONS.find((s) => s.title === title);
      expect(section, title).toBeDefined();
      expect(within(contents).getByRole("link", { name: title })).toHaveAttribute(
        "href",
        `#${section!.id}`,
      );
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it("gives the AI key section the ai-key anchor, with the three key steps", () => {
    renderHelp();
    const section = document.getElementById("ai-key");
    expect(section).not.toBeNull();
    const text = section!.textContent ?? "";
    expect(text).toContain("console.anthropic.com");
    expect(text).toContain("Billing");
    expect(text).toContain("Create Key");
  });

  it("lists the keyboard shortcuts", () => {
    renderHelp();
    const section = document.getElementById("shortcuts")!;
    expect(within(section).getByText("Search your cellar")).toBeInTheDocument();
    expect(within(section).getByText("Add wine")).toBeInTheDocument();
  });

  it("starts the tour again from Help", async () => {
    const router = renderHelp();
    await userEvent.setup().click(screen.getByRole("button", { name: "Take the tour again" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
