import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveApiKey } from "../../ai/client";
import { fakeApiError, installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { ToastProvider } from "../../components/ui/Toast";
import { resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import { prepareLabelImage, type PreparedImage } from "../../lib/image";
import BatchScan, { MAX_BATCH_IMAGES } from "./BatchScan";

// jsdom cannot decode or draw images, so the downscale step (tested in src/lib/image.test.ts)
// is replaced with a fixed result here, the same way ScanPage.test.tsx does it.
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

function file(name: string): File {
  return new File(["jpeg"], name, { type: "image/jpeg" });
}

function renderBatch(files: File[]) {
  const onScanMore = vi.fn();
  const onDone = vi.fn();
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ToastProvider>
        <BatchScan files={files} onScanMore={onScanMore} onDone={onDone} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { user, onScanMore, onDone };
}

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
  ai = installFakeAi();
  await saveApiKey("sk-ant-test");
  vi.mocked(prepareLabelImage).mockResolvedValue(IMAGE);
  // jsdom has no Blob download machinery; stand in for it (as backup/index.test.tsx does).
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${n++}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  uninstallFakeAi();
});

describe("BatchScan", () => {
  it("shows the cost before reading, reads every photo, and keeps the batch open after a save", async () => {
    ai.queueJson(reading());
    ai.queueJson(reading());
    const { user } = renderBatch([file("a.jpg"), file("b.jpg")]);

    expect(
      await screen.findByText("This sends 2 photos to Claude with your key."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Read 2 labels" }));

    await screen.findByText("Read 2 of 2 labels");
    expect(ai.requests).toHaveLength(2);

    // One draft opens on its own; saving it does not close the batch.
    await user.click(await screen.findByRole("button", { name: "Add 1 bottle" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan more" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();

    // ...and the next ready draft opens in its place.
    expect(await screen.findByRole("button", { name: "Add 1 bottle" })).toBeInTheDocument();
  });

  it("never reads more than two labels at the same time", async () => {
    ai.queueJson(reading());
    ai.queueJson(reading());
    ai.queueJson(reading());
    ai.queueJson(reading());
    let concurrent = 0;
    let maxConcurrent = 0;
    const pending: ((image: PreparedImage) => void)[] = [];
    vi.mocked(prepareLabelImage).mockImplementation(
      () =>
        new Promise((resolve) => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          pending.push((image) => {
            concurrent--;
            resolve(image);
          });
        }),
    );
    const files = [file("a"), file("b"), file("c"), file("d")];
    const { user } = renderBatch(files);

    await user.click(await screen.findByRole("button", { name: "Read 4 labels" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(maxConcurrent).toBe(2);

    pending[0]?.(IMAGE);
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(maxConcurrent).toBe(2);

    pending[1]?.(IMAGE);
    await waitFor(() => expect(pending).toHaveLength(4));
    expect(maxConcurrent).toBe(2);

    pending[2]?.(IMAGE);
    pending[3]?.(IMAGE);
    await screen.findByText("Read 4 of 4 labels");
    expect(maxConcurrent).toBe(2);
  });

  it("shows the plain error and a Retry button, and retrying succeeds", async () => {
    ai.queueError(fakeApiError(500, "api_error", "boom"));
    const { user } = renderBatch([file("a.jpg")]);

    await user.click(await screen.findByRole("button", { name: "Read 1 label" }));

    expect(
      await screen.findByText("Anthropic had a problem on their side. Try again in a moment."),
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });

    ai.queueJson(reading());
    await user.click(retry);

    expect(await screen.findByRole("button", { name: "Add 1 bottle" })).toBeInTheDocument();
  });

  it("caps a large selection at 12 photos and says so plainly", async () => {
    const files = Array.from({ length: 15 }, (_, i) => file(`p${i}.jpg`));
    renderBatch(files);

    expect(
      await screen.findByText(`You chose 15 photos; Vintry reads the first ${MAX_BATCH_IMAGES}.`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Read ${MAX_BATCH_IMAGES} labels` }),
    ).toBeInTheDocument();
  });
});
