/**
 * Arrow functions, let…in, and higher-order built-ins.
 *
 * Tests are grouped by:
 *  1. Parser — arrow syntax and let…in parsing
 *  2. Evaluator — FunctionValue creation, closure, let scoping
 *  3. Higher-order collections — map, filter, find, some, every, reduce, flatMap, sort, uniqBy, groupBy
 *  4. compile() — engine.compile() happy path and error cases
 *  5. Error cases — FunctionValue in wrong positions, reserved names, depth
 */
import { describe, expect, it } from "vitest";
import { createEngine } from "../engine/engine.js";
import { ExpressionError } from "../engine/types.js";
import type { FilterFn, Value } from "../evaluator/types.js";
import { FunctionValue, resolve } from "../evaluator/types.js";
import { parse } from "../parser/parse.js";

const eng = createEngine({ timeoutMs: 5000 });
/** Lenient reading: a name that is not in scope is null. */
const lenientEng = createEngine({ timeoutMs: 5000, strict: false });
const asyncLenientEng = createEngine({ timeoutMs: 5000, strict: false });

async function ev(expr: string, ctx: Record<string, unknown> = {}) {
  return eng.evaluate(expr, ctx as never);
}

async function throws(expr: string, ctx: Record<string, unknown> = {}) {
  await expect(ev(expr, ctx)).rejects.toBeInstanceOf(ExpressionError);
}

// ── 1. Parser ─────────────────────────────────────────────────────────────────

describe("parser — arrow syntax", () => {
  it("parses single unparenthesised param: x => x", () => {
    const node = parse("x => x");
    expect(node.kind).toBe("arrow");
    if (node.kind === "arrow") {
      expect(node.params).toEqual(["x"]);
      expect(node.body.kind).toBe("identifier");
    }
  });

  it("parses single parenthesised param: (x) => x", () => {
    const node = parse("(x) => x");
    expect(node.kind).toBe("arrow");
    if (node.kind === "arrow") expect(node.params).toEqual(["x"]);
  });

  it("parses zero-param arrow: () => 42", () => {
    const node = parse("() => 42");
    expect(node.kind).toBe("arrow");
    if (node.kind === "arrow") {
      expect(node.params).toEqual([]);
      expect(node.body).toMatchObject({ kind: "literal", value: 42 });
    }
  });

  it("parses two-param arrow: (a, b) => a + b", () => {
    const node = parse("(a, b) => a + b");
    expect(node.kind).toBe("arrow");
    if (node.kind === "arrow") {
      expect(node.params).toEqual(["a", "b"]);
      expect(node.body.kind).toBe("binary");
    }
  });

  it("arrow body absorbs pipe: x => x.price | round(2)", () => {
    const node = parse("x => x.price | round(2)");
    expect(node.kind).toBe("arrow");
    if (node.kind === "arrow") {
      expect(node.body.kind).toBe("pipe");
    }
  });

  it("arrow body absorbs arithmetic: x => x * 2", () => {
    const node = parse("x => x * 2");
    expect(node.kind).toBe("arrow");
  });

  it("rejects reserved param name: constructor => x", () => {
    expect(() => parse("constructor => x")).toThrow();
  });

  it("rejects non-identifier as arrow left side: 1 => x", () => {
    expect(() => parse("1 => x")).toThrow();
  });

  it("rejects empty parens not followed by =>: () + 1", () => {
    expect(() => parse("() + 1")).toThrow();
  });

  it("rejects reserved multi-param name: (a, __proto__) => a", () => {
    expect(() => parse("(a, __proto__) => a")).toThrow();
  });

  it("arrow as argument inside call: filter(x => x > 0)", () => {
    const node = parse("filter(arr, x => x > 0)");
    expect(node.kind).toBe("call");
    if (node.kind === "call") {
      expect(node.args[1].kind).toBe("arrow");
    }
  });

  it("multi-param arrow as argument: sort(arr, (a, b) => a - b)", () => {
    const node = parse("sort(arr, (a, b) => a - b)");
    expect(node.kind).toBe("call");
    if (node.kind === "call") {
      const fn = node.args[1];
      expect(fn.kind).toBe("arrow");
      if (fn.kind === "arrow") expect(fn.params).toEqual(["a", "b"]);
    }
  });
});

