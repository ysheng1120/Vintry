import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../ai/client";
import { installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import DescribePage from "./DescribePage";

let ai: FakeAi;

function described(overrides: Record<string, unknown> = {}) {
  return {
    producer: null,
    name: "Barolo",
    vintage: 2016,
    nonVintage: false,
    colour: "red",
    country: "Italy",
    region: "Piedmont",
    appellation: "Barolo",
    grapes: ["Nebbiolo"],
    bottleSizeMl: null,
    quantity: 12,
    price: 600,
    currency: "GBP",
    priceBasis: "total",
    store: null,
    purchaseDate: null,
    location: null,
    lowConfidence: ["producer"],
    notes: ["case assumed 12"],
    ...overrides,
  };
}

function renderDescribe() {
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
          { path: "add/describe", Component: DescribePage },
          { path: "add/manual", element: <h1>Add by hand</h1> },
          { path: "wine/:id", element: <h1>Wine</h1> },
          { path: "cellar", element: <h1>Cellar</h1> },
        ],
      },
    ],
    { initialEntries: ["/add/describe"] },
  );
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return { user, router };
}

async function describeText(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByLabelText("What did you buy?"), text);
  await user.click(screen.getByRole("button", { name: "Make a draft" }));
}

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
  Reflect.deleteProperty(window, "webkitSpeechRecognition");
});

describe("Describe in words", () => {
  it("explains the key and offers Add by hand without a key", async () => {
    renderDescribe();
    expect(await screen.findByText("AI needs your Claude API key")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add by hand" })).toHaveAttribute(
      "href",
      "/add/manual",
    );
    expect(screen.queryByLabelText("What did you buy?")).not.toBeInTheDocument();
  });

  it("turns a case for £600 into 12 bottles with the note and a total price of £50 a bottle", async () => {
    await saveApiKey("sk-ant-test");
    ai.queueJson({ wines: [described()] });
    const { user } = renderDescribe();

    await describeText(user, "a case of 2016 Barolo for £600");

    expect(await screen.findByText("case assumed 12")).toBeInTheDocument();
    expect(screen.getByLabelText("Bottles")).toHaveValue(12);
    expect(screen.getByRole("radio", { name: "For all bottles" })).toBeChecked();
    expect(screen.getByLabelText("Price for all bottles")).toHaveValue("600");

    await user.click(screen.getByRole("radio", { name: "Per bottle" }));
    expect(screen.getByLabelText("Price per bottle")).toHaveValue("50");
    expect(String(ai.requests[0]?.messages[0]?.content)).toContain(
      "a case of 2016 Barolo for £600",
    );
  });

  it("puts two wines from one sentence on one card and saves both", async () => {
    await saveApiKey("sk-ant-test");
    ai.queueJson({
      wines: [
        described({
          producer: "Ridge",
          name: "Monte Bello",
          vintage: 2019,
          quantity: 6,
          price: null,
          notes: [],
        }),
        described({
          producer: "Dönnhoff",
          name: "Hermannshöhle",
          vintage: 2021,
          quantity: 3,
          price: null,
          notes: [],
        }),
      ],
    });
    const { user } = renderDescribe();

    await describeText(user, "6 Monte Bello 2019 and 3 Dönnhoff Hermannshöhle 2021");

    expect(await screen.findByRole("heading", { name: "Wine 1 of 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wine 2 of 2" })).toBeInTheDocument();
    const producers = screen
      .getAllByLabelText(/Producer/)
      .map((i) => (i as HTMLInputElement).value);
    expect(producers).toEqual(["Ridge", "Dönnhoff"]);
    await user.click(screen.getByRole("button", { name: "Add 9 bottles" }));

    await screen.findByRole("heading", { name: "Cellar" });
    expect(await db.wines.count()).toBe(2);
    expect((await db.eventBatches.toArray()).at(-1)?.source).toBe("ai-describe");
  });

  it("says so when no wine was found and keeps the text", async () => {
    await saveApiKey("sk-ant-test");
    ai.queueJson({ wines: [] });
    const { user } = renderDescribe();

    await describeText(user, "hello there");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't find a wine/);
    expect(screen.getByLabelText("What did you buy?")).toHaveValue("hello there");
  });

  it("offers the microphone when the browser has speech recognition", async () => {
    await saveApiKey("sk-ant-test");
    class FakeRecognition {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        this.onresult?.({ results: [[{ transcript: "six bottles of Monte Bello" }]] });
        this.onend?.();
      }
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const { user } = renderDescribe();

    await user.click(await screen.findByRole("button", { name: "Speak" }));

    expect(screen.getByLabelText("What did you buy?")).toHaveValue("six bottles of Monte Bello");
    expect(screen.getByText(/browser's speech service/)).toBeInTheDocument();
  });
});
