// A `typeof import("node:crypto")` type is erased at build, so it is not an import.
// The package loads in a browser or an edge runtime, and says so in its manifest.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "./engine/engine.js";

afterEach(() => { vi.restoreAllMocks(); });

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("no static Node import", () => {
  it("imports nothing from node: in a module that ships", () => {
    const files = (readdirSync(new URL("src/", root), { recursive: true }) as string[])
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => /(?<!typeof\s)\b(?:from|import)\s*\(?\s*["']node:/.test(read(`src/${f}`)));
    expect(offenders).toEqual([]);
  });

  it("uses no Node-only global such as Buffer", () => {
    const files = (readdirSync(new URL("src/", root), { recursive: true }) as string[])
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.filter((f) => /\bBuffer\./.test(read(`src/${f}`)))).toEqual([]);
  });
});

describe("without node:crypto", () => {
  const engine = createEngine();

  it("names the missing module when a hash is asked for", async () => {
    vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined);
    await expect(engine.evaluate('sha256("a")')).rejects.toThrow("sha256() needs node:crypto");
    await expect(engine.evaluate('hmacSha256("k", "a")')).rejects.toThrow("hmacSha256() needs node:crypto");
  });

  it("still draws random values and compares in constant time", async () => {
    vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined);
    expect(await engine.evaluate("uuid()")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await engine.evaluate("randomString(8)")).toHaveLength(8);
    expect(await engine.evaluate('timingSafeEqualHex("ab00", "AB00")')).toBe(true);
  });

  it("works where there is no process at all", async () => {
    vi.stubGlobal("process", undefined);
    await expect(engine.evaluate('sha256("a")')).rejects.toThrow("needs node:crypto");
    vi.unstubAllGlobals();
  });
});

describe("package manifest", () => {
  const pkg = JSON.parse(read("package.json")) as {
    exports: Record<string, unknown>; files: string[]; sideEffects: boolean; engines: { node: string };
  };

  it("exposes the root, the host, the lean entry, the category and engine subpaths, the internal subpath and package.json only", () => {
    expect(Object.keys(pkg.exports)).toEqual([
      ".", "./host", "./core", "./builtins",
      ...["types", "strings", "regex", "collections", "objects", "yaml", "encoding", "crypto", "datetime"].map((name) => `./builtins/${name}`),
      "./regex-linear", "./temporal-polyfill", "./internal", "./package.json",
    ]);
  });

  it("points every subpath at a module that exists in src", () => {
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (subpath === "./package.json") continue;
      const { import: file } = target as { import: string };
      const source = file.replace("./dist/", "src/").replace(/\.js$/, ".ts");
      expect(() => read(source), subpath).not.toThrow();
    }
  });

  it("ships the licence and the changelog, is side-effect free, and names a Node floor", () => {
    expect(pkg.files).toEqual(expect.arrayContaining(["LICENSE", "CHANGELOG.md"]));
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.engines.node).toBe(">=24");
  });
});

describe("utf8Length", () => {
  it("equals the length of the TextEncoder bytes, lone surrogates included", async () => {
    const { utf8Length } = await import("./evaluator/text-template.js");
    const fc = (await import("fast-check")).default;
    const encoder = new TextEncoder();
    fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 40 }), (s) => utf8Length(s) === encoder.encode(s).length));
    for (const s of ["", "abc", "Привет", "日本", "😀", "a\ud800", "\udc00b", "\ud800𐀀"]) {
      expect(utf8Length(s)).toBe(encoder.encode(s).length);
    }
  });
});