describe("parser — let…in syntax", () => {
  it("parses single binding: let x = 1 in x", () => {
    const node = parse("let x = 1 in x");
    expect(node.kind).toBe("let");
    if (node.kind === "let") {
      expect(node.bindings).toHaveLength(1);
      expect(node.bindings[0][0]).toBe("x");
      expect(node.body.kind).toBe("identifier");
    }
  });

  it("parses multiple bindings: let a = 1, b = 2 in a + b", () => {
    const node = parse("let a = 1, b = 2 in a + b");
    expect(node.kind).toBe("let");
    if (node.kind === "let") {
      expect(node.bindings).toHaveLength(2);
      expect(node.bindings[0][0]).toBe("a");
      expect(node.bindings[1][0]).toBe("b");
    }
  });

  it("binding value can use 'in' operator with parentheses: let x = (1 in [1,2]) in x", () => {
    const node = parse('let x = (1 in [1, 2]) in x');
    expect(node.kind).toBe("let");
  });

  it("rejects reserved binding name: let constructor = 1 in constructor", () => {
    expect(() => parse("let constructor = 1 in constructor")).toThrow();
  });

  it("let body absorbs pipe: let x = a in b | fn", () => {
    const node = parse("let x = a in b | fn");
    expect(node.kind).toBe("let");
    if (node.kind === "let") {
      expect(node.body.kind).toBe("pipe");
    }
  });
});

// ── 2. Evaluator ──────────────────────────────────────────────────────────────

describe("evaluator — FunctionValue creation", () => {
  it("arrow expression evaluates to a FunctionValue", async () => {
    const result = await eng.evaluate("x => x");
    expect(result).toBeInstanceOf(FunctionValue);
  });

  it("FunctionValue captures params and body", async () => {
    const result = await eng.evaluate("x => x + 1");
    expect(result).toBeInstanceOf(FunctionValue);
    if (result instanceof FunctionValue) {
      expect(result.params).toEqual(["x"]);
    }
  });

  it("arrow closes over data context", async () => {
    const result = await eng.evaluate("x => x + base", { base: 10 });
    expect(result).toBeInstanceOf(FunctionValue);
    if (result instanceof FunctionValue) {
      expect(result.closure).toMatchObject({ base: 10 });
    }
  });
});

describe("evaluator — scopes of arrows and let", () => {
  const cases: Array<[string, string, Record<string, unknown>, Value]> = [
    ["a parameter shadows a data key", "[5] | map((x) => x)", { x: 9 }, [5]],
    ["a parameter shadows a let binding", "let x = 1 in [5] | map((x) => x)", {}, [5]],
    ["a let binding shadows a data key", "let x = 1 in x", { x: 9 }, 1],
    ["an arrow sees the let bindings before it", "let a = 1, f = (v) => v + a in [1] | map(f)", {}, [2]],
    ["a nested arrow sees the outer parameter", "[1, 2] | map((a) => [10] | map((b) => a + b))", {}, [[11], [12]]],
  ];

  it.each(cases)("%s", async (_name, source, data, expected) => {
    expect(await ev(source, data)).toEqual(expected);
    expect(await asyncEng.evaluate(viaResolver(source), { ...data, _dummy } as never)).toEqual(expected);
  });
});

describe("evaluator — scopes of arrows and let (lenient reading)", () => {
  it("an arrow does not see the let bindings after it", async () => {
    const source = "let f = (v) => b, b = 2 in [1] | map(f)";
    expect(await lenientEng.evaluate(source, {})).toEqual([null]);
    expect(await asyncLenientEng.evaluate(viaResolver(source), { _dummy } as never)).toEqual([null]);
  });

  it("an arrow does not see the let bindings after it, and strict says so", async () => {
    await expect(eng.evaluate("let f = (v) => b, b = 2 in [1] | map(f)", {})).rejects.toThrow("Unknown name 'b'");
  });
});

