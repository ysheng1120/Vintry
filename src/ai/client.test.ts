import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportBackup } from "../db/backup";
import { db } from "../db/db";
import { resetDatabase } from "../db/testing";
import { getModel } from "./models";
import {
  apiKeyHint,
  buildParams,
  createAnthropicClient,
  getSelectedModel,
  removeApiKey,
  saveApiKey,
  sendMessage,
  testApiKey,
  type AiRequest,
} from "./client";
import { fakeApiError, installFakeAi, uninstallFakeAi, type FakeAi } from "./fake";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

describe("API key storage", () => {
  it("saves a trimmed key, shows only its last four characters, and removes it", async () => {
    await saveApiKey("  sk-ant-api03-abcdWXYZ \n");
    expect(await apiKeyHint()).toBe("…WXYZ");
    await removeApiKey();
    expect(await apiKeyHint()).toBeNull();
  });

  it("never includes the key in an exported backup", async () => {
    await saveApiKey("sk-ant-api03-very-secret-key");
    const backup = await exportBackup();
    expect(JSON.stringify(backup)).not.toContain("sk-ant-api03-very-secret-key");
  });

  it("builds a browser client for the given key", () => {
    const client = createAnthropicClient("sk-ant-test");
    expect(client.apiKey).toBe("sk-ant-test");
  });
});

describe("selected model", () => {
  it("defaults to Opus 5", async () => {
    expect((await getSelectedModel()).id).toBe("claude-opus-5");
  });
});

describe("testApiKey", () => {
  it("reports that a working key works and records the tiny request", async () => {
    await saveApiKey("sk-ant-good");
    ai.queueText("OK");
    await expect(testApiKey()).resolves.toEqual({ ok: true });
    const [row] = await db.aiUsage.toArray();
    expect(row?.feature).toBe("key-test");
    expect(ai.requests[0]?.max_tokens).toBeLessThanOrEqual(64);
  });

  it("explains a rejected key in plain words", async () => {
    ai.queueError(fakeApiError(401, "authentication_error", "invalid x-api-key"));
    const result = await testApiKey("sk-ant-typo");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toBe(
      "That key was not accepted. Check it was copied fully.",
    );
  });

  it("asks for a key when there is none to test", async () => {
    const result = await testApiKey();
    expect(!result.ok && result.error.kind).toBe("no-key");
  });
});

describe("sendMessage", () => {
  it("streams text to onText and returns the final message", async () => {
    await saveApiKey("sk-ant-good");
    ai.queueText("Open the 2015 Barolo.");
    const chunks: string[] = [];
    const message = await sendMessage(
      { feature: "chat", messages: [{ role: "user", content: "Lamb tonight?" }], effort: "medium" },
      { onText: (delta) => chunks.push(delta) },
    );
    expect(chunks.join("")).toBe("Open the 2015 Barolo.");
    expect(message.content[0]).toMatchObject({ type: "text", text: "Open the 2015 Barolo." });
    expect(ai.requests[0]?.output_config).toEqual({ effort: "medium" });
  });
});

describe("buildParams", () => {
  const request: AiRequest = { feature: "key-test", messages: [], noThinking: true };

  it("turns thinking off on Opus 5 for a trivial request", () => {
    const params = buildParams(getModel("claude-opus-5")!, request);
    expect(params.thinking).toEqual({ type: "disabled" });
  });

  it("never sends thinking disabled to Opus 5.5, which always thinks: it asks for low effort", () => {
    const params = buildParams(getModel("claude-opus-5-5")!, { ...request, effort: "high" });
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config?.effort).toBe("low");
    expect(params.fallbacks).toBe("default");
  });

  it("keeps the requested effort on Opus 5.5 when thinking is welcome", () => {
    const params = buildParams(getModel("claude-opus-5-5")!, {
      feature: "chat",
      messages: [],
      effort: "medium",
    });
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config?.effort).toBe("medium");
  });
});
