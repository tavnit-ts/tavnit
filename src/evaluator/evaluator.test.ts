import { describe, expect, it } from "vitest";
import { createEngine } from "../engine/engine.js";
import { parse } from "../parser/parse.js";
import { evaluate, scoped } from "./evaluate.js";
import {
  type ContextFilterFn,
  type DataContext,
  type EvalContext,
  EvaluationError,
  type FilterFn,
  type FilterRegistry,
  isContextFilter,
  Resolver,
  resolve,
  type RuntimeLimits,
  type Semantics,
  type Value,
  contextFilter,
} from "./types.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

const DEFAULT_LIMITS: RuntimeLimits = {
  maxDepth: 50,
  maxIterations: 10_000,
  maxSteps: 10_000_000,
  timeoutMs: Number.POSITIVE_INFINITY,
  maxStringLength: 10_000_000,
  maxRegexInput: 100_000,
};

function makeCtx(
  data: DataContext = {},
  filters: FilterRegistry = {},
  limits: Partial<RuntimeLimits> = {},
  semantics: Semantics = { strict: false, infiniteDivision: true },
): EvalContext {
  return {
    data,
    locals: null,
    filters,
    limits: { ...DEFAULT_LIMITS, ...limits },
    iterBudget: { remaining: limits.maxIterations ?? DEFAULT_LIMITS.maxIterations },
    steps: { remaining: limits.maxSteps ?? DEFAULT_LIMITS.maxSteps },
    semantics,
    secretRoots: [],
    startTime: Date.now(),
    timeoutCheck: { remaining: 1 },
    invokeFn: () => { throw new EvaluationError("invokeFn not initialised"); },
    asyncMode: false,
  };
}

function ev(src: string, data: DataContext = {}, filters: FilterRegistry = {}): Value {
  return evaluate(parse(src), makeCtx(data, filters));
}


function evErr(src: string, data: DataContext = {}, filters: FilterRegistry = {}): string {
  try {
    ev(src, data, filters);
    throw new Error("Expected EvaluationError but got no error");
  } catch (e) {
    if (e instanceof EvaluationError) return e.message;
    throw e;
  }
}

describe("contextFilter", () => {
  it("marks a context-aware filter and preserves its implementation", () => {
    const filter = contextFilter((ctx, value) => ctx.iterBudget.remaining + Number(value));

    expect(isContextFilter(filter)).toBe(true);
    expect(isContextFilter((value: Value) => value)).toBe(false);
    expect(filter(makeCtx({}, {}, { maxIterations: 2 }), 3)).toBe(5);
  });
});

// ── Literals ──────────────────────────────────────────────────────────────────

describe("literals", () => {
  it("number integer", () => expect(ev("42")).toBe(42));
  it("number float", () => expect(ev("3.14")).toBe(3.14));
  it("negative number via unary", () => expect(ev("-7")).toBe(-7));
  it("string double-quoted", () => expect(ev('"hello"')).toBe("hello"));
  it("string single-quoted", () => expect(ev("'world'")).toBe("world"));
  it("true", () => expect(ev("true")).toBe(true));
  it("false", () => expect(ev("false")).toBe(false));
  it("null", () => expect(ev("null")).toBeNull());
});

// ── Identifiers ───────────────────────────────────────────────────────────────

describe("identifiers", () => {
  it("resolves from data context", () => expect(ev("x", { x: 42 })).toBe(42));
  it("absent key evaluates to null", () => expect(ev("missing")).toBeNull());
  it("string value", () => expect(ev("name", { name: "Alice" })).toBe("Alice"));
  it("boolean value", () => expect(ev("ok", { ok: true })).toBe(true));
  it("nested object value", () => {
    expect(ev("obj", { obj: { a: 1 } })).toEqual({ a: 1 });
  });
  it("null value in context", () => expect(ev("n", { n: null })).toBeNull());
});

// ── Array literals ────────────────────────────────────────────────────────────

