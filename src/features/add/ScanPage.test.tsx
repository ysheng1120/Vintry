import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, useParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveApiKey } from "../../ai/client";
import { installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeLot, makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import { ImageError, prepareLabelImage, type PreparedImage } from "../../lib/image";
import ScanPage from "./ScanPage";

// jsdom cannot decode or draw images, so the downscale step (tested in src/lib/image.test.ts)
// is replaced with a fixed result here.
vi.mock("../../lib/image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/image")>();
  return { ...actual, prepareLabelImage: vi.fn() };
});

const IMAGE: PreparedImage = {
  base64: "QUJD",
  mediaType: "image/jpeg",
  width: 1568,
  height: 1176,
  thumbnail: "data:image/jpeg;base64,VEhVTUI=",
};

let ai: FakeAi;

function reading(overrides: Record<string, unknown> = {}) {
  return {
    isWineLabel: true,
    producer: "Ridge",
    name: "Monte Bello",
    vintage: 2019,
    nonVintage: false,
    colour: "red",
    country: "USA",
    region: "California",
    appellation: "Santa Cruz Mountains",
    grapes: ["Cabernet Sauvignon"],
    bottleSizeMl: 750,
    lowConfidence: [],
    notes: [],
    ...overrides,
  };
}

function WinePage() {
  return <h1>Wine {useParams().id}</h1>;
}

function renderScan() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <ToastProvider>
            <Outlet />
          </ToastProvider>
        ),
        children: [
          { path: "add", element: <h1>Add wine</h1> },
          { path: "add/scan", Component: ScanPage },
          { path: "add/manual", element: <h1>Add by hand</h1> },
          { path: "wine/:id", Component: WinePage },
        ],
      },
    ],
    { initialEntries: ["/add/scan"] },
  );
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return { user, router };
}

async function choosePhoto(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText("Choose photo");
  await user.upload(input, new File(["jpeg"], "label.jpg", { type: "image/jpeg" }));
}

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
  ai = installFakeAi();
  vi.mocked(prepareLabelImage).mockResolvedValue(IMAGE);
});

afterEach(() => {
  uninstallFakeAi();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("Scan a label", () => {
  it("explains the key, links to Settings, and offers Add by hand without a key", async () => {
    renderScan();
    expect(await screen.findByText("AI needs your Claude API key")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a key in Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByRole("link", { name: "How to get a key" })).toHaveAttribute(
      "href",
      "/help#ai-key",
    );
    expect(screen.getByRole("link", { name: "Add by hand" })).toHaveAttribute(
      "href",
      "/add/manual",
    );
    expect(screen.queryByLabelText("Choose photo")).not.toBeInTheDocument();
  });

  it("offers adding bottles to a wine already in the cellar and saves a lot, not a wine", async () => {
    await saveApiKey("sk-ant-test");
    const wine = makeWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    await db.wines.add(wine);
    await db.lots.add(makeLot({ wineId: wine.id, quantity: 2 }));
    ai.queueJson(reading());
    const { user } = renderScan();

    await choosePhoto(user);
    await user.click(await screen.findByRole("button", { name: "Read label" }));

    expect(await screen.findByText(/Add to existing wine/)).toHaveTextContent(
      "Add to existing wine: Ridge Monte Bello 2019",
    );
    await user.click(screen.getByRole("button", { name: "Add 1 bottle" }));

    expect(await screen.findByRole("heading", { name: `Wine ${wine.id}` })).toBeInTheDocument();
    expect(await db.wines.count()).toBe(1);
    const lots = await db.lots.where("wineId").equals(wine.id).toArray();
    expect(lots.map((l) => l.quantity).sort()).toEqual([1, 2]);
    const batches = await db.eventBatches.toArray();
    expect(batches.at(-1)?.source).toBe("ai-scan");
    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await toasts.findByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("highlights a low-confidence vintage and keeps the label thumbnail on a new wine", async () => {
    await saveApiKey("sk-ant-test");
    ai.queueJson(reading({ lowConfidence: ["vintage"] }));
    const { user } = renderScan();

    await choosePhoto(user);
    await user.click(await screen.findByRole("button", { name: "Read label" }));

    const vintage = await screen.findByLabelText(/Vintage/);
    expect(vintage).toHaveAccessibleDescription(/Please check this/);
    expect(screen.getByLabelText(/Producer/)).not.toHaveAccessibleDescription(/Please check this/);
    await user.click(screen.getByRole("button", { name: "Add 1 bottle" }));

    await screen.findByRole("heading", { name: /^Wine / });
    const [saved] = await db.wines.toArray();
    expect(saved?.thumbnail).toBe(IMAGE.thumbnail);
  });

  it("shows the plain message for a photo the browser cannot read", async () => {
    await saveApiKey("sk-ant-test");
    vi.mocked(prepareLabelImage).mockRejectedValue(new ImageError());
    const { user } = renderScan();

    await choosePhoto(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This photo format isn't supported here. Try the camera button or a JPEG.",
    );
    expect(ai.requests).toHaveLength(0);
  });

  it("shows the AI error and lets the user try again", async () => {
    await saveApiKey("sk-ant-test");
    ai.queueJson(reading({ isWineLabel: false, producer: null }));
    const { user } = renderScan();

    await choosePhoto(user);
    await user.click(await screen.findByRole("button", { name: "Read label" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't find a wine label/);
    expect(screen.getByRole("button", { name: "Read label" })).toBeEnabled();
  });

  it("hides the camera button with a note when camera access is refused", async () => {
    await saveApiKey("sk-ant-test");
    // jsdom has no camera API; add one that refuses access.
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        }),
      },
    });
    const { user } = renderScan();

    await user.click(await screen.findByRole("button", { name: "Use camera" }));

    expect(await screen.findByText(/camera isn't available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use camera" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Choose photo")).toBeInTheDocument();
  });
});