describe("evaluator — let…in", () => {
  it("let single binding", async () => {
    expect(await ev("let x = 5 in x * 2")).toBe(10);
  });

  it("let multiple bindings — later references earlier", async () => {
    expect(await ev("let base = 10, tax = base * 0.1 in base + tax")).toBe(11);
  });

  it("let binding with data context", async () => {
    expect(await ev("let x = price * qty in x", { price: 3, qty: 4 })).toBe(12);
  });

  it("bound name shadows context key", async () => {
    expect(await ev("let x = 99 in x", { x: 1 })).toBe(99);
  });

  it("let binding value does NOT see its own name (no self-reference)", async () => {
    // 'x' in the binding expr evaluates to null (absent in context), not itself
    expect(await lenientEng.evaluate("let x = x in x", {})).toBeNull();
    await expect(eng.evaluate("let x = x in x", {})).rejects.toThrow("Unknown name 'x'");
  });

  it("let body absorbs trailing pipe", async () => {
    // let x = 5 in [1,2,3] | size   — body is `[1,2,3] | size`
    expect(await ev("let x = 5 in [1, 2, 3] | size")).toBe(3);
  });

  it("let with arrow binding, reused in body", async () => {
    expect(
      await ev(
        'let eligible = x => x > 0 in some(items, eligible) && every(items, eligible)',
        { items: [1, 2, 3] },
      ),
    ).toBe(true);
  });

  it("type() returns 'function' for let-bound arrow", async () => {
    expect(await ev("let f = x => x in type(f)")).toBe("function");
  });
});

// ── 3. Higher-order collections ───────────────────────────────────────────────

describe("map(arr, fn)", () => {
  it("transforms each element", async () => {
    expect(await ev("map(items, x => x * 2)", { items: [1, 2, 3] })).toEqual([2, 4, 6]);
  });

  it("pipe form", async () => {
    expect(await ev("items | map(x => x + 1)", { items: [10, 20] })).toEqual([11, 21]);
  });

  it("maps field extraction", async () => {
    expect(
      await ev("items | map(x => x.name)", {
        items: [{ name: "a" }, { name: "b" }],
      }),
    ).toEqual(["a", "b"]);
  });

  it("arrow body with pipe", async () => {
    expect(
      await ev('items | map(x => x | str)', { items: [1, 2] }),
    ).toEqual(["1", "2"]);
  });
});

describe("filter(arr, fn)", () => {
  it("keeps truthy elements", async () => {
    expect(await ev("filter(items, x => x > 2)", { items: [1, 2, 3, 4] })).toEqual([3, 4]);
  });

  it("pipe form with field predicate", async () => {
    expect(
      await ev("items | filter(x => x.active)", {
        items: [{ active: true }, { active: false }, { active: true }],
      }),
    ).toEqual([{ active: true }, { active: true }]);
  });

  it("complex predicate with &&", async () => {
    expect(
      await ev('items | filter(x => x.status == "ok" && x.n > 0)', {
        items: [
          { status: "ok", n: 1 },
          { status: "ok", n: 0 },
          { status: "bad", n: 1 },
        ],
      }),
    ).toEqual([{ status: "ok", n: 1 }]);
  });
});

describe("find(arr, fn)", () => {
  it("returns first matching element", async () => {
    expect(await ev("find(items, x => x > 3)", { items: [1, 2, 3, 4, 5] })).toBe(4);
  });

  it("returns null when no match", async () => {
    expect(await ev("find(items, x => x > 10)", { items: [1, 2, 3] })).toBeNull();
  });

  it("find by field value", async () => {
    expect(
      await ev("items | find(x => x.id == 2)", {
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      }),
    ).toEqual({ id: 2 });
  });
});