describe("array literals", () => {
  it("empty array", () => expect(ev("[]")).toEqual([]));
  it("number elements", () => expect(ev("[1, 2, 3]")).toEqual([1, 2, 3]));
  it("mixed elements", () => expect(ev('[1, "a", true, null]')).toEqual([1, "a", true, null]));
  it("nested array", () => expect(ev("[[1, 2], [3, 4]]")).toEqual([[1, 2], [3, 4]]));
  it("elements are expressions", () => {
    expect(ev("[x + 1, y * 2]", { x: 3, y: 4 })).toEqual([4, 8]);
  });
});

// ── Object literals ───────────────────────────────────────────────────────────

describe("object literals", () => {
  it("empty object", () => expect(ev("{}")).toEqual({}));
  it("single key", () => expect(ev('{ "a": 1 }')).toEqual({ a: 1 }));
  it("multiple keys", () => expect(ev('{ "a": 1, "b": 2 }')).toEqual({ a: 1, b: 2 }));
  it("values are expressions", () => {
    expect(ev('{ "total": price * qty }', { price: 10, qty: 3 })).toEqual({ total: 30 });
  });
});

// ── Unary operators ───────────────────────────────────────────────────────────

describe("unary operators", () => {
  it("! on truthy value", () => expect(ev("!true")).toBe(false));
  it("! on falsy value", () => expect(ev("!false")).toBe(true));
  it("! on 0", () => expect(ev("!0")).toBe(true));
  it("! on empty string", () => expect(ev('!""')).toBe(true));
  it("! on null", () => expect(ev("!null")).toBe(true));
  it("not on truthy", () => expect(ev("not true")).toBe(false));
  it("not on falsy", () => expect(ev("not false")).toBe(true));
  it("!! double negation", () => expect(ev("!!true")).toBe(true));
  it("unary minus on number", () => expect(ev("-42")).toBe(-42));
  it("unary minus on zero", () => expect(ev("-0")).toBe(-0));
  it("unary minus on non-number throws", () => {
    expect(evErr('-"str"')).toMatch(/number/);
  });
});

// ── Arithmetic operators ──────────────────────────────────────────────────────

describe("arithmetic", () => {
  it("addition of numbers", () => expect(ev("2 + 3")).toBe(5));
  it("string concatenation", () => expect(ev('"a" + "b"')).toBe("ab"));
  it("subtraction", () => expect(ev("10 - 3")).toBe(7));
  it("multiplication", () => expect(ev("4 * 5")).toBe(20));
  it("division", () => expect(ev("10 / 4")).toBe(2.5));
  it("modulo", () => expect(ev("10 % 3")).toBe(1));
  it("string + number coerces to string", () => expect(ev('"item-" + 3')).toBe("item-3"));
  it("number + string coerces to string", () => expect(ev('3 + "-item"')).toBe("3-item"));
  it("string + boolean coerces to string", () => expect(ev('"flag: " + true')).toBe("flag: true"));
  it("string + null coerces to string", () => expect(ev('"val: " + null')).toBe("val: null"));
  it("+ on string and array throws", () => {
    expect(evErr('"a" + arr', { arr: [1, 2] })).toMatch(/\+/);
  });
  it("- on non-numbers throws", () => {
    expect(evErr('"a" - 1')).toMatch(/-/);
  });
  it("* on non-numbers throws", () => {
    expect(evErr('"a" * 2')).toMatch(/\*/);
  });
  it("division by zero → Infinity (JS semantics)", () => expect(ev("1 / 0")).toBe(Number.POSITIVE_INFINITY));
  it("0/0 → NaN (JS semantics)", () => expect(ev("0 / 0")).toBeNaN());
  it("parentheses group correctly", () => expect(ev("(2 + 3) * 4")).toBe(20));
  it("precedence: * before +", () => expect(ev("2 + 3 * 4")).toBe(14));
});

// ── Comparison operators ──────────────────────────────────────────────────────

