import { describe, expect, it } from "vitest";
import headersFile from "../../public/_headers?raw";
import vercel from "../../vercel.json";
import { SECURITY_HEADERS } from "./securityHeaders";

function parseHeadersFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (match?.[1] && match[2]) result[match[1]] = match[2].trim();
  }
  return result;
}

describe("security headers", () => {
  it("public/_headers matches the shared constant", () => {
    expect(parseHeadersFile(headersFile)).toEqual(SECURITY_HEADERS);
  });

  it("vercel.json matches the shared constant", () => {
    const entries = vercel.headers[0]?.headers ?? [];
    const fromVercel = Object.fromEntries(entries.map((h) => [h.key, h.value]));
    expect(fromVercel).toEqual(SECURITY_HEADERS);
  });

  it("only allows network calls to the app itself and the Claude API", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain(
      "connect-src 'self' https://api.anthropic.com;",
    );
  });
});
