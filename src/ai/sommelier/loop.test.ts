import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { makeLocation, makeLot, makeWine, resetDatabase } from "../../db/testing";
import { consumeBottles } from "../../domain/commands";
import type { Lot, Wine } from "../../domain/types";
import { saveApiKey } from "../client";
import { installFakeAi, uninstallFakeAi, type FakeAi } from "../fake";
import {
  askInNewThread,
  DECLINED_RESULT,
  EXPIRED_RESULT,
  expireStaleProposals,
  MAX_TOOL_ROUNDS,
  resolveProposal,
  ROUND_CAP_NOTICE,
  sendUserMessage,
} from "./loop";
import { getRunState } from "./runState";
import {
  expectValidConversation,
  lastToolResults,
  queueTools,
  text,
  textOf,
  toolUse,
} from "./testing";
import { listMessages, updateMeta, type Proposal, type ToolRecord } from "./thread";

let ai: FakeAi;
let kitchen: ReturnType<typeof makeLocation>;

beforeEach(async () => {
  await resetDatabase();
  ai = installFakeAi();
  await saveApiKey("sk-ant-test");
  kitchen = makeLocation({ name: "Kitchen rack" });
  await db.locations.add(kitchen);
});

afterEach(() => {
  uninstallFakeAi();
});

async function addWine(
  overrides: Partial<Wine> = {},
  quantity = 6,
): Promise<{ wine: Wine; lot: Lot }> {
  const wine = makeWine(overrides);
  const lot = makeLot({ wineId: wine.id, quantity, locationId: kitchen.id });
  await db.wines.add(wine);
  await db.lots.add(lot);
  return { wine, lot };
}

async function toolRecords(threadId: string): Promise<ToolRecord[]> {
  return (await listMessages(threadId)).flatMap((row) => row.meta.tools ?? []);
}

async function proposals(threadId: string): Promise<Proposal[]> {
  return (await toolRecords(threadId)).flatMap((r) => (r.proposal ? [r.proposal] : []));
}

async function notices(threadId: string): Promise<string[]> {
  return (await listMessages(threadId))
    .filter((row) => row.meta.kind === "notice")
    .map((row) => row.meta.text ?? "");
}

async function ask(question: string) {
  const { threadId, done } = await askInNewThread(question);
  await done;
  return threadId;
}

describe("read-only turns", () => {
  it("searches, shows only existing bottles, and answers", async () => {
    const { wine } = await addWine({ producer: "Ridge", name: "Monte Bello", vintage: 2019 });
    queueTools(ai, toolUse("search_cellar", { query: "Ridge" }, "t1"));
    queueTools(ai, toolUse("show_bottles", { wineIds: [wine.id, "no-such-wine"] }, "t2"));
    ai.queueText("Open the Monte Bello tonight.");

    const threadId = await ask("What should I open tonight?");

    expect(ai.requests).toHaveLength(3);
    for (const request of ai.requests) expectValidConversation(request.messages);
    const [search] = lastToolResults(ai.requests[1]?.messages ?? []);
    expect(search?.id).toBe("t1");
    expect(JSON.parse(search?.content ?? "{}")).toMatchObject({
      matches: 1,
      wines: [{ wineId: wine.id, bottles: 6 }],
    });

    const records = await toolRecords(threadId);
    expect(records.map((r) => r.chip)).toEqual(["Searched cellar: 1 match", null]);
    expect(records[1]?.wineIds).toEqual([wine.id]);
    const rows = await listMessages(threadId);
    expect(rows.at(-1)?.meta.kind).toBe("assistant");
    expect(rows.at(-1)?.content).toEqual([
      expect.objectContaining({ text: "Open the Monte Bello tonight." }),
    ]);
    expect(getRunState(threadId).busy).toBe(false);
  });

  it("show_bottles drops unknown and empty wines without an error", async () => {
    const { wine } = await addWine();
    const { wine: empty } = await addWine({ producer: "Empty" }, 0);
    queueTools(ai, toolUse("show_bottles", { wineIds: ["ghost", wine.id, empty.id] }, "t1"));
    ai.queueText("Here it is.");

    const threadId = await ask("Show me my Ridge");

    const [result] = lastToolResults(ai.requests[1]?.messages ?? []);
    expect(result?.isError).toBe(false);
    expect(JSON.parse(result?.content ?? "{}")).toEqual({
      shown: [{ wineId: wine.id, wine: "Ridge Monte Bello 2019", bottles: 6 }],
    });
    expect((await toolRecords(threadId))[0]?.wineIds).toEqual([wine.id]);
  });
});