describe("comparison", () => {
  it("== same numbers", () => expect(ev("1 == 1")).toBe(true));
  it("== different numbers", () => expect(ev("1 == 2")).toBe(false));
  it("!= different numbers", () => expect(ev("1 != 2")).toBe(true));
  it("strict equality: no type coercion", () => expect(ev('1 == "1"')).toBe(false));
  it("null == null", () => expect(ev("null == null")).toBe(true));
  it("null != false (strict)", () => expect(ev("null == false")).toBe(false));
  it("< numbers", () => expect(ev("1 < 2")).toBe(true));
  it("> numbers", () => expect(ev("2 > 1")).toBe(true));
  it("<= equal", () => expect(ev("2 <= 2")).toBe(true));
  it(">= greater", () => expect(ev("3 >= 2")).toBe(true));
  it("< on strings compares by code unit", () => {
    expect(ev('"a" < "b"')).toBe(true);
    expect(ev('"10" < "9"')).toBe(true);
  });
  it("< on a mixed pair throws", () => {
    expect(evErr('1 < "b"')).toMatch(/requires two numbers or two strings/);
  });
});

// ── Logical operators ─────────────────────────────────────────────────────────

describe("logical operators", () => {
  it("&& both truthy", () => expect(ev("true && true")).toBe(true));
  it("&& short-circuits on falsy left", () => {
    let called = false;
    ev("false && fn()", {}, { fn: () => { called = true; return true; } });
    expect(called).toBe(false);
  });
  it("&& returns first falsy or last value", () => {
    expect(ev("0 && 42")).toBe(0);
    expect(ev("1 && 42")).toBe(42);
  });
  it("|| short-circuits on truthy left", () => {
    let called = false;
    ev("true || fn()", {}, { fn: () => { called = true; return false; } });
    expect(called).toBe(false);
  });
  it("|| returns first truthy or last value", () => {
    expect(ev("0 || 42")).toBe(42);
    expect(ev('"" || "fallback"')).toBe("fallback");
    expect(ev("true || false")).toBe(true);
  });
  it("and keyword works like &&", () => expect(ev("true and true")).toBe(true));
  it("or keyword works like ||", () => expect(ev("false or true")).toBe(true));
  it("&& precedence over ||", () => expect(ev("false || true && false")).toBe(false));
});

// ── Nullish coalescing ────────────────────────────────────────────────────────

describe("nullish coalescing", () => {
  it("?? returns right when left is null", () => expect(ev("null ?? 42")).toBe(42));
  it("?? returns left when 0 (preserves falsy non-null)", () => expect(ev("0 ?? 42")).toBe(0));
  it("?? returns left when false", () => expect(ev("false ?? 42")).toBe(false));
  it("?? returns left when empty string", () => expect(ev('"" ?? "fallback"')).toBe(""));
  it("?? chain falls through to first non-null", () => {
    expect(ev("null ?? null ?? 42")).toBe(42);
    expect(ev("null ?? 1 ?? 2")).toBe(1);
  });
  it("identifier ?? fallback", () => {
    expect(ev("missing ?? 99")).toBe(99);
    expect(ev("x ?? 99", { x: 0 })).toBe(0);
  });
});

// ── Membership (in) ───────────────────────────────────────────────────────────

describe("in operator", () => {
  it("value in array (found)", () => expect(ev('"b" in arr', { arr: ["a", "b", "c"] })).toBe(true));
  it("value in array (not found)", () => expect(ev('"d" in arr', { arr: ["a", "b", "c"] })).toBe(false));
  it("number in array", () => expect(ev("2 in arr", { arr: [1, 2, 3] })).toBe(true));
  it("strict equality: no coercion", () => expect(ev('1 in arr', { arr: ["1"] })).toBe(false));
  it("string in string (substring)", () => expect(ev('"ell" in str', { str: "hello" })).toBe(true));
  it("string in string (not found)", () => expect(ev('"xyz" in str', { str: "hello" })).toBe(false));
  it("non-string needle in string throws", () => {
    expect(evErr("1 in str", { str: "hello" })).toMatch(/string/);
  });
  it("in with non-array/string right-hand side throws", () => {
    expect(evErr("1 in 42")).toMatch(/array or string/);
  });
});

// ── Ternary ───────────────────────────────────────────────────────────────────

