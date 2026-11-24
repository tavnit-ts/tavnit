import { describe, expect, it } from "vitest";
import { opaque, TavnitInstant, type DataContext, type Value } from "../evaluator/types.js";
import { createEngine } from "./engine.js";
import { ExpressionError } from "./types.js";

const engine = createEngine({ strict: false });
const strictEngine = createEngine({ strict: true });

/** A context a host could build, which the `DataContext` type forbids. */
function hostile(value: object): DataContext {
  return value as DataContext;
}

async function rejection(context: DataContext, source = "a", using = engine): Promise<ExpressionError> {
  const error = await using.evaluate(source, context).then(
    () => { throw new Error("expected a rejection"); },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ExpressionError);
  return error as ExpressionError;
}

class Point {
  x = 1;
}

describe("a value from the host is checked as the expression reads it", () => {
  class Money { amount = 1; }

  it.each([
    ["a function", { a: () => 1 }, "Context value `a` is a function; Tavnit does not call functions from data (register a filter instead)"],
    ["a nested function", { a: { b: [1, { c: () => 1 }] } }, "Context value `a.b[1].c` is a function; Tavnit does not call functions from data (register a filter instead)"],
    ["a BigInt", { a: 10n }, "Context value `a` is a BigInt; convert it to a number or a string"],
    ["a symbol", { a: Symbol("s") }, "Context value `a` is a symbol"],
    ["a Map", { a: new Map([["k", 1]]) }, "Context value `a` is a Map; convert it with Object.fromEntries()"],
    ["a Set", { a: new Set([1]) }, "Context value `a` is a Set; convert it with Array.from()"],
    ["a Promise", { a: Promise.resolve(1) }, "Context value `a` is a Promise; await it before the call, or pass a resolve() root"],
    ["a RegExp", { a: /x/ }, "Context value `a` is an instance of RegExp; pass a plain object, array, string, number, boolean, null or Date"],
    ["an Error", { a: new Error("x") }, "Context value `a` is an instance of Error; pass a plain object, array, string, number, boolean, null or Date"],
    ["a typed array", { a: new Uint8Array(2) }, "Context value `a` is an instance of Uint8Array; pass a plain object, array, string, number, boolean, null or Date"],
    ["an invalid Date", { a: new Date(Number.NaN) }, "Context value `a` is an invalid Date"],
  ])("rejects %s", async (name, context, message) => {
    // The expression reads the value by name, field and index: a nested value is checked when it is reached.
    const source = name === "a nested function" ? "a.b[1].c" : "a";
    const error = await rejection(hostile(context), source);
    expect(error.errors).toHaveLength(1);
    expect(error.errors[0].message).toBe(message);
    expect(error.errors[0].code).toBe("TAV_CONTEXT");
  });

  it("rejects an instance of the host's own class in strict mode only", async () => {
    const message = "Context value `a[0]` is an instance of Money; pass a plain object, array, string, number, boolean, null or Date";
    expect((await rejection(hostile({ a: [new Money()] }), "a[0]", strictEngine)).errors[0]).toMatchObject({ code: "TAV_CONTEXT", message });
    expect((await rejection(hostile({ a: new Point() }), "a", strictEngine)).errors[0].message).toContain("instance of Point");
    // Lenient mode reads such an instance through its own properties, as it always did.
    expect(await engine.evaluate("a.amount", hostile({ a: new Money() }))).toBe(1);
    expect(await engine.evaluate("a.x", hostile({ a: new Point() }))).toBe(1);
    // The fields of such a handle are not walked, so a Map inside it is the host's own business.
    class Handle { slots = new Map<string, number>(); }
    expect(await engine.evaluate("1", hostile({ ctx: new Handle() }))).toBe(1);
  });

  it("reads a cycle, and reports serialising it as a context error", async () => {
    const loop: { [key: string]: Value } = { name: "loop" };
    loop.self = loop;
    expect(await engine.evaluate("a.self.self.name", { a: loop })).toBe("loop");
    for (const run of [() => engine.evaluate("json(a)", { a: loop }), () => engine.render("${{ a }}", { a: loop })]) {
      const error = await run().then(() => { throw new Error("expected a rejection"); }, (e: unknown) => e as ExpressionError);
      expect(error.errors[0]).toMatchObject({ code: "TAV_CONTEXT", message: "Cannot serialise a value that contains a cycle; a context must be a tree" });
    }
  });

  it("names the access path of the bad value", async () => {
    const error = await rejection(hostile({ a: { b: [() => 1] } }), "a.b[0]");
    expect(error.errors[0].access).toBe("a.b[0]");
    // A dynamic key is shown as an ellipsis.
    const dynamic = await rejection(hostile({ a: { b: () => 1 }, k: "b" }), "a[k]");
    expect(dynamic.errors[0].access).toBe("a[…]");
  });

  it("rejects through every entry point", async () => {
    const context = hostile({ a: () => 1 });
    await expect(engine.render("${{ a }}", context)).rejects.toThrow("Context value `a` is a function");
    await expect(engine.render("x ${{ a }}", context)).rejects.toThrow("Context value");
    await expect(engine.renderObject({ k: "${{ a }}" }, context)).rejects.toThrow("Context value");
    await expect(engine.evaluate(engine.parse("a"), context)).rejects.toThrow("Context value");
    expect(() => engine.evaluateSync("a", context)).toThrow("Context value `a` is a function");
  });

  it("does not look at a bad value the expression never reads", async () => {
    expect(await engine.evaluate("1 + 1", hostile({ unused: 10n, f: () => 1 }))).toBe(2);
  });

  it("reads deeply nested data without a walk over it", async () => {
    let deep: object = { leaf: 1 };
    for (let level = 0; level < 100_000; level++) deep = { next: deep };
    expect(await engine.evaluate("a.next | type", hostile({ a: deep }))).toBe("object");
  });

  it("checks a value of a lambda parameter and a registered local as it is read", async () => {
    await expect(engine.evaluate("items | map(x => x)", hostile({ items: [1, () => 2] }))).rejects.toThrow("Context value `x` is a function");
    await expect(engine.evaluate("let f = a in f", hostile({ a: 10n }))).rejects.toThrow("Context value `a` is a BigInt");
  });
});