describe("proposals", () => {
  it("pauses on propose_consume, then applies with source ai-chat and returns the new quantity", async () => {
    const { lot } = await addWine();
    queueTools(
      ai,
      text("Shall I record it?"),
      toolUse("propose_consume", { lotId: lot.id, quantity: 1 }, "c1"),
    );

    const threadId = await ask("I drank a Monte Bello");

    expect(ai.requests).toHaveLength(1);
    const [proposal] = await proposals(threadId);
    expect(proposal).toMatchObject({
      kind: "consume",
      status: "pending",
      title: "Drink 1 bottle of Ridge Monte Bello 2019",
    });
    expect(await db.eventBatches.count()).toBe(0);

    ai.queueText("Recorded. 5 left.");
    const outcome = await resolveProposal(threadId, "c1", { confirm: true });
    expect(outcome.status).toBe("applied");
    expect(outcome.result?.summary).toBe("Drank 1 bottle of Ridge Monte Bello 2019");
    await outcome.next;

    const batches = await db.eventBatches.toArray();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.source).toBe("ai-chat");
    expect((await db.lots.get(lot.id))?.quantity).toBe(5);

    expect(ai.requests).toHaveLength(2);
    const request = ai.requests[1]?.messages ?? [];
    expectValidConversation(request);
    const [result] = lastToolResults(request);
    expect(result?.id).toBe("c1");
    expect(JSON.parse(result?.content ?? "{}")).toMatchObject({
      status: "applied",
      lots: [{ lotId: lot.id, bottles: 5 }],
    });
    expect((await proposals(threadId))[0]).toMatchObject({
      status: "applied",
      batchId: batches[0]?.id,
    });
  });

  it("declining writes nothing and sends 'User declined'", async () => {
    const { lot } = await addWine();
    queueTools(ai, toolUse("propose_consume", { lotId: lot.id }, "c1"));
    const threadId = await ask("I drank one");

    ai.queueText("No problem.");
    const outcome = await resolveProposal(threadId, "c1", { confirm: false });
    await outcome.next;

    expect(outcome.status).toBe("declined");
    expect(await db.eventBatches.count()).toBe(0);
    expect((await db.lots.get(lot.id))?.quantity).toBe(6);
    expect(lastToolResults(ai.requests[1]?.messages ?? [])).toEqual([
      { id: "c1", content: DECLINED_RESULT, isError: false },
    ]);
  });

  it("returns candidates and no card when expectedQuantity does not match", async () => {
    const { lot } = await addWine();
    queueTools(ai, toolUse("propose_consume", { lotId: lot.id, expectedQuantity: 7 }, "c1"));
    ai.queueText("Your count changed; which bottle?");

    const threadId = await ask("I drank one");

    expect(await proposals(threadId)).toEqual([]);
    const [result] = lastToolResults(ai.requests[1]?.messages ?? []);
    expect(JSON.parse(result?.content ?? "{}")).toMatchObject({
      status: "quantity_changed",
      candidates: [{ lots: [{ lotId: lot.id, bottles: 6 }] }],
    });
    expect(await db.eventBatches.count()).toBe(0);
  });

  it("re-checks on confirm: a changed lot returns candidates and changes nothing", async () => {
    const { lot } = await addWine();
    queueTools(ai, toolUse("propose_consume", { lotId: lot.id, expectedQuantity: 6 }, "c1"));
    const threadId = await ask("I drank one");

    await consumeBottles({ lotId: lot.id, quantity: 2 }); // the user drinks two by hand meanwhile
    ai.queueText("It changed, let me check.");
    const outcome = await resolveProposal(threadId, "c1", { confirm: true });
    await outcome.next;

    expect(outcome.status).toBe("stale");
    expect((await db.lots.get(lot.id))?.quantity).toBe(4);
    expect(await db.eventBatches.count()).toBe(1); // only the user's own change
    const [result] = lastToolResults(ai.requests[1]?.messages ?? []);
    expect(JSON.parse(result?.content ?? "{}")).toMatchObject({
      status: "quantity_changed",
      candidates: [{ lots: [{ lotId: lot.id, bottles: 4 }] }],
    });
  });

  it("AE3: an ambiguous 'the Monte Bello' gets candidates and the model asks which vintage", async () => {
    await addWine({ vintage: 2016 });
    await addWine({ vintage: 2019 });
    queueTools(ai, toolUse("propose_consume", { wineQuery: "Monte Bello" }, "c1"));
    ai.queueText("Which vintage did you drink, the 2016 or the 2019?");

    const threadId = await ask("I drank the Monte Bello");

    const [result] = lastToolResults(ai.requests[1]?.messages ?? []);
    const body = JSON.parse(result?.content ?? "{}") as { status: string; candidates: unknown[] };
    expect(body.status).toBe("needs_choice");
    expect(body.candidates).toHaveLength(2);
    expect(await proposals(threadId)).toEqual([]);
    expect(await db.eventBatches.count()).toBe(0);
    const rows = await listMessages(threadId);
    expect(JSON.stringify(rows.at(-1)?.content)).toContain("Which vintage");
  });

  it("sends both tool_results in one message once two cards are resolved", async () => {
    const { lot } = await addWine();
    const other = await addWine({ producer: "Musar", name: "", vintage: 2005 });
    queueTools(
      ai,
      toolUse("propose_consume", { lotId: lot.id }, "c1"),
      toolUse("propose_move", { lotId: other.lot.id, quantity: 2, toLocationId: null }, "m1"),
    );
    const threadId = await ask("Drink one Ridge and take two Musar out");

    const first = await resolveProposal(threadId, "c1", { confirm: true });
    await first.next;
    expect(ai.requests).toHaveLength(1); // still waiting for the second card

    ai.queueText("Both done.");
    const second = await resolveProposal(threadId, "m1", { confirm: false });
    await second.next;

    expect(ai.requests).toHaveLength(2);
    const request = ai.requests[1]?.messages ?? [];
    expectValidConversation(request);
    expect(lastToolResults(request).map((r) => [r.id, r.content === DECLINED_RESULT])).toEqual([
      ["c1", false],
      ["m1", true],
    ]);
  });

  it("a new message while a card waits sends the expired tool_result first", async () => {
    const { lot } = await addWine();
    queueTools(ai, toolUse("propose_consume", { lotId: lot.id }, "c1"));
    const threadId = await ask("I drank one");

    ai.queueText("Sure, what next?");
    await sendUserMessage(threadId, "Actually, never mind");

    const request = ai.requests[1]?.messages ?? [];
    expectValidConversation(request);
    const last = request.at(-1);
    const blocks = Array.isArray(last?.content) ? last.content : [];
    expect(blocks[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "c1",
      content: EXPIRED_RESULT,
    });
    expect(textOf(last)).toContain("Actually, never mind");
    expect((await proposals(threadId))[0]?.status).toBe("expired");
    expect(await db.eventBatches.count()).toBe(0);
  });

  it("a card from an earlier session expires when the thread is reopened and cannot be confirmed", async () => {
    const { lot } = await addWine();
    queueTools(ai, toolUse("propose_consume", { lotId: lot.id }, "c1"));
    const threadId = await ask("I drank one");

    // Pretend the card was made by an earlier page load.
    const row = (await listMessages(threadId)).find((r) => r.meta.tools);
    if (!row?.meta.tools) throw new Error("no card");
    await updateMeta(row.id, {
      ...row.meta,
      tools: row.meta.tools.map((t) => ({
        ...t,
        proposal: t.proposal && { ...t.proposal, sessionId: "earlier-session" },
      })),
    });

    await expireStaleProposals(threadId);
    expect((await proposals(threadId))[0]?.status).toBe("expired");
    const confirm = await resolveProposal(threadId, "c1", { confirm: true });
    expect(confirm.status).toBe("expired");
    expect(await db.eventBatches.count()).toBe(0);

    ai.queueText("Hello again.");
    await sendUserMessage(threadId, "Hello");
    const request = ai.requests[1]?.messages ?? [];
    expectValidConversation(request);
    expect(lastToolResults(request)).toEqual([
      { id: "c1", content: EXPIRED_RESULT, isError: false },
    ]);
  });

  it("applies an add proposal with the drafts the collector finished in the card", async () => {
    queueTools(
      ai,
      toolUse(
        "propose_add_bottles",
        {
          drafts: [
            {
              producer: "Ridge",
              name: "Geyserville",
              vintage: 2021,
              colour: "red",
              lots: [{ quantity: 6 }],
            },
          ],
        },
        "a1",
      ),
    );
    const threadId = await ask("I bought six Geyserville 2021");
    const [proposal] = await proposals(threadId);
    expect(proposal).toMatchObject({ kind: "add", title: "Add 6 bottles" });

    ai.queueText("Added.");
    const outcome = await resolveProposal(threadId, "a1", {
      confirm: true,
      drafts: [
        {
          producer: "Ridge",
          name: "Geyserville",
          vintage: 2021,
          colour: "red",
          lots: [{ quantity: 5, locationId: kitchen.id }],
        },
      ],
    });
    await outcome.next;

    expect(outcome.result?.summary).toBe("Added 5 bottles of Ridge Geyserville 2021");
    expect((await db.eventBatches.toArray())[0]?.source).toBe("ai-chat");
    expect(
      JSON.parse(lastToolResults(ai.requests[1]?.messages ?? [])[0]?.content ?? "{}"),
    ).toMatchObject({
      status: "applied",
      lots: [{ bottles: 5, location: "Kitchen rack" }],
    });
  });
});