describe("ternary", () => {
  it("truthy condition → consequent", () => expect(ev('true ? "yes" : "no"')).toBe("yes"));
  it("falsy condition → alternate", () => expect(ev('false ? "yes" : "no"')).toBe("no"));
  it("0 is falsy", () => expect(ev('0 ? "yes" : "no"')).toBe("no"));
  it("empty string is falsy", () => expect(ev('"" ? "yes" : "no"')).toBe("no"));
  it("null is falsy", () => expect(ev('null ? "yes" : "no"')).toBe("no"));
  it("nested ternary", () => {
    expect(ev("x > 0 ? \"pos\" : x < 0 ? \"neg\" : \"zero\"", { x: -1 })).toBe("neg");
  });
  it("only the matching branch is evaluated", () => {
    let calls = 0;
    const fn = (): Value => { calls++; return "called"; };
    ev("true ? fn() : fn()", {}, { fn });
    expect(calls).toBe(1);
  });
});

// ── Member access ─────────────────────────────────────────────────────────────

describe("member access", () => {
  it("dot access on object", () => expect(ev("obj.a", { obj: { a: 42 } })).toBe(42));
  it("nested dot access", () => {
    expect(ev("a.b.c", { a: { b: { c: "deep" } } })).toBe("deep");
  });
  it("absent key returns null", () => expect(ev("obj.missing", { obj: { a: 1 } })).toBeNull());
  it("non-optional access on null throws", () => {
    expect(evErr("obj.a", { obj: null })).toMatch(/null/);
  });
  it("optional access on null returns null", () => {
    expect(ev("obj?.a", { obj: null })).toBeNull();
  });
  it("optional chaining continues after null", () => {
    expect(ev("a?.b?.c", { a: null })).toBeNull();
  });
  it("optional access on non-null returns value", () => {
    expect(ev("obj?.a", { obj: { a: 99 } })).toBe(99);
  });
});

// ── Index access ──────────────────────────────────────────────────────────────

describe("index access", () => {
  it("array index", () => expect(ev("arr[1]", { arr: [10, 20, 30] })).toBe(20));
  it("array index 0", () => expect(ev("arr[0]", { arr: [10, 20, 30] })).toBe(10));
  it("out-of-bounds array index returns null", () => {
    expect(ev("arr[5]", { arr: [1, 2, 3] })).toBeNull();
  });
  it("object string key", () => expect(ev('obj["a"]', { obj: { a: 42 } })).toBe(42));
  it("object key missing returns null", () => {
    expect(ev('obj["z"]', { obj: { a: 1 } })).toBeNull();
  });
  it("non-optional index on null throws", () => {
    expect(evErr("obj[0]", { obj: null })).toMatch(/null/);
  });
  it("optional index on null returns null", () => {
    expect(ev("obj?.[0]", { obj: null })).toBeNull();
  });
  it("non-numeric index on array throws", () => {
    expect(evErr('arr["x"]', { arr: [1, 2, 3] })).toMatch(/number/);
  });
  it("index into a primitive throws", () => {
    expect(evErr("n[0]", { n: 42 })).toMatch(/index/);
  });
  it("dynamic key from data", () => {
    expect(ev("obj[key]", { obj: { foo: 99 }, key: "foo" })).toBe(99);
  });
});

// ── Function calls ────────────────────────────────────────────────────────────

describe("function calls", () => {
  it("single argument", () => {
    expect(ev("double(x)", { x: 5 }, { double: (v) => (v as number) * 2 })).toBe(10);
  });
  it("multiple arguments", () => {
    expect(ev("add(a, b)", { a: 3, b: 4 }, { add: (a, b) => (a as number) + (b as number) })).toBe(7);
  });
  it("no arguments", () => {
    expect(ev("getOne()", {}, { getOne: () => 1 })).toBe(1);
  });
  it("unregistered function throws", () => {
    expect(evErr("unknown()")).toMatch(/Unknown function 'unknown'/);
  });
  it("data-context values are not callable", () => {
    // Even if context carries something that might look callable, calling it fails
    expect(evErr("fn()", { fn: null })).toMatch(/Unknown function 'fn'/);
  });
  it("nested call", () => {
    expect(ev("neg(neg(x))", { x: 5 }, { neg: (v) => -(v as number) })).toBe(5);
  });
});

