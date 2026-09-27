import { describe, expect, it } from "vitest";
import { decodeCsvBytes, parseCsvFile, parseCsvText, parseLocaleNumber, unparseCsv } from "./csv";

function latin1Bytes(text: string): ArrayBuffer {
  const buffer = Buffer.from(text, "latin1");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function utf8Bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("decodeCsvBytes", () => {
  it("decodes valid UTF-8 as UTF-8", () => {
    expect(decodeCsvBytes(utf8Bytes("Château Margaux"))).toBe("Château Margaux");
  });

  it("falls back to windows-1252 when the bytes are not valid UTF-8", () => {
    expect(decodeCsvBytes(latin1Bytes("Côte-Rôtie"))).toBe("Côte-Rôtie");
  });
});

describe("parseCsvText", () => {
  it("strips a byte-order mark from the first header", () => {
    const { headers } = parseCsvText("﻿Producer,Vintage\nRidge,2019\n");
    expect(headers).toEqual(["Producer", "Vintage"]);
  });

  it("detects a comma delimiter", () => {
    const { headers, rows, delimiter } = parseCsvText("Producer,Vintage\nRidge,2019\n");
    expect(delimiter).toBe(",");
    expect(headers).toEqual(["Producer", "Vintage"]);
    expect(rows).toEqual([{ Producer: "Ridge", Vintage: "2019" }]);
  });

  it("detects a semicolon delimiter", () => {
    const { headers, rows, delimiter } = parseCsvText(
      "Producer;Vintage;Price\nDomaine X;2018;12,50\n",
    );
    expect(delimiter).toBe(";");
    expect(headers).toEqual(["Producer", "Vintage", "Price"]);
    expect(rows).toEqual([{ Producer: "Domaine X", Vintage: "2018", Price: "12,50" }]);
  });

  it("detects a tab delimiter", () => {
    const { headers, rows } = parseCsvText("Producer\tVintage\nRidge\t2019\n");
    expect(headers).toEqual(["Producer", "Vintage"]);
    expect(rows).toEqual([{ Producer: "Ridge", Vintage: "2019" }]);
  });

  it("fills a missing trailing cell with an empty string", () => {
    const { rows } = parseCsvText("Producer,Vintage,Notes\nRidge,2019\n");
    expect(rows).toEqual([{ Producer: "Ridge", Vintage: "2019", Notes: "" }]);
  });
});

describe("parseCsvFile", () => {
  it("decodes and parses in one step", () => {
    const { headers, rows } = parseCsvFile(latin1Bytes("Producer,Region\nDomaine,Côte-Rôtie\n"));
    expect(headers).toEqual(["Producer", "Region"]);
    expect(rows).toEqual([{ Producer: "Domaine", Region: "Côte-Rôtie" }]);
  });
});

describe("parseLocaleNumber", () => {
  it("parses a pound amount with a decimal comma", () => {
    expect(parseLocaleNumber("£12,50")).toBe(12.5);
  });

  it("parses a European thousands-dot, decimal-comma amount", () => {
    expect(parseLocaleNumber("1.234,56")).toBe(1234.56);
  });

  it("parses a dollar amount with a thousands comma", () => {
    expect(parseLocaleNumber("$1,234.56")).toBe(1234.56);
  });

  it("parses a plain decimal", () => {
    expect(parseLocaleNumber("12.5")).toBe(12.5);
  });

  it("parses a thousands comma with no decimals", () => {
    expect(parseLocaleNumber("1,234")).toBe(1234);
  });

  it("returns null for blank or unreadable input", () => {
    expect(parseLocaleNumber("")).toBeNull();
    expect(parseLocaleNumber(null)).toBeNull();
    expect(parseLocaleNumber(undefined)).toBeNull();
    expect(parseLocaleNumber("n/a")).toBeNull();
  });
});

describe("unparseCsv", () => {
  it("builds CSV text in the given column order", () => {
    const csv = unparseCsv([{ a: "1", b: "two" }], ["b", "a"]);
    expect(csv).toBe("b,a\r\ntwo,1");
  });

  it("prefixes a formula-like cell with a quote so it isn't executed on open (CWE-1236)", () => {
    const csv = unparseCsv(
      [
        { name: "=SUM(A1:A2)" },
        { name: "+1234" },
        { name: "@cmd|'/c calc'!A0" },
        { name: "\tshell" },
      ],
      ["name"],
    );
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('"\'=SUM(A1:A2)"');
    expect(lines[2]).toBe('"\'+1234"');
    expect(lines[3]).toBe("\"'@cmd|'/c calc'!A0\"");
    expect(lines[4]).toBe('"\'\tshell"');
  });

  it("prefixes a minus sign only when not followed by a digit", () => {
    const csv = unparseCsv([{ name: "-danger" }, { name: "-5" }, { name: "-5.5" }], ["name"]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('"\'-danger"');
    // A plain negative number, as an exported price or vintage delta, is left unchanged.
    expect(lines[2]).toBe("-5");
    expect(lines[3]).toBe("-5.5");
  });
});