describe("limits and failures", () => {
  it(`stops after ${MAX_TOOL_ROUNDS} tool rounds with a plain message`, async () => {
    for (let i = 0; i < MAX_TOOL_ROUNDS + 2; i++) queueTools(ai, toolUse("cellar_stats", {}));

    const threadId = await ask("Tell me everything");

    expect(ai.requests).toHaveLength(MAX_TOOL_ROUNDS);
    expect(await notices(threadId)).toEqual([ROUND_CAP_NOTICE]);
    expect(getRunState(threadId).busy).toBe(false);
  });

  it("shows an API failure as a plain notice", async () => {
    ai.queueError(new DOMException("aborted", "AbortError"));
    const threadId = await ask("Hello");
    expect(await notices(threadId)).toEqual(["Stopped."]);
  });

  it("does not run tools from a refused reply", async () => {
    await addWine();
    ai.queueResponse({ content: [toolUse("cellar_stats", {})], stop_reason: "refusal" });
    const threadId = await ask("Hello");
    expect(await toolRecords(threadId)).toEqual([]);
    expect(await notices(threadId)).toEqual([expect.stringContaining("declined")]);
  });
});

describe("requests", () => {
  it("sends a cached static prompt, sorted tools, and the per-turn context as its own message", async () => {
    const { wine } = await addWine();
    ai.queueText("Hello!");
    ai.queueText("Again!");
    const { threadId, done } = await askInNewThread("Hi", { screen: { wineId: wine.id } });
    await done;
    await sendUserMessage(threadId, "Hi again");

    const [first, second] = ai.requests;
    if (!first || !second) throw new Error("two requests expected");
    expect(first.system).toEqual(second.system);
    expect(JSON.stringify(first.tools)).toBe(JSON.stringify(second.tools));
    const names = (first.tools ?? []).map((t) => ("name" in t ? t.name : ""));
    expect(names).toEqual([...names].sort());
    expect(names).toContain("propose_consume");
    expect(Array.isArray(first.system) && first.system[0]?.cache_control).toEqual({
      type: "ephemeral",
    });
    expect(JSON.stringify(first.system)).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no date in the prefix

    // Earlier turns are sent unchanged: the second request starts with the first one's messages.
    const strip = (value: unknown) =>
      JSON.stringify(value).replaceAll(',"cache_control":{"type":"ephemeral"}', "");
    expect(strip(second.messages.slice(0, 1))).toBe(strip(first.messages));

    const firstTurn = first.messages[0];
    const blocks = Array.isArray(firstTurn?.content) ? firstTurn.content : [];
    expect(blocks[0]).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(textOf(firstTurn)).toContain("Cellar snapshot");
    expect(textOf(firstTurn)).toContain(`wine id ${wine.id}`);
    expect(textOf(firstTurn)).toContain("Hi");

    const breakpoints = JSON.stringify(second).split('"cache_control"').length - 1;
    expect(breakpoints).toBeLessThanOrEqual(4);
  });
});