// ── Pipe operator ─────────────────────────────────────────────────────────────

describe("pipe operator", () => {
  it("basic pipe: value | fn", () => {
    expect(ev("x | double", { x: 5 }, { double: (v) => (v as number) * 2 })).toBe(10);
  });
  it("pipe with args: value | fn(arg)", () => {
    expect(
      ev("x | add(10)", { x: 5 }, { add: (v, n) => (v as number) + (n as number) }),
    ).toBe(15);
  });
  it("pipe chain", () => {
    const filters: FilterRegistry = {
      double: (v) => (v as number) * 2,
      inc: (v) => (v as number) + 1,
    };
    expect(ev("x | double | inc", { x: 3 }, filters)).toBe(7);
  });
  it("pipe is left-associative", () => {
    // (x | double) | double  should equal x * 4
    expect(
      ev("x | double | double", { x: 3 }, { double: (v) => (v as number) * 2 }),
    ).toBe(12);
  });
  it("pipe with expression args", () => {
    expect(
      ev("x | add(y * 2)", { x: 1, y: 3 }, { add: (v, n) => (v as number) + (n as number) }),
    ).toBe(7);
  });
  it("pipe callee not in registry throws", () => {
    expect(evErr("x | missing", { x: 1 })).toMatch(/Unknown function 'missing'/);
  });
});

// ── Property access on nested objects ────────────────────────────────────────

describe("nested property access", () => {
  it("chain of properties", () => {
    const data = { user: { address: { city: "Moscow" } } };
    expect(ev("user.address.city", data)).toBe("Moscow");
  });
  it("null propagation with optional chain", () => {
    const data: DataContext = { user: null };
    expect(ev("user?.address?.city", data)).toBeNull();
  });
  it("optional chain with missing intermediate", () => {
    const data = { user: { name: "Alice" } };
    expect(ev("user?.address?.city", data)).toBeNull();
  });
  it("absent top-level key then dot throws (non-optional)", () => {
    expect(evErr("missing.prop")).toMatch(/null/);
  });
  it("absent top-level key then optional dot is safe", () => {
    expect(ev("missing?.prop")).toBeNull();
  });
});

// ── maxDepth guard ────────────────────────────────────────────────────────────

describe("maxDepth", () => {
  it("deeply nested expression within limit passes", () => {
    // (((1 + 1) + 1) + ...) — nesting via grouping and binary ops
    const src = Array.from({ length: 20 }, (_, i) => i + 1).join(" + ");
    expect(typeof ev(src)).toBe("number");
  });

  it("throws when maxDepth is exceeded", () => {
    // Build a deeply nested call chain that forces depth > 3
    const filters: FilterRegistry = {
      id: (v) => v,
    };
    const ctx: EvalContext = {
      data: { x: 1 },
      locals: null,
      filters,
      limits: { ...DEFAULT_LIMITS, maxDepth: 3 },
      iterBudget: { remaining: 10_000 },
      steps: { remaining: 10_000 },
      semantics: { strict: false, infiniteDivision: true, undefinedIsAbsent: false },
      secretRoots: [],
      startTime: Date.now(),
      timeoutCheck: { remaining: 1 },
      invokeFn: () => { throw new EvaluationError("invokeFn not initialised"); },
    };
    // id(id(id(id(x)))) — 4 levels of nesting from root
    const node = parse("id(id(id(id(x))))");
    expect(() => evaluate(node, ctx)).toThrow(EvaluationError);
    expect(() => evaluate(node, ctx)).toThrow(/Recursion depth limit 3 exceeded; raise maxDepth/);
  });
});

// ── Mixed precedence ──────────────────────────────────────────────────────────

