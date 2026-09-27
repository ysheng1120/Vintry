import { describe, expect, it } from "vitest";
import { systemPromptText } from "./prompt";
import { sommelierTools } from "./tools";

describe("sommelierTools", () => {
  it("lists the read and proposal tools of KTD11, sorted by name", () => {
    const names = sommelierTools().map((tool) => tool.name);
    expect(names).toEqual([
      "cellar_stats",
      "get_consumption_history",
      "get_wine",
      "list_locations",
      "list_wishlist",
      "propose_add_bottles",
      "propose_adjust_quantity",
      "propose_consume",
      "propose_move",
      "propose_set_drinking_window",
      "propose_update_wine",
      "search_cellar",
      "show_bottles",
    ]);
    expect(sommelierTools()).toBe(sommelierTools());
  });

  it("offers the wishlist as a read tool with no input", () => {
    const wishlist = sommelierTools().find((tool) => tool.name === "list_wishlist");
    expect(wishlist?.description).toMatch(/wishlist/i);
    expect(wishlist?.input_schema).toMatchObject({ type: "object", properties: {} });
    expect(systemPromptText({ locale: "en-GB", currency: "GBP" })).toMatch(
      /wishlist.*list_wishlist/i,
    );
  });

  it("generates proposal schemas from the command inputs, with a quantity precondition", () => {
    const consume = sommelierTools().find((tool) => tool.name === "propose_consume");
    const schema = consume?.input_schema as {
      type: string;
      properties: Record<string, { description?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        "lotId",
        "wineId",
        "wineQuery",
        "quantity",
        "expectedQuantity",
        "note",
      ]),
    );
    expect(schema.required ?? []).not.toContain("lotId");
    expect(schema.properties.expectedQuantity?.description).toMatch(/refused if it differs/);
    expect(consume?.description).toMatch(/confirm card/);
    expect(JSON.stringify(sommelierTools())).not.toContain("$schema");
  });
});
