import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../ai/client";
import { installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { queueTools, text, textOf, toolUse } from "../../ai/sommelier/testing";
import { appendMessage, createThread, type Proposal } from "../../ai/sommelier/thread";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import SommelierHome, { ThreadPage } from ".";

let ai: FakeAi;

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname + location.search}</output>;
}

function renderChat(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <ToastProvider>
            <CurrentPath />
            <Outlet />
          </ToastProvider>
        ),
        children: [
          { path: "sommelier", Component: SommelierHome },
          { path: "sommelier/:threadId", Component: ThreadPage },
          { path: "wine/:id", element: <h1>Wine page</h1> },
          { path: "settings", element: <h1>Settings</h1> },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  );
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return { user, router };
}

async function seed() {
  const location = makeLocation({ name: "Kitchen rack" });
  const wine = makeWine({ windowFrom: 2020, windowTo: 2035 });
  const lot = makeLot({ wineId: wine.id, quantity: 6, locationId: location.id });
  await db.locations.add(location);
  await db.wines.add(wine);
  await db.lots.add(lot);
  return { wine, lot };
}

beforeEach(async () => {
  await resetDatabase();
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

/** Sending runs several database writes and the AI call; under full-suite load it can pass 1s. */
const SLOW = { timeout: 5000 };

async function clickSend(user: ReturnType<typeof userEvent.setup>) {
  const send = screen.getByRole("button", { name: "Send" });
  await waitFor(() => expect(send).toBeEnabled(), SLOW);
  await user.click(send);
}

describe("Sommelier chat", () => {
  it("explains that a key is needed and offers the cellar instead", async () => {
    renderChat("/sommelier");
    expect(await screen.findByText("AI needs your Claude API key")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a key in Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.queryByRole("textbox", { name: /ask the sommelier/i })).not.toBeInTheDocument();
  });

  it("answers a suggested prompt with tool chips and bottle cards for real wines only", async () => {
    await saveApiKey("sk-ant-test");
    const { wine } = await seed();
    queueTools(ai, toolUse("search_cellar", { statuses: ["ready"] }));
    queueTools(ai, toolUse("show_bottles", { wineIds: [wine.id, "ghost-wine"] }));
    ai.queueText("The Monte Bello is ready. Open it tonight.");

    const { user } = renderChat("/sommelier");
    expect(
      await screen.findByText(/sends details of your cellar to Anthropic/),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "What should I open tonight?" }));

    expect(
      await screen.findByText("The Monte Bello is ready. Open it tonight.", {}, SLOW),
    ).toBeInTheDocument();
    expect(screen.getByTestId("path").textContent).toMatch(/^\/sommelier\/[\w-]+$/);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(within(log).getByText("What should I open tonight?")).toBeInTheDocument();
    expect(screen.getByText("Searched cellar: 1 match")).toBeInTheDocument();
    const cards = await screen.findByRole("list", { name: "Bottles" });
    const links = within(cards).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", `/wine/${wine.id}`);
    expect(links[0]).toHaveTextContent("Ridge Monte Bello 2019");
    expect(
      await screen.findByRole("link", { name: /What should I open tonight/ }),
    ).toBeInTheDocument();
  });

  it("asks about the wine the user came from", async () => {
    await saveApiKey("sk-ant-test");
    const { wine } = await seed();
    ai.queueText("Drink it from 2025.");

    const { user } = renderChat(`/sommelier?wine=${wine.id}`);
    expect(await screen.findByText(/Asking about Ridge Monte Bello 2019/)).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: /ask the sommelier/i }),
      "When should I drink it?",
    );
    await clickSend(user);

    expect(await screen.findByText("Drink it from 2025.", {}, SLOW)).toBeInTheDocument();
    expect(textOf(ai.requests[0]?.messages[0])).toContain(`wine id ${wine.id}`);
    expect(screen.getByTestId("path").textContent).toContain(`?wine=${wine.id}`);
  });

  it("prefills the composer from ?ask= without sending it, and clears the param", async () => {
    await saveApiKey("sk-ant-test");

    const { user } = renderChat(
      `/sommelier?ask=${encodeURIComponent("  What should I open tonight?  ")}`,
    );
    const input = await screen.findByRole("textbox", { name: /ask the sommelier/i });
    // The prefill and focus run in an effect after the composer first renders.
    await waitFor(() => {
      expect(input).toHaveValue("What should I open tonight?");
      expect(input).toHaveFocus();
    });
    await waitFor(() => expect(screen.getByTestId("path")).not.toHaveTextContent("ask"));

    // The user must press Send; nothing was sent on their behalf.
    expect(ai.requests).toHaveLength(0);

    ai.queueText("Try the Barolo.");
    await clickSend(user);
    await screen.findByText("Try the Barolo.", {}, SLOW);
    expect(ai.requests).toHaveLength(1);
  });

  it("caps a long ?ask= at 500 characters", async () => {
    await saveApiKey("sk-ant-test");
    const long = "a".repeat(600);

    renderChat(`/sommelier?ask=${long}`);
    const input = await screen.findByRole("textbox", { name: /ask the sommelier/i });
    expect(input).toHaveValue("a".repeat(500));
  });

  it("keeps ?wine= when clearing ?ask=", async () => {
    await saveApiKey("sk-ant-test");
    const { wine } = await seed();

    renderChat(`/sommelier?wine=${wine.id}&ask=${encodeURIComponent("Pair with lamb")}`);
    const input = await screen.findByRole("textbox", { name: /ask the sommelier/i });
    expect(input).toHaveValue("Pair with lamb");
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(`/sommelier?wine=${wine.id}`),
    );
  });

  it("confirms a proposal card, applies it, and offers Undo", async () => {
    await saveApiKey("sk-ant-test");
    const { lot } = await seed();
    queueTools(ai, text("Shall I record that?"), toolUse("propose_consume", { lotId: lot.id }));
    ai.queueText("Recorded. You have 5 left.");

    const { user } = renderChat("/sommelier");
    await user.type(
      await screen.findByRole("textbox", { name: /ask the sommelier/i }),
      "I drank a Monte Bello",
    );
    await clickSend(user);

    const card = await screen.findByRole("group", {
      name: "Drink 1 bottle of Ridge Monte Bello 2019",
    });
    expect(within(card).getByText("From Kitchen rack: 6 now, 5 after")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Recorded. You have 5 left.", {}, SLOW)).toBeInTheDocument();
    expect(within(card).getByText("Done")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect((await db.lots.get(lot.id))?.quantity).toBe(5);
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("shows a card from an earlier session as expired, with no way to confirm it", async () => {
    await saveApiKey("sk-ant-test");
    const { wine, lot } = await seed();
    const thread = await createThread("Drinks");
    await appendMessage(thread.id, "user", "I drank one", { kind: "user" });
    const proposal: Proposal = {
      kind: "consume",
      command: "consumeBottles",
      input: { lotId: lot.id, quantity: 1, expectedQuantity: 6 },
      title: "Drink 1 bottle of Ridge Monte Bello 2019",
      lines: ["From Kitchen rack: 6 now, 5 after"],
      wineId: wine.id,
      status: "pending",
      sessionId: "an-earlier-session",
      outcome: null,
      batchId: null,
    };
    await appendMessage(
      thread.id,
      "assistant",
      [{ type: "tool_use", id: "c1", name: "propose_consume", input: { lotId: lot.id } }],
      {
        kind: "assistant",
        round: 1,
        tools: [
          { id: "c1", name: "propose_consume", chip: null, wineIds: [], proposal, result: null },
        ],
      },
    );

    renderChat(`/sommelier/${thread.id}`);
    const card = await screen.findByRole("group", { name: proposal.title });
    await waitFor(() => expect(within(card).getByText("Expired")).toBeInTheDocument());
    expect(within(card).queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(await db.eventBatches.count()).toBe(0);
    const results = await db.chatMessages.where("threadId").equals(thread.id).toArray();
    expect(JSON.stringify(results)).toContain("Proposal expired, not applied");
  });

  it("opens an add proposal as an editable draft card that saves with source ai-chat", async () => {
    await saveApiKey("sk-ant-test");
    await seed();
    queueTools(
      ai,
      toolUse("propose_add_bottles", {
        drafts: [
          {
            producer: "Ridge",
            name: "Geyserville",
            vintage: 2021,
            colour: "red",
            lots: [{ quantity: 3 }],
          },
        ],
      }),
    );
    ai.queueText("Added them.");

    const { user } = renderChat("/sommelier");
    await user.type(
      await screen.findByRole("textbox", { name: /ask the sommelier/i }),
      "I bought 3 Geyserville 2021",
    );
    await clickSend(user);

    await user.click(await screen.findByRole("button", { name: "Add 3 bottles" }));
    expect(await screen.findByText("Added them.", {}, SLOW)).toBeInTheDocument();
    const batches = await db.eventBatches.toArray();
    expect(batches.map((b) => [b.source, b.summary])).toEqual([
      ["ai-chat", "Added 3 bottles of Ridge Geyserville 2021"],
    ]);
  });
});