describe("what the context accepts", () => {
  it("passes plain data unchanged", async () => {
    const context = { s: "x", n: 1, b: true, z: null, list: [1, [2]], obj: { k: { j: 1 } }, nothing: undefined as never };
    expect(await engine.evaluate("[s, n, b, z, list, obj, nothing]", context)).toEqual(["x", 1, true, null, [1, [2]], { k: { j: 1 } }, null]);
  });

  it("accepts process.env, whose prototype belongs to an anonymous class", async () => {
    expect(await engine.evaluate("ok", { ok: 1, env: process.env as never })).toBe(1);
  });

  it("accepts an object whose prototype is a plain object or has no constructor", async () => {
    const inherited = Object.create({ shared: 1 }) as { [key: string]: Value };
    inherited.own = 2;
    const bare = Object.create(Object.create(null)) as { [key: string]: Value };
    bare.own = 3;
    expect(await engine.evaluate("[a.own, b.own]", { a: inherited, b: bare })).toEqual([2, 3]);
  });

  it("accepts an object with a null prototype and a shared sub-object", async () => {
    const bare: { [key: string]: Value } = Object.create(null);
    bare.k = 1;
    const shared = { v: 2 };
    expect(await engine.evaluate("[bare.k, a.v, b.v]", { bare, a: shared, b: shared })).toEqual([1, 2, 2]);
  });

  it("keeps NaN and Infinity as numbers", async () => {
    expect(await engine.evaluate("[a, b]", { a: Number.NaN, b: Number.POSITIVE_INFINITY })).toEqual([Number.NaN, Number.POSITIVE_INFINITY]);
  });

  it("converts a Date to an instant", async () => {
    const date = new Date(Date.UTC(2026, 10, 8, 12, 30));
    const converted = await engine.evaluate("d", { d: date });
    expect(converted).toBeInstanceOf(TavnitInstant);
    expect(await engine.render("${{ d }}", { d: date })).toBe("2026-11-08T12:30:00Z");
    expect(await engine.evaluate('d | format("yyyy-MM-dd")', { d: date })).toBe("2026-11-08");
    expect(await engine.evaluate("[d, e] | map(x => type(x))", { d: date, e: { inner: date } })).toEqual(["instant", "object"]);
    expect(await engine.evaluate("e.inner | type", { e: { inner: date } })).toBe("instant");
  });

  it("converts a Date inside an array and leaves the host's object alone", async () => {
    const date = new Date(0);
    const context = { list: [date] };
    expect(await engine.evaluate("list[0] | type", context)).toBe("instant");
    expect(context.list[0]).toBe(date);
  });

  it("checks a value on every read, so a later change to the context is seen", async () => {
    const context: { [key: string]: Value } = { a: 1 };
    expect(await engine.evaluate("a", context)).toBe(1);
    context.later = (() => 1) as never;
    await expect(engine.evaluate("later", context)).rejects.toThrow("is a function");
  });
});

