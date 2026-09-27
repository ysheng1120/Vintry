import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import {
  changelogNewestFirst,
  compareVersions,
  type ChangelogEntry,
} from "../../content/changelog";
import { getSetting, setSetting } from "../../db/settings";
import { resetDatabase } from "../../db/testing";
import { ONBOARDING_KEYS } from "../onboarding/settingKeys";
import WhatsNewPage from "./index";
import { WhatsNewNotice } from "./WhatsNewNotice";

// vitest.config.ts defines __APP_VERSION__ as "1.0.0-test".
const VERSION = "1.0.0-test";

function renderShell() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <ToastProvider>
            <WhatsNewNotice />
            <h1>Home</h1>
          </ToastProvider>
        ),
      },
      { path: "/whats-new", element: <WhatsNewPage /> },
    ],
    { initialEntries: ["/"] },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, view };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("changelog", () => {
  it("sorts versions newest first", () => {
    const entries: ChangelogEntry[] = [
      { version: "1.2.0", date: "2027-01-01", headline: "b", changes: [] },
      { version: "1.10.0", date: "2027-03-01", headline: "c", changes: [] },
      { version: "1.0.0", date: "2026-09-26", headline: "a", changes: [] },
    ];
    expect(changelogNewestFirst(entries).map((e) => e.version)).toEqual([
      "1.10.0",
      "1.2.0",
      "1.0.0",
    ]);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });
});

describe("WhatsNewPage", () => {
  it("lists the launch release with its features", () => {
    const router = createMemoryRouter([{ path: "/", element: <WhatsNewPage /> }]);
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("heading", { level: 1, name: "What's new" })).toBeInTheDocument();
    const versions = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(versions[0]).toContain("1.5.0");
    expect(versions.some((v) => v?.includes("1.0.0"))).toBe(true);
    expect(screen.getByText(/Import from CellarTracker and Vivino/)).toBeInTheDocument();
  });
});

describe("WhatsNewNotice", () => {
  beforeEach(resetDatabase);

  it("says nothing on the very first run, and remembers the version", async () => {
    renderShell();
    await waitFor(async () =>
      expect(await getSetting(ONBOARDING_KEYS.lastSeenVersion, null)).toBe(VERSION),
    );
    await settle();
    expect(screen.queryByText(/What's new in version/)).not.toBeInTheDocument();
  });

  it("shows once after an update and links to What's New", async () => {
    await setSetting(ONBOARDING_KEYS.onboardingDone, true);
    await setSetting(ONBOARDING_KEYS.lastSeenVersion, "0.9.0");
    const { router, view } = renderShell();
    expect(await screen.findByText(`What's new in version ${VERSION}`)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "See what's new" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/whats-new"));

    // The next launch of the same version stays quiet.
    view.unmount();
    renderShell();
    await settle();
    expect(screen.queryByText(/What's new in version/)).not.toBeInTheDocument();
  });

  it("shows for a collector who used Vintry before this notice existed", async () => {
    await setSetting(ONBOARDING_KEYS.onboardingDone, true);
    renderShell();
    expect(await screen.findByText(`What's new in version ${VERSION}`)).toBeInTheDocument();
  });
});