describe("some() / every()", () => {
  it("some returns true when any element matches", async () => {
    expect(await ev("some(items, x => x > 2)", { items: [1, 2, 3] })).toBe(true);
  });

  it("some returns false when no element matches", async () => {
    expect(await ev("some(items, x => x > 10)", { items: [1, 2, 3] })).toBe(false);
  });

  it("every returns true when all elements match", async () => {
    expect(await ev("every(items, x => x > 0)", { items: [1, 2, 3] })).toBe(true);
  });

  it("every returns false when any element fails", async () => {
    expect(await ev("every(items, x => x > 2)", { items: [1, 2, 3] })).toBe(false);
  });

  it("let…in with some and every — skill example", async () => {
    const result = await ev(
      "let eligible = x => x.active && x.balance > 0 in some(tariffs, eligible) && !every(tariffs, eligible)",
      {
        tariffs: [
          { active: true, balance: 100 },
          { active: false, balance: 0 },
        ],
      },
    );
    expect(result).toBe(true);
  });
});

describe("reduce(arr, fn, init)", () => {
  it("sums array via accumulator", async () => {
    expect(await ev("reduce(items, (acc, x) => acc + x, 0)", { items: [1, 2, 3, 4] })).toBe(10);
  });

  it("pipe form", async () => {
    expect(await ev('items | reduce((acc, x) => acc + x.price, 0)', {
      items: [{ price: 10 }, { price: 20 }],
    })).toBe(30);
  });

  it("string accumulator", async () => {
    expect(await ev('items | reduce((acc, x) => acc + "," + x.id, "")', {
      items: [{ id: "a" }, { id: "b" }],
    })).toBe(",a,b");
  });
});

describe("flatMap(arr, fn)", () => {
  it("maps to arrays then flattens one level", async () => {
    expect(
      await ev("items | flatMap(x => x.tags)", {
        items: [{ tags: ["a", "b"] }, { tags: ["b", "c"] }],
      }),
    ).toEqual(["a", "b", "b", "c"]);
  });

  it("non-array return values are included directly", async () => {
    expect(await ev("items | flatMap(x => x * 2)", { items: [1, 2, 3] })).toEqual([2, 4, 6]);
  });
});

describe("sort(arr, fn)", () => {
  it("natural sort with no fn", async () => {
    expect(await ev("sort(items)", { items: [3, 1, 2] })).toEqual([1, 2, 3]);
  });

  it("key extractor (1-param): sort ascending by field", async () => {
    expect(
      await ev("items | sort(x => x.price)", {
        items: [{ price: 30 }, { price: 10 }, { price: 20 }],
      }),
    ).toEqual([{ price: 10 }, { price: 20 }, { price: 30 }]);
  });

  it("comparator (2-param): sort descending by score", async () => {
    expect(
      await ev("items | sort((a, b) => b.score - a.score)", {
        items: [{ score: 1 }, { score: 3 }, { score: 2 }],
      }),
    ).toEqual([{ score: 3 }, { score: 2 }, { score: 1 }]);
  });

  it("sort descending via key + reverse", async () => {
    expect(await ev("items | sort(x => x) | reverse", { items: [3, 1, 2] })).toEqual([3, 2, 1]);
  });

  it("sort() comparator returning non-number throws", async () => {
    await throws('items | sort((a, b) => "oops")', { items: [1, 2, 3] });
  });
});

