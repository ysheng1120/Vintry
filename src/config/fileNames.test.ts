import { describe, expect, it } from "vitest";

// macOS and Windows treat file names that differ only in case as the same file, so a pair like
// PrintList.tsx and printList.ts builds on Linux CI but breaks the launcher on a collector's Mac.
const files = Object.keys(
  import.meta.glob(["/src/**/*", "/public/**/*", "/scripts/**/*", "/e2e/**/*", "/docs/**/*", "/*"]),
);

/** The path an extensionless import like "./PrintList" names. */
const withoutExtension = (path: string) => path.replace(/\.[^./]+$/, "");

/** Pairs of paths that are the same when case is ignored but differ when it is kept. */
function caseClashes(paths: string[], key: (path: string) => string): string[] {
  const byFolded = new Map<string, string>();
  const clashes: string[] = [];
  for (const path of paths) {
    const exact = key(path);
    const other = byFolded.get(exact.toLowerCase());
    if (other !== undefined && other !== exact) clashes.push(`${other} ↔ ${exact}`);
    byFolded.set(exact.toLowerCase(), exact);
  }
  return clashes;
}

describe("file names", () => {
  it("finds the source files", () => {
    expect(files).toContain("/src/config/securityHeaders.ts");
  });

  it("has no two paths that differ only in case", () => {
    expect(caseClashes(files, (path) => path)).toEqual([]);
    expect(caseClashes(files, withoutExtension)).toEqual([]);
  });

  it("catches a pair like PrintList.tsx and printList.ts", () => {
    expect(caseClashes(["/a/PrintList.tsx", "/a/printList.ts"], withoutExtension)).toHaveLength(1);
    expect(caseClashes(["/a/Start.bat", "/a/Start.command"], withoutExtension)).toEqual([]);
  });
});
