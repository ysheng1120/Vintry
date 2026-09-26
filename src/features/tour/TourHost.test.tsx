import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { getSetting, setSetting } from "../../db/settings";
import { resetDatabase } from "../../db/testing";
import { ONBOARDING_KEYS } from "../onboarding/settingKeys";
import { TOUR_STEPS } from "./steps";
import { TourHost } from "./TourHost";
import { startTour, stopTour } from "./tourStore";

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            <nav>
              {TOUR_STEPS.map((s) => (
                <a key={s.anchor} href="#" data-tour={s.anchor}>
                  {s.title}
                </a>
              ))}
            </nav>
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

async function finishTour() {
  const user = userEvent.setup();
  for (let i = 0; i < TOUR_STEPS.length; i += 1) {
    const last = i === TOUR_STEPS.length - 1;
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: last ? "Done" : "Next" }),
    );
  }
}

describe("TourHost", () => {
  beforeEach(async () => {
    await resetDatabase();
    act(() => stopTour());
  });

  it("starts the pending tour on Home after onboarding", async () => {
    await setSetting(ONBOARDING_KEYS.tourPending, true);
    renderAt("/");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await getSetting(ONBOARDING_KEYS.tourPending, null)).toBe(false);
  });

  it("waits for Home before starting", async () => {
    await setSetting(ONBOARDING_KEYS.tourPending, true);
    const router = renderAt("/cellar");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(() => router.navigate("/"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("records completion and does not show again", async () => {
    await setSetting(ONBOARDING_KEYS.tourPending, true);
    renderAt("/");
    await screen.findByRole("dialog");
    await finishTour();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(async () => expect(await getSetting(ONBOARDING_KEYS.tourDone, false)).toBe(true));
  });

  it("records a skip as done too", async () => {
    await setSetting(ONBOARDING_KEYS.tourPending, true);
    renderAt("/");
    const dialog = await screen.findByRole("dialog");
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Skip tour" }));
    await waitFor(async () => expect(await getSetting(ONBOARDING_KEYS.tourDone, false)).toBe(true));
  });

  it("shows nothing without a pending tour, but runs again when started from Help", async () => {
    await setSetting(ONBOARDING_KEYS.tourDone, true);
    renderAt("/");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => startTour());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