describe("a subtree shared between contexts", () => {
  it("reads a shared subtree, with its Date converted, from two fresh contexts", async () => {
    const shared = { when: new Date(0), rows: [{ id: 1 }, { id: 2 }] };
    expect(await engine.evaluate("shared.rows | size", hostile({ shared, n: 1 }))).toBe(2);
    expect(await engine.evaluate("shared.rows | size", hostile({ shared, n: 2 }))).toBe(2);
    expect(await engine.evaluate("shared.when | type", hostile({ shared, n: 3 }))).toBe("instant");
  });

  it("still refuses a bad subtree in every fresh context", async () => {
    const bad = { map: new Map() };
    expect((await rejection(hostile({ bad, n: 1 }), "bad.map")).errors[0].code).toBe("TAV_CONTEXT");
    expect((await rejection(hostile({ bad, n: 2 }), "bad.map")).errors[0].code).toBe("TAV_CONTEXT");
  });
});

describe("opaque host values", () => {
  class Handle {
    readonly id = 7;
  }

  it("a strict engine refuses a named class instance unless the host marked it", async () => {
    const strict = createEngine({ strict: true });
    await expect(strict.evaluate("h", { h: new Handle() } as unknown as DataContext)).rejects.toThrow(/instance of Handle/);
    const marked = opaque(new Handle());
    expect(await strict.evaluate("h", { h: marked } as unknown as DataContext)).toBe(marked);
  });

  it("a marked value passes through a template", async () => {
    const strict = createEngine({ strict: true });
    const marked = opaque(new Handle());
    const out = await strict.evaluate("{ s: h }", { h: marked } as unknown as DataContext);
    expect((out as { s: unknown }).s).toBe(marked);
    expect(await strict.evaluate("h.nope ?? 1", { h: marked } as unknown as DataContext)).toBe(1);
  });
});

describe("the context is not walked before the call", () => {
  it("reads only the members an expression reaches", async () => {
    let reads = 0;
    const leaf = (n: number) => ({
      type: "Text",
      get text() {
        reads++;
        return `t${n}`;
      },
    });
    const tree = { type: "Surface", children: Array.from({ length: 50 }, (_, i) => ({ type: "Row", props: { a: leaf(i) } })) };
    const strict = createEngine({ strict: true });
    expect(await strict.evaluate("results.tree.type", { results: { tree } })).toBe("Surface");
    expect(reads).toBe(0);
    expect(await strict.evaluate("results.tree.children[3].props.a.text", { results: { tree } })).toBe("t3");
    expect(reads).toBe(1);
  });
});
