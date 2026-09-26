import { describe, expect, it } from "vitest";
import { CHAT_HUMAN_ONLY, CHAT_TOOL_COMMANDS, sommelierTools } from "../ai/sommelier/tools";
import { commandList, commands } from "./commands";

/**
 * KTD11 parity: every registry command is either offered to the sommelier as a proposal tool
 * or marked human-only with a reason, and dangerous commands are never tools.
 */
describe("sommelier tool parity", () => {
  const toolNames = sommelierTools().map((tool) => tool.name);
  const exposed = new Set(Object.values(CHAT_TOOL_COMMANDS));

  it("exposes each registry command as a tool or marks it human-only with a reason", () => {
    for (const command of commandList) {
      const registryReason = command.humanOnly?.trim() ?? "";
      const chatReason = CHAT_HUMAN_ONLY[command.name as keyof typeof commands]?.trim() ?? "";
      const isTool = exposed.has(command.name as keyof typeof commands);
      const reasons = [registryReason, chatReason].filter(Boolean);
      expect(
        { command: command.name, isTool, reasons: reasons.length },
        `${command.name} must be exactly one of: a tool, or human-only with a reason`,
      ).toEqual({ command: command.name, isTool: !reasons.length, reasons: isTool ? 0 : 1 });
      for (const reason of reasons) expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("maps every proposal tool to a real, non-human-only registry command", () => {
    for (const [tool, name] of Object.entries(CHAT_TOOL_COMMANDS)) {
      expect(toolNames).toContain(tool);
      expect(commands[name]).toBeDefined();
      expect(commands[name].humanOnly).toBeUndefined();
    }
  });

  it("never offers wipe, restore, API key or permanent delete as tools", () => {
    for (const name of ["wipeAll", "restoreBackup", "restoreSnapshot", "purgeDeleted"] as const) {
      expect(exposed.has(name)).toBe(false);
    }
    for (const command of commandList.filter((c) => c.humanOnly)) {
      expect(exposed.has(command.name as keyof typeof commands)).toBe(false);
    }
    const everything = JSON.stringify(sommelierTools()).toLowerCase();
    for (const forbidden of ["setapikey", "api_key", "apikey", "wipe", "restore_backup", "purge"]) {
      expect(everything).not.toContain(forbidden);
    }
  });
});
