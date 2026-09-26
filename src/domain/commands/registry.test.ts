import { describe, expect, it } from "vitest";
import { z } from "zod";
import { commandList, commands } from "./registry";

describe("command registry", () => {
  it("lists every command with a name, description and zod input schema", () => {
    expect(commandList.length).toBeGreaterThanOrEqual(20);
    for (const command of commandList) {
      expect(command.name).toMatch(/^[a-z][A-Za-z]+$/);
      expect(command.description.length).toBeGreaterThan(10);
      expect(command.input).toBeInstanceOf(z.ZodType);
      expect(typeof command.run).toBe("function");
      expect(commands[command.name as keyof typeof commands]).toBe(command);
    }
  });

  it("gives every human-only command a reason", () => {
    const humanOnly = commandList.filter((c) => c.humanOnly !== undefined);
    expect(humanOnly.map((c) => c.name).sort()).toEqual(
      ["purgeDeleted", "restoreBackup", "restoreSnapshot", "wipeAll"].sort(),
    );
    for (const command of humanOnly) expect(command.humanOnly?.trim().length).toBeGreaterThan(10);
  });

  it("includes the commands other units build on", () => {
    const names = commandList.map((c) => c.name);
    for (const name of [
      "addBottles",
      "updateWine",
      "deleteWine",
      "restoreWine",
      "purgeDeleted",
      "consumeBottles",
      "moveBottles",
      "adjustQuantity",
      "setDrinkingWindow",
      "addTastingNote",
      "updateTastingNote",
      "createLocation",
      "renameLocation",
      "deleteLocation",
      "addWishlistItem",
      "updateWishlistItem",
      "removeWishlistItem",
      "convertWishlistItem",
      "loadSampleCellar",
      "clearSampleCellar",
      "importRows",
      "wipeAll",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("can turn every input schema into JSON Schema for AI tools", () => {
    for (const command of commandList) {
      expect(() => z.toJSONSchema(command.input, { io: "input" })).not.toThrow();
    }
  });
});
