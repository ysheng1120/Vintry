import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browser } from "./browser";
import { RouteError } from "./ErrorBoundary";

function Broken(): never {
  throw new Error("Kaboom in the cellar");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RouteError", () => {
  it("shows a friendly message with a Reload button when a screen crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.spyOn(browser, "reload").mockImplementation(() => {});
    const router = createMemoryRouter(
      [{ path: "/", Component: Broken, ErrorBoundary: RouteError }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", { name: "Something went wrong on this screen" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/your cellar data is safe/i)).toBeInTheDocument();
    expect(screen.getByText("Kaboom in the cellar")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
