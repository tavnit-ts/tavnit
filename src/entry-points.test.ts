// The lean entry point and the category subpaths: what a host that selects built-ins gets.
import { afterEach, describe, expect, it, vi } from "vitest";
import { collections, commonBuiltins, datetime, defaultBuiltins, regex, strings, types, yaml } from "./categories/index.js";
import { createEngine as createCoreEngine } from "./core.js";
import * as coreApi from "./core.js";
import * as publicApi from "./index.js";
import { createEngine } from "./index.js";
import { linearRegex } from "./regex-linear.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("@tavnit-ts/tavnit/core", () => {
  it("exports the public API except the default engine, Temporal and the polyfill", () => {
    const core = Object.keys(coreApi).sort();
    const pub = Object.keys(publicApi).sort();
    expect(pub.filter((name) => !core.includes(name))).toEqual(["Temporal"]);
    expect(core.filter((name) => !pub.includes(name))).toEqual([]);
    expect(coreApi.createEngine).not.toBe(publicApi.createEngine);
  });

  it("registers no built-in until it is asked to", async () => {
    const engine = createCoreEngine();
    await expect(engine.evaluate("1 + 2")).resolves.toBe(3);
    await expect(engine.evaluate('toUpperCase("a")')).rejects.toThrow(/toUpperCase/);
  });

  it("registers the categories it is given, and the filters on top", async () => {
    const engine = createCoreEngine({ builtins: [strings, collections], filters: { twice: (v) => Number(v) * 2 } });
    await expect(engine.evaluate('"a" | toUpperCase')).resolves.toBe("A");
    await expect(engine.evaluate("[1, 2] | size")).resolves.toBe(2);
    await expect(engine.evaluate("2 | twice")).resolves.toBe(4);
    await expect(engine.evaluate("1 | str")).rejects.toThrow(/str/);
  });

  it("lets a derived engine add categories", async () => {
    const engine = createCoreEngine({ builtins: [strings] }).derive({ builtins: [types] });
    await expect(engine.evaluate('1 | str | toUpperCase')).resolves.toBe("1");
  });

  it("shadows a built-in with a custom filter of the same name", async () => {
    const engine = createCoreEngine({ builtins: [strings], filters: { toUpperCase: () => "mine" } });
    await expect(engine.evaluate('"a" | toUpperCase')).resolves.toBe("mine");
  });

  it("uses the native regex engine by default", async () => {
    const engine = createCoreEngine({ builtins: [regex] });
    await expect(engine.evaluate('"abc" | matches("b+")')).resolves.toBe(true);
    // a lookahead is a native-engine feature: the linear engine refuses it
    await expect(engine.evaluate('"ab" | matches("a(?=b)")')).resolves.toBe(true);
  });

  it("raises a coded error for regex: 'linear' without an engine, whatever the built-in", async () => {
    const engine = createCoreEngine({ builtins: [regex], regex: "linear" });
    for (const source of ['"a" | matches("a")', '"a" | capture("(a)", 1)', '"a" | captures("(a)")']) {
      await expect(engine.evaluate(source)).rejects.toMatchObject({ errors: [{ code: "TAV_USAGE" }] });
    }
    await expect(engine.evaluate('"a" | matches("a")')).rejects.toThrow(/regex-linear/);
  });

  it("runs the linear engine when it is passed as the regex option", async () => {
    const engine = createCoreEngine({ builtins: [regex], regex: linearRegex });
    await expect(engine.evaluate('"abc" | capture("(b)", 1)')).resolves.toBe("b");
    await expect(engine.evaluate('"ab" | matches("a(?=b)")')).rejects.toThrow(/lookahead/);
    expect(await engine.derive({ regex: "native" }).evaluate('"ab" | matches("a(?=b)")')).toBe(true);
  });

  it("resolves a derived 'linear' to the engine of the entry point", async () => {
    const engine = createEngine({ regex: "native" }).derive({ regex: "linear" });
    await expect(engine.evaluate('"ab" | matches("a(?=b)")')).rejects.toThrow(/lookahead/);
  });
});

describe("the root entry point", () => {
  it("registers every category and the linear regex engine when `builtins` is absent", async () => {
    const engine = createEngine();
    expect(defaultBuiltins.map((category) => category.name)).toEqual(
      ["types", "strings", "regex", "collections", "objects", "yaml", "encoding", "crypto", "datetime"]);
    await expect(engine.evaluate('{a: 1} | yaml')).resolves.toBe("a: 1\n");
    await expect(engine.evaluate('"ab" | matches("a(?=b)")')).rejects.toThrow(/lookahead/);
  });

  it("registers only the selected categories when `builtins` is given", async () => {
    const engine = createEngine({ builtins: commonBuiltins });
    await expect(engine.evaluate('"a" | toUpperCase')).resolves.toBe("A");
    await expect(engine.evaluate('{a: 1} | yaml')).rejects.toThrow(/yaml/);
    await expect(createEngine({ builtins: [yaml] }).evaluate('{a: 1} | yaml')).resolves.toBe("a: 1\n");
  });
});

describe("Temporal on a runtime without one", () => {
  async function load() {
    vi.stubGlobal("Temporal", undefined);
    vi.resetModules();
    return {
      core: await import("./core.js"),
      categories: await import("./categories/index.js"),
      polyfill: await import("./temporal-polyfill.js"),
      root: await import("./index.js"),
    };
  }

  it("fails a date built-in of a lean engine with a coded error until the polyfill is installed", async () => {
    const { core, categories, polyfill } = await load();
    const engine = core.createEngine({ builtins: [categories.datetime] });
    await expect(engine.evaluate("now()")).rejects.toMatchObject({ errors: [{ code: "TAV_USAGE" }] });
    polyfill.installTemporalPolyfill();
    await expect(engine.evaluate("now()")).resolves.toBeInstanceOf((await import("./index.js")).Instant);
  });

  it("works from the root entry point without any installation", async () => {
    const { root } = await load();
    const engine = root.createEngine();
    await expect(engine.evaluate('today() > plainDate("2020-01-01")')).resolves.toBe(true);
  });

  it("revives dates through the root deserialiseValue without an engine", async () => {
    const { root } = await load();
    const value = root.deserialiseValue({ __tavnit_date__: true, __tavnit_type__: "instant", _inner: "2024-01-02T03:04:05Z" });
    expect(value).toBeInstanceOf(root.Instant);
  });

  it("keeps the date category importable on its own", () => {
    expect(datetime.name).toBe("datetime");
  });
});

describe("deserialiseValue without Temporal", () => {
  it("raises the usage error of a lean host instead of returning the undecoded map", async () => {
    vi.stubGlobal("Temporal", undefined);
    vi.resetModules();
    const { deserialiseValue } = await import("./serialisation.js");
    expect(() => deserialiseValue({ __tavnit_date__: true, __tavnit_type__: "instant", _inner: "2024-01-02T03:04:05Z" }))
      .toThrow(/installTemporalPolyfill/);
  });
});
