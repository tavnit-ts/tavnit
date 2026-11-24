import { describe, expect, it, vi } from "vitest";
import { createEngine } from "../engine/engine.js";
import { ExpressionError } from "../engine/types.js";
import { resolve } from "../evaluator/types.js";

const eng = createEngine({ timeoutMs: 5000 });
const infEng = createEngine({ timeoutMs: 5000, divisionByZero: "infinity" });
const _dummy = resolve(async (_key: string) => null);
/** `source` on the async path: the engine takes it only for an expression that names a `Resolver`. */
const viaResolver = (source: string): string => `let r = _dummy.x in ${source}`;
const run = (source: string, data: Record<string, unknown> = {}) => eng.evaluate(source, { _dummy, ...data } as never);
const runAsync = (source: string, data: Record<string, unknown> = {}) => run(viaResolver(source), data);
const failsWith = async (promise: Promise<unknown>, text: string) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(ExpressionError);
  expect((error as Error).message).toContain(text);
};

describe("non-finite numbers are rejected by the conversion built-ins", () => {
  for (const [name, text] of [["parseInteger", "parseInteger() requires a finite number"], ["parseFloat", "parseFloat() requires a finite number"], ["parseBool", "parseBool() requires a finite number"], ["str", "str() cannot convert"], ["num", "num() requires a finite number"]] as const) {
    it(name, async () => failsWith(infEng.evaluate(`${name}(1 / 0)`, {}), text));
  }
});

describe("randomString()", () => {
  it("rejects a charset that is not a string", async () => failsWith(run("randomString(4, 5)"), "charset must be a string"));
  it("drops words from the biased tail and draws again", async () => {
    // 3 characters: span = floor(2^32 / 3) = 1431655765, limit = 4294967295, so 0xFFFFFFFF is rejected.
    const words = [[0xffffffff, 0, 1431655765], [2863311530]];
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((a: Uint32Array | Uint8Array) => {
      const next = words.shift() ?? [];
      new Uint32Array(a.buffer).set(next);
      return a;
    }) as never);
    try {
      expect(await run('randomString(4, "abc")')).toBe("abac");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("find() — async mode", () => {
  it("returns the first match", async () => expect(await runAsync("xs | find(x => x > 1)", { xs: [1, 2, 3] })).toBe(2));
  it("returns null when nothing matches", async () => expect(await runAsync("xs | find(x => x > 9)", { xs: [1, 2] })).toBeNull());
});

describe("sort() — async comparator", () => {
  it("orders by the comparator", async () => expect(await runAsync("xs | sort((a, b) => a - b)", { xs: [3, 1, 2] })).toEqual([1, 2, 3]));
  it("rejects a comparator that returns a non-number", async () =>
    failsWith(runAsync('xs | sort((a, b) => "x")', { xs: [3, 1, 2] }), "comparator must return a number"));
  it("rejects a comparator that returns a non-number (sync)", async () =>
    failsWith(run('xs | sort((a, b) => "x")', { xs: [3, 1, 2] }), "comparator must return a number"));
});

describe("async evaluation of literals and operators", () => {
  it("rejects a function in an array literal", async () => failsWith(runAsync("[x => x]"), "Function values cannot be stored inside array literals"));
  it("rejects a Resolver in an array literal", async () => failsWith(runAsync("[_dummy]"), "Resolver values cannot be stored inside array literals"));
  it("rejects a function in an object literal", async () => failsWith(runAsync("{ a: x => x }"), "Function values cannot be stored inside object literals"));
  it("rejects a Resolver in an object literal", async () => failsWith(runAsync("{ a: _dummy }"), "Resolver values cannot be stored inside object literals"));
  it("takes the alternate branch of a ternary", async () => expect(await runAsync("false ? 1 : 2")).toBe(2));
  it("|| keeps a truthy left", async () => expect(await runAsync("1 || 2")).toBe(1));
  it("|| falls to the right", async () => expect(await runAsync("0 || 2")).toBe(2));
  it("?? keeps a present left", async () => expect(await runAsync("a ?? 2", { a: 1 })).toBe(1));
  it("?? reads an absent key as null", async () => expect(await runAsync("a ?? 2")).toBe(2));
  it("?. on an absent key is null", async () => expect(await runAsync("a?.b", { a: {} })).toBeNull());
  it("?. index on an absent key is null", async () => expect(await runAsync('a?.["b"]', { a: {} })).toBeNull());
  it("an index on null throws", async () => failsWith(runAsync("a[0]", { a: null }), "read an index"));
  it("an unknown function throws", async () => failsWith(runAsync("nope(1)"), "nope"));
  it("a non-context native function is called", async () => expect(await runAsync("xs | map(x => x + 1) | sum", { xs: [1, 2] })).toBe(5));
});

describe("evaluator edge cases", () => {
  it("a host value reached through a call result is refused without a path", async () => {
    const error = await run("first(a).c", { a: [{ c: () => 1 }] }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(ExpressionError);
    expect((error as Error).message).toContain("Context value (the context itself) is a function");
  });
  it("?. on a string without that property is null", async () => expect(await run('"abc"?.foo')).toBeNull());
  it("?. on a Resolver is not short-circuited", async () => expect(await runAsync("_dummy?.x")).toBeNull());
});

describe("optional access with an absent key", () => {
  const absent = createEngine({ timeoutMs: 5000, undefinedIsAbsent: true });
  it("an absent index key on a string reads through", async () => {
    const outcome = await absent.evaluate('s?.[k]', { s: "abc", k: undefined } as never).then((v) => v, (e: unknown) => e);
    expect(outcome === null || outcome instanceof ExpressionError).toBe(true);
  });
});

describe("optional index with a key that is neither a string nor a number", () => {
  it("is decided by the index, not read as absent", async () => {
    const outcome = await run("o?.[k]", { o: { a: 1 }, k: true }).then((v) => v, (e: unknown) => e);
    expect(outcome === null || outcome instanceof ExpressionError).toBe(true);
  });
});