describe("uniqBy(arr, fn)", () => {
  it("deduplicates by key extractor", async () => {
    expect(
      await ev("items | uniqBy(x => x.id)", {
        items: [{ id: 1 }, { id: 2 }, { id: 1 }],
      }),
    ).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("keeps first occurrence", async () => {
    expect(
      await ev("items | uniqBy(x => x.id)", {
        items: [{ id: 1, v: "first" }, { id: 1, v: "second" }],
      }),
    ).toEqual([{ id: 1, v: "first" }]);
  });
});

describe("groupBy(arr, fn)", () => {
  it("groups by extracted key", async () => {
    expect(
      await ev("items | groupBy(x => x.category)", {
        items: [
          { category: "a", n: 1 },
          { category: "b", n: 2 },
          { category: "a", n: 3 },
        ],
      }),
    ).toEqual({
      a: [{ category: "a", n: 1 }, { category: "a", n: 3 }],
      b: [{ category: "b", n: 2 }],
    });
  });

  it("null key groups under 'null'", async () => {
    expect(
      await ev("items | groupBy(x => null)", { items: [1, 2, 3] }),
    ).toEqual({ null: [1, 2, 3] });
  });

  it("object key uses JSON representation as group key", async () => {
    expect(
      await ev("items | groupBy(x => x.k)", {
        items: [{ k: { x: 1 } }, { k: { x: 2 } }, { k: { x: 1 } }],
      }),
    ).toEqual({
      '{"x":1}': [{ k: { x: 1 } }, { k: { x: 1 } }],
      '{"x":2}': [{ k: { x: 2 } }],
    });
  });
});

describe("keyBy(arr, fn)", () => {
  it("maps items by extracted key", async () => {
    expect(
      await ev("items | keyBy(x => x.id)", {
        items: [{ id: "a", n: 1 }, { id: "b", n: 2 }],
      }),
    ).toEqual({ a: { id: "a", n: 1 }, b: { id: "b", n: 2 } });
  });

  it("later item wins on duplicate keys", async () => {
    expect(
      await ev("items | keyBy(x => x.id)", {
        items: [{ id: 1, v: "first" }, { id: 1, v: "second" }],
      }),
    ).toEqual({ "1": { id: 1, v: "second" } });
  });

  it("null key maps under 'null'", async () => {
    expect(await ev("items | keyBy(x => null)", { items: [1, 2, 3] })).toEqual({ null: 3 });
  });

  it("object key uses JSON representation as map key", async () => {
    expect(
      await ev("items | keyBy(x => x.k)", {
        items: [{ k: { x: 1 } }, { k: { x: 2 } }],
      }),
    ).toEqual({
      '{"x":1}': { k: { x: 1 } },
      '{"x":2}': { k: { x: 2 } },
    });
  });
});

// ── 4. compile() ─────────────────────────────────────────────────────────────

describe("engine.compile()", () => {
  it("returns a FilterFn from an arrow expression", () => {
    const fn = eng.compile("x => x * 2");
    expect(typeof fn).toBe("function");
  });

  it("compiled fn can be called like a filter", () => {
    const double = eng.compile("x => x * 2");
    expect(double(5)).toBe(10);
  });

  it("compiled fn with multiple params", () => {
    const add = eng.compile("(a, b) => a + b");
    expect(add(3, 4)).toBe(7);
  });

  it("compiled fn uses built-ins from the compiling engine", () => {
    const upper = eng.compile("x => x | toUpperCase");
    expect(upper("hello")).toBe("HELLO");
  });

  it("compiled fn has no access to outer data context", async () => {
    const fn = eng.compile("x => x + secret");
    // 'secret' is not in scope — resolves to null, so x + null throws
    expect(() => fn(1)).toThrow();
  });

  it("can be registered on a derived engine and used in evaluate()", async () => {
    const eligible = eng.compile("x => x.active && x.balance > 0");
    const childEng = eng.derive({ filters: { eligible } });
    expect(
      await childEng.evaluate("items | filter(eligible)", {
        items: [
          { active: true, balance: 100 },
          { active: false, balance: 0 },
          { active: true, balance: 50 },
        ],
      }),
    ).toEqual([
      { active: true, balance: 100 },
      { active: true, balance: 50 },
    ]);
  });

  it("throws ExpressionError on non-arrow source", () => {
    expect(() => eng.compile("1 + 2")).toThrow(ExpressionError);
  });

  it("throws ExpressionError on syntax error", () => {
    expect(() => eng.compile("x => x +")).toThrow(ExpressionError);
  });

  it("compile-time error on reserved param name", () => {
    expect(() => eng.compile("constructor => constructor")).toThrow(ExpressionError);
  });
});

// ── 5. Error cases ────────────────────────────────────────────────────────────

describe("FunctionValue error cases", () => {
  it("FunctionValue in array literal throws", async () => {
    await throws("[x => x]");
  });

  it("FunctionValue in object literal throws", async () => {
    await throws('{"f": x => x}');
  });

  it("FunctionValue at top level of render span throws", async () => {
    await expect(
      eng.render("${{ x => x }}", {}),
    ).rejects.toBeInstanceOf(ExpressionError);
  });

  it("type() returns 'function' for a FunctionValue", async () => {
    expect(await ev("let f = x => x in type(f)")).toBe("function");
  });

  it("calling a data-context value that is a string throws", async () => {
    await throws("fn(1)", { fn: "not a function" });
  });

  it("calling null throws", async () => {
    await throws("fn(1)", { fn: null });
  });

  it("passing non-function to filter() throws", async () => {
    await throws("filter([1,2,3], 42)");
  });

  it("str() on FunctionValue throws", async () => {
    await throws("let f = x => x in str(f)");
  });

  it("async native filter used as a function value throws", async () => {
    const asyncF = async (v: unknown) => v;
    const engWithAsync = eng.derive({ filters: { asyncF: asyncF as never } });
    await expect(engWithAsync.evaluate("filter([1,2,3], asyncF)", {})).rejects.toBeInstanceOf(ExpressionError);
  });
});

describe("arrow — closure behaviour", () => {
  it("arrow closes over context values used in body", async () => {
    expect(
      await ev("items | map(x => x + base)", { items: [1, 2, 3], base: 10 }),
    ).toEqual([11, 12, 13]);
  });

  it("arrow closes over let-bound name", async () => {
    expect(
      await ev("let n = 5 in items | map(x => x + n)", { items: [1, 2, 3] }),
    ).toEqual([6, 7, 8]);
  });
});

// ── Async mode (an expression naming a Resolver takes the evaluateCallAsync path) ─
//
// These tests exercise the async branches inside uniqBy, groupBy, and
// callFunctionValueAsync that are only reachable when ctx.asyncMode is true.
// An expression that names a Resolver routes through evaluateAsync →
// evaluateCallAsync, which sets asyncMode=true before dispatching to ContextFilterFns.

const _dummy = resolve(async (_key: string) => null);
/** `source` on the async path: the engine takes it only for an expression that names a `Resolver`. */
const viaResolver = (source: string): string => `let r = _dummy.x in ${source}`;
const asyncEng = createEngine({ timeoutMs: 5000 });

describe("uniqBy — async mode", () => {
  it("deduplicates by key extractor when Resolver is in context", async () => {
    const items = [{ id: 1, v: "a" }, { id: 1, v: "b" }, { id: 2, v: "c" }];
    const result = await asyncEng.evaluate(viaResolver("items | uniqBy(x => x.id)"), { items, _dummy } as never);
    expect(result).toEqual([{ id: 1, v: "a" }, { id: 2, v: "c" }]);
  });

  it("keeps first occurrence by null key in async mode", async () => {
    const result = await asyncEng.evaluate(viaResolver("items | uniqBy(x => null)"), { items: [1, 2, 3], _dummy } as never);
    expect(result).toEqual([1]);
  });
});

describe("groupBy — async mode", () => {
  it("groups by key extractor when Resolver is in context", async () => {
    const items = [{ type: "a", v: 1 }, { type: "b", v: 2 }, { type: "a", v: 3 }];
    const result = await asyncEng.evaluate(viaResolver("items | groupBy(x => x.type)"), { items, _dummy } as never);
    expect(result).toEqual({ a: [{ type: "a", v: 1 }, { type: "a", v: 3 }], b: [{ type: "b", v: 2 }] });
  });

  it("null key groups under 'null' in async mode", async () => {
    const result = await asyncEng.evaluate(viaResolver("items | groupBy(x => null)"), { items: [1, 2, 3], _dummy } as never);
    expect(result).toEqual({ null: [1, 2, 3] });
  });
});

describe("keyBy — async mode", () => {
  it("maps by key extractor when Resolver is in context", async () => {
    const items = [{ id: "a", v: 1 }, { id: "b", v: 2 }];
    const result = await asyncEng.evaluate(viaResolver("items | keyBy(x => x.id)"), { items, _dummy } as never);
    expect(result).toEqual({ a: { id: "a", v: 1 }, b: { id: "b", v: 2 } });
  });

  it("null key maps under 'null' in async mode", async () => {
    const result = await asyncEng.evaluate(viaResolver("items | keyBy(x => null)"), { items: [1, 2, 3], _dummy } as never);
    expect(result).toEqual({ null: 3 });
  });
});

describe("callFunctionValueAsync — nativeFn path", () => {
  it("native filter used as a value is invoked via async path", async () => {
    const result = await asyncEng.evaluate(viaResolver("[1, 2, 3] | map(str)"), { _dummy } as never);
    expect(result).toEqual(["1", "2", "3"]);
  });

  it("unknown function in async mode throws ExpressionError", async () => {
    await expect(
      asyncEng.evaluate(viaResolver("noSuchFn(1)"), { _dummy } as never),
    ).rejects.toBeInstanceOf(ExpressionError);
  });
});

// ── evaluateCallAsync — non-context-filter and sync-return paths ──────────────

describe("evaluateCallAsync — regular filter in async mode", () => {
  it("regular (non-context) filter works when Resolver is in context", async () => {
    // Regular filters like toUpperCase are FilterFn (not ContextFilterFn).
    // In async mode they go through the non-isContextFilter path (lines 546-547).
    expect(await asyncEng.evaluate(viaResolver('"hello" | toUpperCase'), { _dummy } as never)).toBe("HELLO");
  });

  it("context filter returning a non-Promise (size) works in async mode", async () => {
    // size() is a ContextFilterFn but returns a plain Value, not a Promise.
    // This covers the non-Promise branch of the isContextFilter return (line 543).
    expect(await asyncEng.evaluate(viaResolver("[1, 2, 3] | size"), { _dummy } as never)).toBe(3);
  });
});

// ── evaluateBinaryAsync — short-circuit operators ─────────────────────────────

describe("evaluateBinaryAsync — short-circuit operators in async mode", () => {
  it("|| returns left when truthy without evaluating right", async () => {
    // Left is truthy — right side is never evaluated (short-circuit).
    expect(await asyncEng.evaluate(viaResolver('"truthy" || "fallback"'), { _dummy } as never)).toBe("truthy");
  });

  it("?? evaluates right side when left is null", async () => {
    // Left is null — right side IS evaluated.
    expect(await asyncEng.evaluate(viaResolver("null ?? 42"), { _dummy } as never)).toBe(42);
  });
});

// ── evaluateAsync ternary ─────────────────────────────────────────────────────

describe("evaluateAsync — literals, index access and collection edge cases", () => {
  it("rejects a function value inside an array or object literal", async () => {
    await expect(asyncEng.evaluate(viaResolver("[(x) => x]"), { _dummy } as never)).rejects.toThrow(/array literals/);
    await expect(asyncEng.evaluate(viaResolver("{ a: (x) => x }"), { _dummy } as never)).rejects.toThrow(/object literals/);
  });

  it("indexes a value, and null only with optional access", async () => {
    expect(await asyncEng.evaluate(viaResolver("[1, 2][1]"), { _dummy } as never)).toBe(2);
    expect(await asyncEng.evaluate(viaResolver("n?.[0]"), { _dummy, n: null } as never)).toBeNull();
    await expect(asyncEng.evaluate(viaResolver("n[0]"), { _dummy, n: null } as never)).rejects.toThrow("is null, cannot read an index");
  });

  it("find returns null when nothing matches", async () => {
    expect(await asyncEng.evaluate(viaResolver("[1, 2] | find(x => x > 5)"), { _dummy } as never)).toBeNull();
  });

  it("sort rejects a comparator that returns a non-number", async () => {
    await expect(asyncEng.evaluate(viaResolver("[2, 1] | sort((a, b) => 'x')"), { _dummy } as never)).rejects.toThrow(ExpressionError);
  });
});

describe("evaluateAsync — ternary node", () => {
  it("evaluates truthy branch in async mode", async () => {
    expect(await asyncEng.evaluate(viaResolver("true ? 1 : 2"), { _dummy } as never)).toBe(1);
  });

  it("evaluates falsy branch in async mode", async () => {
    expect(await asyncEng.evaluate(viaResolver("false ? 1 : 2"), { _dummy } as never)).toBe(2);
  });
});

// ── callFunctionValueAsync — ContextFilterFn as nativeFn ─────────────────────

describe("callFunctionValue (sync) — ContextFilterFn as nativeFn and missing params", () => {
  it("ContextFilterFn (size) used as native value in sync map", async () => {
    // In sync mode (no Resolver), 'size' becomes fn.nativeFn and isContextFilter(size)
    // is true — covers the context-filter branch of callFunctionValue (line 109/110).
    const result = await eng.evaluate("[[1,2],[3,4,5],[]] | map(size)");
    expect(result).toEqual([2, 3, 0]);
  });

  it("missing params are filled with null in sync mode", async () => {
    // map calls the 2-param arrow with 1 arg; b → undefined → null via `?? null` (line 121)
    const result = await eng.evaluate("[1, 2, 3] | map((a, b) => b ?? 99)");
    expect(result).toEqual([99, 99, 99]);
  });
});

describe("callFunctionValueAsync — fewer args than params (async path)", () => {
  it("missing params are filled with null in async mode", async () => {
    // map calls the 2-param arrow with 1 arg; b → undefined → null via `?? null` (line 511)
    const result = await asyncEng.evaluate(viaResolver("[1, 2, 3] | map((a, b) => b ?? 99)"), { _dummy } as never);
    expect(result).toEqual([99, 99, 99]);
  });
});

describe("callFunctionValueAsync — ContextFilterFn nativeFn path", () => {
  it("ContextFilterFn (size) used as native value calls the context-filter branch", async () => {
    // 'size' is a ContextFilterFn; used as a value it becomes fn.nativeFn.
    // callFunctionValueAsync routes it through isContextFilter=true (line 505).
    const result = await asyncEng.evaluate(viaResolver("[[1,2],[3,4,5],[]] | map(size)"), { _dummy } as never);
    expect(result).toEqual([2, 3, 0]);
  });

  it("async regular filter as nativeFn returns a Promise (await branch)", async () => {
    // An async FilterFn returns a Promise; callFunctionValueAsync must await it (line 507).
    const asyncStr = async (v: Value): Promise<Value> => String(v);
    const eng2 = asyncEng.derive({ filters: { asyncStr: asyncStr as FilterFn } });
    const result = await eng2.evaluate(viaResolver("[1, 2, 3] | map(asyncStr)"), { _dummy } as never);
    expect(result).toEqual(["1", "2", "3"]);
  });
});

// ── evaluateCallAsync — async non-context filter (Promise-returning direct call)

describe("evaluateCallAsync — async regular filter called directly", () => {
  it("async filter returning Promise is awaited (line 547 await branch)", async () => {
    // A direct call to an async FilterFn in async mode goes through the
    // non-isContextFilter path; `result instanceof Promise` is true → await.
    const asyncDouble = async (v: Value): Promise<Value> => (v as number) * 2;
    const eng2 = asyncEng.derive({ filters: { asyncDouble: asyncDouble as FilterFn } });
    const result = await eng2.evaluate(viaResolver("asyncDouble(5)"), { _dummy } as never);
    expect(result).toBe(10);
  });
});