describe("mixed precedence", () => {
  it("arithmetic before comparison", () => expect(ev("2 + 3 == 5")).toBe(true));
  it("comparison before logical", () => expect(ev("1 < 2 && 3 < 4")).toBe(true));
  it("! before &&", () => expect(ev("!false && true")).toBe(true));
  it("* before +", () => expect(ev("1 + 2 * 3")).toBe(7));
  it("complex: (a + b) * c == d", () => expect(ev("(a + b) * c == d", { a: 1, b: 2, c: 3, d: 9 })).toBe(true));
  it("ternary with logical", () => expect(ev("(1 == 1 && 2 == 2) ? 99 : 0")).toBe(99));
});

// ── Array / object truthiness (isTruthy line 19) ─────────────────────────────

describe("array and object truthiness", () => {
  it("empty array is truthy", () => expect(ev("![]")).toBe(false));
  it("non-empty array is truthy", () => expect(ev("![1,2]")).toBe(false));
  it("empty object is truthy", () => expect(ev("!{}")).toBe(false));
  it("array in ternary", () => expect(ev('arr ? "yes" : "no"', { arr: [] })).toBe("yes"));
});

// ── Dot access on array and primitive returns null ────────────────────────────

describe("member access on non-object", () => {
  it("dot access on array returns null", () => {
    expect(ev("arr.length", { arr: [1, 2, 3] })).toBeNull();
  });
  it("dot access on number returns null", () => {
    expect(ev("n.foo", { n: 42 })).toBeNull();
  });
  it("dot access on string returns null", () => {
    expect(ev("s.length", { s: "hello" })).toBeNull();
  });
});

// ── Index access with non-primitive key on object throws ──────────────────────

describe("index access edge cases", () => {
  it("object index with array key throws", () => {
    const filters: FilterRegistry = {
      getKey: () => [1, 2],
    };
    // obj[getKey()] — the key is an array, not a string/number
    expect(
      evErr("obj[getKey()]", { obj: { a: 1 } }, filters),
    ).toMatch(/string or number/);
  });
  it("negative array index returns null", () => {
    expect(ev("arr[-1]", { arr: [10, 20, 30] })).toBeNull();
  });
  it("float index is truncated to integer", () => {
    expect(ev("arr[1.9]", { arr: [10, 20, 30] })).toBe(20);
  });
});

// ── String operations ─────────────────────────────────────────────────────────

describe("string operations", () => {
  it("concatenation via +", () => expect(ev('"Hello" + ", " + "world"')).toBe("Hello, world"));
  it("string from context", () => expect(ev('first + " " + last', { first: "Jane", last: "Doe" })).toBe("Jane Doe"));
});

// ── Comprehensive data-context tests ─────────────────────────────────────────

describe("data context", () => {
  it("null context value propagates with ??", () => {
    expect(ev("price ?? 0", { price: null })).toBe(0);
  });
  it("zero is not null — ?? preserves it", () => {
    expect(ev("count ?? 10", { count: 0 })).toBe(0);
  });
  it("false is not null — ?? preserves it", () => {
    expect(ev("enabled ?? true", { enabled: false })).toBe(false);
  });
  it("complex expression over context", () => {
    const data = { price: 10, qty: 3, discount: 5 };
    expect(ev("price * qty - discount", data)).toBe(25);
  });
});

// ── Async filter guards ───────────────────────────────────────────────────────

describe("async filter guards", () => {
  it("regular async filter throws EvaluationError", () => {
    const asyncF: FilterFn = async (v) => v;
    expect(() => ev("x | asyncF", { x: 1 }, { asyncF })).toThrow(EvaluationError);
    expect(() => ev("x | asyncF", { x: 1 }, { asyncF })).toThrow(/async/);
  });

  it("context-aware async filter throws EvaluationError", () => {
    const asyncCtxF: ContextFilterFn = contextFilter(
      (_ctx: EvalContext, v: Value): Promise<Value> => Promise.resolve(v),
    );
    const ctx: EvalContext = {
      ...makeCtx({ x: 1 }),
      filters: { asyncCtxF },
    };
    expect(() => evaluate(parse("x | asyncCtxF"), ctx)).toThrow(EvaluationError);
    expect(() => evaluate(parse("x | asyncCtxF"), ctx)).toThrow(/async/);
  });
});

