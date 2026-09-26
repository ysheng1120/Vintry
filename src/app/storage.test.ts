import { describe, expect, it, vi } from "vitest";

// Lives in this file, so it survives vi.resetModules() below.
const stored = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../db/settings", () => ({
  setSetting: async (key: string, value: unknown) => {
    stored.set(key, value);
  },
}));

function mockStorage(storage: Partial<StorageManager> | undefined) {
  Object.defineProperty(navigator, "storage", { value: storage, configurable: true });
}

/** A fresh storage module (its once-per-session memo reset) and an empty settings store. */
async function freshModule() {
  vi.resetModules();
  stored.clear();
  const storage = await import("./storage");
  return { ...storage, readTestSetting: (key: string) => stored.get(key) };
}

describe("requestPersistentStorage", () => {
  it("asks the browser once per session and stores the answer", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    mockStorage({ persist, persisted: vi.fn().mockResolvedValue(false) });
    const { requestPersistentStorage, readTestSetting } = await freshModule();

    await expect(requestPersistentStorage()).resolves.toBe(true);
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(readTestSetting("persistRequested")).toMatchObject({ granted: true });
  });

  it("does not ask again when storage is already persistent", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    mockStorage({ persist, persisted: vi.fn().mockResolvedValue(true) });
    const { requestPersistentStorage } = await freshModule();
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("records a refusal", async () => {
    mockStorage({
      persist: vi.fn().mockResolvedValue(false),
      persisted: vi.fn().mockResolvedValue(false),
    });
    const { requestPersistentStorage, readTestSetting } = await freshModule();
    await expect(requestPersistentStorage()).resolves.toBe(false);
    expect(readTestSetting("persistRequested")).toMatchObject({ granted: false });
  });

  it("returns null where the Storage API is missing", async () => {
    mockStorage(undefined);
    const { requestPersistentStorage } = await freshModule();
    await expect(requestPersistentStorage()).resolves.toBeNull();
  });
});

describe("storageEstimate", () => {
  it("returns usage and quota in bytes", async () => {
    mockStorage({ estimate: vi.fn().mockResolvedValue({ usage: 2048, quota: 1_000_000 }) });
    const { storageEstimate } = await freshModule();
    await expect(storageEstimate()).resolves.toEqual({ usage: 2048, quota: 1_000_000 });
  });

  it("returns null where estimates are not supported", async () => {
    mockStorage({});
    const { storageEstimate } = await freshModule();
    await expect(storageEstimate()).resolves.toBeNull();
  });
});
