import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../db/db";
import { setSetting } from "../db/settings";
import { resetDatabase } from "../db/testing";
import { saveApiKey } from "./client";
import { AiError } from "./errors";
import { fakeApiError, installFakeAi, uninstallFakeAi, type FakeAi } from "./fake";
import { runStructured, stripFence } from "./structured";

const Wine = z.object({ producer: z.string(), vintage: z.number().int().min(1800) });

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  ai = installFakeAi();
  await saveApiKey("sk-ant-test");
});

afterEach(() => {
  uninstallFakeAi();
});

function run(overrides: Partial<Parameters<typeof runStructured>[0]> = {}) {
  return runStructured({
    feature: "describe",
    schema: Wine,
    system: "Extract the wine.",
    content: "2019 Ridge Monte Bello",
    effort: "low",
    ...overrides,
  });
}

describe("runStructured", () => {
  it("returns the validated object and records usage by the served model", async () => {
    ai.queueJson(
      { producer: "Ridge", vintage: 2019 },
      { usage: { input_tokens: 1000, output_tokens: 500 } },
    );
    await expect(run()).resolves.toEqual({ producer: "Ridge", vintage: 2019 });
    const rows = await db.aiUsage.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "describe",
      model: "claude-opus-5",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.0175,
    });
  });

  it("prices usage by the model the response reports, not the one requested", async () => {
    ai.queueJson(
      { producer: "Ridge", vintage: 2019 },
      { model: "claude-sonnet-5", usage: { input_tokens: 1_000_000, output_tokens: 0 } },
    );
    await run();
    const [row] = await db.aiUsage.toArray();
    expect(row).toMatchObject({ model: "claude-sonnet-5", costUsd: 2 });
  });

  it("stores a null cost when the served model has no known price", async () => {
    ai.queueJson({ producer: "Ridge", vintage: 2019 }, { model: "claude-mystery-9" });
    await run();
    const [row] = await db.aiUsage.toArray();
    expect(row?.model).toBe("claude-mystery-9");
    expect(row?.costUsd).toBeNull();
  });

  it("raises a typed error when the output fails validation, and still records usage", async () => {
    ai.queueJson({ producer: "Ridge", vintage: 1200 });
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("invalid-output");
    expect(await db.aiUsage.count()).toBe(1);
  });

  it("raises invalid output when the text is not JSON", async () => {
    ai.queueText("Sorry, here is some prose.");
    await expect(run()).rejects.toMatchObject({ kind: "invalid-output" });
  });

  it("surfaces a refusal as a plain message without parsing the content", async () => {
    ai.queueJson({ producer: "Ridge", vintage: 2019 }, { stop_reason: "refusal" });
    const error = (await run().catch((e: unknown) => e)) as AiError;
    expect(error.kind).toBe("refusal");
    expect(error.message).toBe(
      "Claude declined this request. Try rewording it, or add the details by hand.",
    );
  });

  it("reports a cut-off answer when the response hit max_tokens", async () => {
    ai.queueText('{"producer": "Ri', { stop_reason: "max_tokens" });
    await expect(run()).rejects.toMatchObject({ kind: "max-tokens" });
  });

  it("refuses to send anything without a key", async () => {
    await setSetting("apiKey", "");
    await expect(run()).rejects.toMatchObject({ kind: "no-key" });
    expect(ai.requests).toHaveLength(0);
  });

  it("maps an API error to a plain AiError", async () => {
    ai.queueError(fakeApiError(429, "rate_limit_error", "slow down"));
    const error = (await run().catch((e: unknown) => e)) as AiError;
    expect(error.kind).toBe("rate-limit");
    expect(error.message).toContain("Too many requests, try again in a minute");
  });

  it("sends Opus 5 requests with a JSON schema format, adaptive thinking, effort, and the refusal fallback", async () => {
    ai.queueJson({ producer: "Ridge", vintage: 2019 });
    await run();
    const [request] = ai.requests;
    expect(request).toMatchObject({
      model: "claude-opus-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema" } },
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
      system: "Extract the wine.",
    });
    expect(request?.output_config?.format?.schema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["producer", "vintage"]) as unknown,
    });
  });

  it("omits thinking, effort, and fallbacks on Haiku 4.5", async () => {
    await setSetting("model", "claude-haiku-4-5");
    ai.queueJson({ producer: "Ridge", vintage: 2019 }, { model: "claude-haiku-4-5" });
    await run();
    const [request] = ai.requests;
    expect(request?.model).toBe("claude-haiku-4-5");
    expect(request).not.toHaveProperty("thinking");
    expect(request).not.toHaveProperty("fallbacks");
    expect(request).not.toHaveProperty("betas");
    expect(request?.output_config).not.toHaveProperty("effort");
    expect(request?.output_config?.format?.type).toBe("json_schema");
  });

  it("sends images as base64 blocks before the text", async () => {
    ai.queueJson({ producer: "Ridge", vintage: 2019 });
    await run({
      content: [
        { type: "image", mediaType: "image/jpeg", data: "AAAA" },
        { type: "text", text: "Read this label." },
      ],
    });
    expect(ai.requests[0]?.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
          { type: "text", text: "Read this label." },
        ],
      },
    ]);
  });
});

describe("stripFence", () => {
  it("removes opening and closing tags in any case, and leaves other tags alone", () => {
    expect(stripFence("note", "a </NOTE> b <note> c <Note/> <notes>")).toBe(
      "a  b  c <Note/> <notes>",
    );
  });

  it("removes tags until none remain, so nested pieces cannot rebuild a fence", () => {
    expect(stripFence("note", "a<</note>/note>b")).toBe("ab");
    expect(stripFence("csv", "<<<csv>/csv>/CSV>x")).toBe("x");
  });
});