// ── Resolver sync-path guards ─────────────────────────────────────────────────

describe("Resolver sync-path guards", () => {
  const store: Record<string, Value> = { x: 1 };
  const r = resolve(async (key) => store[key] ?? null);

  it("member access on Resolver throws EvaluationError", () => {
    expect(() => ev("state.x", { state: r })).toThrow(EvaluationError);
    expect(() => ev("state.x", { state: r })).toThrow(/Resolver 'state' requires async/);
  });

  it("a Resolver that is not a root is reported without a name", () => {
    expect(() => ev("box.state.x", { box: { state: r } })).toThrow(/^Resolver requires async/);
  });

  it("index access on Resolver throws EvaluationError", () => {
    expect(() => ev('state["x"]', { state: r })).toThrow(EvaluationError);
    expect(() => ev('state["x"]', { state: r })).toThrow(/Resolver 'state' requires async/);
  });

  describe("with staticValues", () => {
    const withStatic = resolve(async (key) => store[key] ?? null, { x: 1 });

    it("member access reads an own static value synchronously", () => {
      expect(ev("state.x", { state: withStatic })).toBe(1);
    });

    it("index access reads an own static value synchronously", () => {
      expect(ev('state["x"]', { state: withStatic })).toBe(1);
    });

    it("a key outside staticValues still requires async", () => {
      expect(() => ev("state.y", { state: withStatic })).toThrow(/Resolver 'state' requires async/);
      expect(() => ev('state["y"]', { state: withStatic })).toThrow(/Resolver 'state' requires async/);
    });
  });

  it("Resolver in array literal throws EvaluationError", () => {
    expect(() => ev("[state]", { state: r })).toThrow(EvaluationError);
    expect(() => ev("[state]", { state: r })).toThrow(/Resolver values cannot be stored/);
  });

  it("Resolver in object literal throws EvaluationError", () => {
    expect(() => ev("{ a: state }", { state: r })).toThrow(EvaluationError);
    expect(() => ev("{ a: state }", { state: r })).toThrow(/Resolver values cannot be stored/);
  });

  it("resolve() returns a Resolver instance", () => {
    expect(r).toBeInstanceOf(Resolver);
  });
});

// ── Resolver inside arrow function bodies ─────────────────────────────────────

describe("Resolver inside arrow function body", () => {
  const eng = createEngine({ timeoutMs: 5000 });
  const store: Record<string, unknown> = { threshold: 5, prefix: "x-" };
  const state = resolve(async (key) => (store[key] ?? null) as never);

  it("filter: arrow body accesses Resolver member", async () => {
    const result = await eng.evaluate("[1, 6, 3, 8] | filter(x => x > state.threshold)", { state });
    expect(result).toEqual([6, 8]);
  });

  it("map: arrow body accesses Resolver member", async () => {
    const result = await eng.evaluate('["a","b"] | map(x => state.prefix + x)', { state });
    expect(result).toEqual(["x-a", "x-b"]);
  });

  it("filter: nested Resolver access inside arrow", async () => {
    const items = [{ val: 3 }, { val: 7 }, { val: 2 }];
    const result = await eng.evaluate("items | filter(x => x.val > state.threshold)", { state, items });
    expect(result).toEqual([{ val: 7 }]);
  });
});

describe("scoped", () => {
  it("scoped copies every field of the context and replaces only the scope", () => {
    const full: EvalContext = {
      ...makeCtx({ a: 1 }),
      regex: "native",
      callHostFunction: () => null,
      runtimeValues: { now: 1 },
    };
    const locals = { vars: { x: 1 }, parent: null };
    const inner = scoped(full, { b: 2 }, locals);
    expect(Object.keys(inner).sort()).toEqual(Object.keys(full).sort());
    expect({ ...inner, data: full.data, locals: full.locals }).toEqual(full);
    expect(inner.data).toEqual({ b: 2 });
    expect(inner.locals).toBe(locals);
    expect(scoped(full, full.data, null, true).asyncMode).toBe(true);
    expect(scoped(full, full.data, null).asyncMode).toBe(full.asyncMode);
  });
});
