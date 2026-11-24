import { describe, expect, it } from "vitest";
import { resolve } from "../evaluator/types.js";
import { createCache } from "./cache.js";
import { createEngine } from "./engine.js";
import type { Value } from "./types.js";
import type { ValueTemplate } from "../parser/value-template.js";
import { ExpressionError } from "./types.js";

// ── parse() ───────────────────────────────────────────────────────────────────

describe("engine.parse()", () => {
  it("returns an Expression for valid source", () => {
    const engine = createEngine();
    const expr = engine.parse("1 + 2");
    expect(expr).toBeDefined();
  });

  it("throws ExpressionError on syntax error", () => {
    const engine = createEngine();
    expect(() => engine.parse("1 +")).toThrow(ExpressionError);
  });

  it("ExpressionError.message equals errors[0].message", () => {
    const engine = createEngine();
    try {
      engine.parse("1 +");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      const err = e as ExpressionError;
      expect(err.message).toBe(err.errors[0].message);
    }
  });

  it("includes source location in parse errors", () => {
    const engine = createEngine();
    try {
      engine.parse("1 +");
      expect.fail("Should have thrown");
    } catch (e) {
      const err = e as ExpressionError;
      expect(err.errors[0].location?.source).toBe("1 +");
      expect(err.errors[0].location?.start.line).toBeGreaterThanOrEqual(1);
      expect(err.errors[0].location?.start.column).toBeGreaterThanOrEqual(1);
    }
  });

  it("populates cache as a side-effect", async () => {
    const cache = createCache();
    const engineA = createEngine({ cache });
    const engineB = createEngine({ cache, filters: { double: (v) => (v as number) * 2 } });

    engineA.parse("double(x)");
    // engineB evaluates the same string — cache hit means AST is reused
    const result = await engineB.evaluate("double(x)", { x: 5 });
    expect(result).toBe(10);
  });
});

// ── evaluate() — pre-parsed Expression ───────────────────────────────────────

describe("engine.evaluate() with pre-parsed Expression", () => {
  it("evaluates a pre-parsed Expression without re-parsing", async () => {
    const engine = createEngine();
    const expr = engine.parse("price * qty");
    const result = await engine.evaluate(expr, { price: 10, qty: 3 });
    expect(result).toBe(30);
  });

  it("evaluates a raw string expression", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("2 + 2")).toBe(4);
  });

  it("preserves the native type of the result", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("true")).toBe(true);
    expect(await engine.evaluate("42")).toBe(42);
    expect(await engine.evaluate("null")).toBeNull();
  });

  it("resolves identifiers from context", async () => {
    const engine = createEngine();
    const result = await engine.evaluate("x + y", { x: 3, y: 4 });
    expect(result).toBe(7);
  });

  it("absent context keys evaluate to null", async () => {
    const engine = createEngine({ strict: false });
    expect(await engine.evaluate("missing")).toBeNull();
    await expect(createEngine().evaluate("missing")).rejects.toThrow("Unknown name 'missing'");
  });

  it("throws ExpressionError on syntax error in raw string", async () => {
    const engine = createEngine();
    await expect(engine.evaluate("1 +")).rejects.toThrow(ExpressionError);
  });

  it("throws ExpressionError on runtime error", async () => {
    const engine = createEngine();
    await expect(engine.evaluate("obj.prop", { obj: null })).rejects.toThrow(ExpressionError);
  });

  it("custom filters are callable", async () => {
    const engine = createEngine({
      filters: { double: (v) => (v as number) * 2 },
    });
    expect(await engine.evaluate("double(x)", { x: 6 })).toBe(12);
  });

  it("pipe syntax works with custom filters", async () => {
    const engine = createEngine({
      filters: { inc: (v) => (v as number) + 1 },
    });
    expect(await engine.evaluate("x | inc", { x: 9 })).toBe(10);
  });

  it("a qualified name calls a filter whose short name is taken", async () => {
    const engine = createEngine({
      filters: {
        get: () => "builtin",
        "connection.get": () => "action",
      },
    });
    // The short name stays the built-in; the qualified name is the way through.
    expect(await engine.evaluate("get()")).toBe("builtin");
    expect(await engine.evaluate("connection.get()")).toBe("action");
  });

  it("a qualified name works through the pipe too", async () => {
    const engine = createEngine({ filters: { "connection.list": (v) => [v] } });
    expect(await engine.evaluate("x | connection.list", { x: 7 })).toEqual([7]);
  });
});

// ── evaluate() — cache behaviour ─────────────────────────────────────────────

describe("engine.evaluate() cache behaviour", () => {
  it("parse() and subsequent evaluate() share the same cache entry", async () => {
    const engine = createEngine({ filters: { sq: (v) => (v as number) ** 2 } });
    engine.parse("sq(n)"); // populates cache
    const result = await engine.evaluate("sq(n)", { n: 7 }); // cache hit
    expect(result).toBe(49);
  });

  it("shared cache is hit across derived engines", async () => {
    const cache = createCache();
    const base = createEngine({ cache });
    const child = base.derive({ filters: { neg: (v) => -(v as number) } });

    // base parses, child evaluates — should hit the shared cache
    base.parse("neg(x)");
    expect(await child.evaluate("neg(x)", { x: 5 })).toBe(-5);
  });
});

// ── render() ─────────────────────────────────────────────────────────────────

describe("engine.render()", () => {
  it("returns string even for a single-span template", async () => {
    const engine = createEngine();
    const result = await engine.render("${{ 42 }}");
    expect(result).toBe("42");
    expect(typeof result).toBe("string");
  });

  it("renders multiple spans with literal text", async () => {
    const engine = createEngine();
    const result = await engine.render(
      "Hello ${{ name }}, you have ${{ count }} items",
      { name: "Alice", count: 3 },
    );
    expect(result).toBe("Hello Alice, you have 3 items");
  });

  it("renders a template with no spans as plain text", async () => {
    const engine = createEngine();
    expect(await engine.render("no expressions here")).toBe(
      "no expressions here",
    );
  });

  it("renders $\\{{ escape as literal ${{", async () => {
    const engine = createEngine();
    const result = await engine.render(String.raw`prefix $\{{ not a span`);
    expect(result).toBe("prefix ${{ not a span");
  });

  it("null value stringifies to empty string", async () => {
    const engine = createEngine();
    expect(await engine.render("[${{ null }}]")).toBe("[]");
  });

  it("boolean values stringify to true/false", async () => {
    const engine = createEngine();
    expect(await engine.render("${{ true }} / ${{ false }}")).toBe("true / false");
  });

  it("array value stringifies to JSON", async () => {
    const engine = createEngine();
    expect(await engine.render("${{ arr }}", { arr: [1, 2, 3] })).toBe("[1,2,3]");
  });

  it("object value stringifies to JSON", async () => {
    const engine = createEngine();
    expect(await engine.render("${{ obj }}", { obj: { a: 1 } })).toBe('{"a":1}');
  });

  it("throws ExpressionError with template position when span errors", async () => {
    const engine = createEngine();
    try {
      await engine.render("before ${{ 1 + }} after");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      const err = e as ExpressionError;
      expect(err.errors[0].location?.source).toBe("before ${{ 1 + }} after");
      expect(err.errors[0].location?.start.line).toBe(1);
    }
  });

  it("renders an Instant as ISO 8601 UTC string", async () => {
    const engine = createEngine();
    const result = await engine.render("${{ instant(\"2024-03-15T10:30:00Z\") }}");
    expect(result).toBe("2024-03-15T10:30:00Z");
  });

  it("renders a PlainDate as ISO date string", async () => {
    const engine = createEngine();
    const result = await engine.render("${{ plainDate(\"2024-03-15\") }}");
    expect(result).toBe("2024-03-15");
  });

  it("renders a PlainTime as ISO time string", async () => {
    const engine = createEngine();
    const result = await engine.render("${{ toPlainTime(\"14:30:00\") }}");
    expect(result).toBe("14:30:00");
  });

  it("renders a PlainDateTime as ISO datetime string", async () => {
    const engine = createEngine();
    const result = await engine.render(
      "${{ parsePlainDateTime(\"2024-03-15 10:30:00\", \"yyyy-MM-dd HH:mm:ss\") }}",
    );
    expect(result).toBe("2024-03-15T10:30:00");
  });

  it("renders a Duration as ISO duration string", async () => {
    const engine = createEngine();
    const result = await engine.render("${{ duration(\"P3D\") }}");
    expect(result).toBe("P3D");
  });

  it("renders a ZonedDateTime as ISO zoned string", async () => {
    const engine = createEngine();
    const result = await engine.render(
      "${{ instant(\"2024-01-01T00:00:00Z\") | toZonedDateTime(\"UTC\") }}",
    );
    expect(result).toContain("2024-01-01");
  });
});

// ── renderObject() ───────────────────────────────────────────────────────────

describe("engine.renderObject()", () => {
  it("compiles and evaluates a value template through the public API", async () => {
    const eng = createEngine();
    const template = eng.parse({ title: "${{ name }}", "$if": "${{ visible }}" });
    expect(await eng.evaluate(template, { name: "Hello", visible: true })).toEqual({ title: "Hello" });
    expect(await eng.evaluate(template, { name: "Hello", visible: false })).toBeNull();
  });

  it("keeps a date wrapper as a leaf to a value-tree walk", async () => {
    const eng = createEngine();
    const at = await eng.evaluate("instant('2024-03-15T10:30:00Z')");
    // A value tree is re-evaluated on its host's terms; walking the wrapper by its
    // properties would rebuild it as a plain object (its `Temporal.Instant` has no
    // enumerable ones, so `_inner` would collapse to `{}`).
    const out = (await eng.evaluate(eng.parse({ at }), {})) as { at: Value };
    expect(out.at).toBe(at);
    expect(await eng.evaluate("type(x.at)", { x: out })).toBe("instant");
  });

  it("rejects malformed value-template guards while compiling", () => {
    const eng = createEngine();
    expect(() => eng.parse({ "$if": "not ${{ a }}", title: "x" })).toThrow(
      /\$if \/ \$unless must be a boolean/,
    );
  });

  it("rejects an unconsumed hole while compiling", () => {
    const eng = createEngine();
    expect(() => eng.parse({ children: "${{ items }}", _: { type: "Row" } })).toThrow(
      /`_` body has no sibling expression span that references `_`/,
    );
  });

  it("rejects an invalid expression in an object key while compiling", () => {
    const eng = createEngine();
    expect(() => eng.parse({ "${{ ( }}": 1 })).toThrow(ExpressionError);
  });

  it("renders a templated object key", async () => {
    const eng = createEngine();
    expect(await eng.evaluate(eng.parse({ "id_${{ id }}": "${{ name }}" }), { id: 7, name: "x" })).toEqual({ id_7: "x" });
  });

  it("rejects block tags inside a `_` body while compiling", () => {
    const eng = createEngine();
    expect(() => eng.parse({ rows: "${{ map(xs, x => _) }}", _: { t: "${% if x %}y${% endif %}" } })).toThrow(
      /block tags are not supported inside a `_` body/,
    );
  });

  it("renders a templated key inside a `_` body, rejects block tags in it", async () => {
    const eng = createEngine();
    expect(await eng.evaluate(eng.parse({ rows: "${{ map(xs, x => _) }}", _: { "k${{ x }}": 1 } }), { xs: [1, 2] }))
      .toEqual({ rows: [{ k1: 1 }, { k2: 1 }] });
    expect(() => eng.parse({ rows: "${{ map(xs, x => _) }}", _: { "${% if x %}k${% endif %}": 1 } })).toThrow(
      /block tags are not supported inside a `_` body/,
    );
  });

  it("reports the path of an invalid key, including the key", () => {
    const eng = createEngine();
    try {
      eng.parse({ a: { "${{ ( }}": 1 } });
      expect.fail("Should have thrown");
    } catch (e) {
      expect((e as ExpressionError).errors[0].path).toEqual(["a", "${{ ( }}"]);
      expect((e as ExpressionError).errors[0].message).toBe("Unexpected end of expression");
    }
  });

  it("rejects a guard that is neither a boolean nor a single span", () => {
    const eng = createEngine();
    expect(() => eng.parse({ a: { $if: 1, b: 2 } })).toThrow(/\$if \/ \$unless must be a boolean literal/);
  });

  it("treats NaN as falsy in $if, ternaries and block tags", async () => {
    const eng = createEngine();
    const nan = { n: Number.NaN };
    expect(await eng.evaluate(eng.parse({ "$if": "${{ n }}", a: 1 }), nan)).toBeNull();
    expect(await eng.evaluate("n ? 'yes' : 'no'", nan)).toBe("no");
    expect(await eng.render("${% if n %}yes${% else %}no${% endif %}", nan)).toBe("no");
  });

  it("reports the path of the failing node", () => {
    const eng = createEngine();
    try {
      eng.parse({ a: { rows: ["ok", "${{ ( }}"] } });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      expect((e as ExpressionError).errors[0].path).toEqual(["a", "rows", 1]);
    }
  });

  it("reports a structural error at its host mapping", () => {
    const eng = createEngine();
    try {
      eng.parse({ a: { children: "${{ items }}", _: { type: "Row" } } });
      expect.fail("Should have thrown");
    } catch (e) {
      expect((e as ExpressionError).errors[0].path).toEqual(["a"]);
    }
  });

  it("memoises parseValueTemplate on tree identity, shared with derived engines", () => {
    const eng = createEngine();
    const tree = { title: "${{ name }}" };
    expect(eng.parseValueTemplate(tree)).toBe(eng.derive().parseValueTemplate(tree));
    expect(eng.parseValueTemplate({ title: "${{ name }}" })).not.toBe(eng.parseValueTemplate(tree));
    expect(eng.parseTextTemplate("a ${{ b }}")).toBe(eng.derive().parseTextTemplate("a ${{ b }}"));
  });

  it("flags a template of literals as static", () => {
    const eng = createEngine();
    for (const tree of [1, null, "plain", [1, "a", [true]], { a: 1, b: { c: ["x"] } }, {}, []]) {
      expect(eng.parseValueTemplate(tree).isStatic).toBe(true);
    }
    for (const tree of ["${{ x }}", "a ${{ x }}", ["${{ x }}"], { a: { b: "${{ x }}" } }, { "${{ k }}": 1 }, { $if: true, a: 1 }, { ...{ "...": { a: 1 } } }]) {
      expect(eng.parseValueTemplate(tree).isStatic).toBe(false);
    }
  });

  it("reports identity-cache reuse separately from fresh output trees", () => {
    const cache = createCache();
    const eng = createEngine({ cache });
    const rendererTree = {
      type: "Card",
      props: { title: "${{ item.title }}" },
      children: [{ type: "Text", props: { text: "${{ item.body }}" } }],
    };

    for (let i = 0; i < 50; i++) eng.parseValueTemplate(rendererTree);
    expect(cache.metrics().valueTemplates).toEqual({ hits: 49, misses: 1 });

    cache.resetMetrics();
    for (let i = 0; i < 50; i++) {
      eng.parseValueTemplate({ type: "Text", props: { text: "${{ item.title }}" } });
    }
    expect(cache.metrics().valueTemplates).toEqual({ hits: 0, misses: 50 });
    expect(cache.metrics().textTemplates.hits).toBeGreaterThan(0);
  });

  it("compiles a fresh tree from the memoised text of its strings and keys", () => {
    const eng = createEngine();
    const leaf = (template: ValueTemplate) => {
      const root = template._root;
      if (root.kind !== "object" || root.parts[0].kind !== "entry" || root.parts[0].value.kind !== "expression") {
        throw new Error("expected an expression entry");
      }
      return root.parts[0].value.node;
    };
    expect(leaf(eng.parse({ a: "${{ x + 1 }}" }))).toBe(leaf(eng.parseValueTemplate({ a: "${{ x + 1 }}" })));
    expect(eng.parseTextTemplate("${{ x + 1 }}").nodes[0]).toMatchObject({ node: leaf(eng.parse({ a: "${{ x + 1 }}" })) });
    expect(eng.parse(" x + 1 ")._node).toBe(leaf(eng.parse({ a: "${{ x + 1 }}" })));
  });

  it("shares one cache between engines created with it", () => {
    const cache = createCache();
    const a = createEngine({ cache });
    const b = createEngine({ cache, filters: { f: () => 1 } });
    expect(a.parseTextTemplate("${{ f() }}")).toBe(b.parseTextTemplate("${{ f() }}"));
    expect(createEngine().parseTextTemplate("${{ f() }}")).not.toBe(a.parseTextTemplate("${{ f() }}"));
  });

  it("rejects a spread hole host while compiling", () => {
    const eng = createEngine();
    expect(() => eng.parse({ "...": "${{ items | map(x => _) }}", _: { type: "Row" } })).toThrow(
      /"\.\.\." host with a `_` body is not supported/,
    );
  });

  it("rejects malformed $_ hosts while compiling", () => {
    const eng = createEngine();
    expect(() => eng.parse({ "$_": "${{ items }}", _: { type: "Row" } })).toThrow(
      /`\$_` must be a single expression span that references `_`/,
    );
  });

  it("parses and evaluates a value template", async () => {
    const eng = createEngine();
    const template = eng.parse({ title: "Hello ${{ name }}" });
    expect(await eng.renderObject(template, { name: "Ada" })).toEqual({ title: "Hello Ada" });
    expect(await eng.renderObject({ title: "${{ name }}" }, { name: "Ada" })).toEqual({ title: "Ada" });
  });

  it("returns a plain string unchanged (no spans)", async () => {
    const eng = createEngine();
    expect(await eng.renderObject("hello")).toBe("hello");
  });

  it("renders a string containing a span", async () => {
    const eng = createEngine();
    expect(await eng.renderObject("${{ name }}", { name: "world" })).toBe("world");
  });

  it("returns a number unchanged", async () => {
    const eng = createEngine();
    expect(await eng.renderObject(42)).toBe(42);
  });

  it("returns a boolean unchanged", async () => {
    const eng = createEngine();
    expect(await eng.renderObject(false)).toBe(false);
  });

  it("returns null unchanged", async () => {
    const eng = createEngine();
    expect(await eng.renderObject(null)).toBeNull();
  });

  it("recurses into array elements", async () => {
    const eng = createEngine();
    expect(await eng.renderObject(["${{ x }}", 42, null], { x: "hi" })).toEqual(["hi", 42, null]);
  });

  it("recurses into nested object values", async () => {
    const eng = createEngine();
    expect(await eng.renderObject({ key: "${{ v }}" }, { v: "rendered" })).toEqual({ key: "rendered" });
  });

  it("omits object keys whose template expression evaluates to null", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { present: "yes", missing: "${{ absent }}" },
      { absent: null },
    );
    expect(result).toEqual({ present: "yes" });
  });

  it("preserves object keys with literal null value", async () => {
    const eng = createEngine();
    const result = await eng.renderObject({ a: 1, b: null });
    expect(result).toEqual({ a: 1, b: null });
  });

  it("recurses deeply through arrays and objects", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { nested: { list: ["${{ x }}"] } },
      { x: "deep" },
    );
    expect(result).toEqual({ nested: { list: ["deep"] } });
  });

  it("renders template strings used as object keys", async () => {
    const eng = createEngine();
    const result = await eng.renderObject({ "${{ k }}": "value" }, { k: "myKey" });
    expect(result).toEqual({ myKey: "value" });
  });

  it("array spread: { '...': expr } where expr evaluates to array — spreads elements", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      [1, { "...": "${{ extras }}" }, 2],
      { extras: [3, 4] },
    );
    expect(result).toEqual([1, 3, 4, 2]);
  });

  it("array spread: a non-array non-null spread value is an error at its path", async () => {
    const eng = createEngine();
    const error = await eng.renderObject({ list: [1, { "...": "${{ extra }}" }] }, { extra: "x" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(ExpressionError);
    expect((error as ExpressionError).errors[0]).toMatchObject({
      message: "Array spread requires an array, got string",
      path: ["list", 1, "..."],
    });
  });

  it("object spread: a non-object non-null spread value is an error at its path", async () => {
    const eng = createEngine();
    const error = await eng.renderObject({ o: { "...": "${{ extra }}" } }, { extra: [1] }).catch((e: Error) => e);
    expect((error as ExpressionError).errors[0]).toMatchObject({
      message: "Object spread requires a plain object, got array",
      path: ["o", "..."],
    });
  });

  it("a `$_` host in an array contributes a non-array value as one element", async () => {
    const eng = createEngine();
    const tree = [0, { $_: "${{ first(map(xs, x => _)) }}", _: { v: "${{ x }}" } }];
    expect(await eng.renderObject(tree, { xs: [1, 2] })).toEqual([0, { v: 1 }]);
    expect(await eng.renderObject({ rows: "${{ ys | map(y => _) }}", _: tree }, { xs: [1], ys: [0] }))
      .toEqual({ rows: [[0, { v: 1 }]] });
  });

  it("array spread: null spread value is dropped", async () => {
    const eng = createEngine();
    const result = await eng.renderObject([1, { "...": "${{ null }}" }]);
    expect(result).toEqual([1]);
  });

  it("object spread: '...' key merges a rendered object into the result", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { a: 1, "...": "${{ extras }}" },
      { extras: { b: 2, c: 3 } },
    );
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("object spread: non-object spread value is silently ignored", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { a: 1, "...": "${{ null }}" },
    );
    expect(result).toEqual({ a: 1 });
  });
});

// ── renderObject(): $if / $unless node guards ────────────────────────────────

describe("engine.renderObject() — $if / $unless guards", () => {
  it("keeps a mapping whose $if is truthy, stripping the guard key", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { "$if": "${{ show }}", type: "Card" },
      { show: true },
    );
    expect(result).toEqual({ type: "Card" });
  });

  it("drops an object value whose $if is falsy (key omitted)", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { header: { "$if": "${{ show }}", type: "Card" }, body: "x" },
      { show: false },
    );
    expect(result).toEqual({ body: "x" });
  });

  it("removes an array element whose $if is falsy", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      [
        { type: "A" },
        { "$if": "${{ show }}", type: "B" },
        { type: "C" },
      ],
      { show: false },
    );
    expect(result).toEqual([{ type: "A" }, { type: "C" }]);
  });

  it("$unless removes the node when its condition is truthy", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      [{ "$unless": "${{ hide }}", type: "B" }],
      { hide: true },
    );
    expect(result).toEqual([]);
  });

  it("$if and $unless combine — kept only when if && !unless", async () => {
    const eng = createEngine();
    const tpl = { "$if": "${{ a }}", "$unless": "${{ b }}", type: "X" };
    expect(await eng.renderObject(tpl, { a: true, b: false })).toEqual({ type: "X" });
    expect(await eng.renderObject(tpl, { a: true, b: true })).toBeNull();
    expect(await eng.renderObject(tpl, { a: false, b: false })).toBeNull();
  });

  it("accepts a literal boolean guard", async () => {
    const eng = createEngine();
    expect(await eng.renderObject({ "$if": false, type: "X" })).toBeNull();
    expect(await eng.renderObject({ "$if": true, type: "X" })).toEqual({ type: "X" });
  });

  it("guard on a spread element removes the spread on a failed guard", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      [1, { "$if": "${{ show }}", "...": "${{ extras }}" }, 9],
      { show: false, extras: [2, 3] },
    );
    expect(result).toEqual([1, 9]);
  });

  it("rejects a multi-span guard value", async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject({ "$if": "a ${{ x }} b", type: "X" }, { x: 1 }),
    ).rejects.toThrow(/\$if \/ \$unless must be a boolean/);
  });
});

// ── renderObject(): the `_` body hole ───────────────────────────────────────

describe("engine.renderObject() — `_` body hole", () => {
  it("splices the body into a map() callback, binding the loop variable", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        children: "${{ items | map(t => _) }}",
        _: { type: "Row", props: { text: "${{ t.name }}" } },
      },
      { items: [{ name: "a" }, { name: "b" }] },
    );
    expect(result).toEqual({
      children: [
        { type: "Row", props: { text: "a" } },
        { type: "Row", props: { text: "b" } },
      ],
    });
  });

  it("works on a `$_` host key — result is spliced into the parent array", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      [
        { type: "Searchbar" },
        {
          $_: "${{ items | map(t => _) }}",
          _: { type: "Item", key: "row-${{ t.id }}" },
        },
      ],
      { items: [{ id: 1 }, { id: 2 }] },
    );
    expect(result).toEqual([
      { type: "Searchbar" },
      { type: "Item", key: "row-1" },
      { type: "Item", key: "row-2" },
    ]);
  });

  it("supports reduce() with an explicit accumulator and a list body", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        children: "${{ items | reduce((acc, t) => _, []) }}",
        _: [
          { "...": "${{ acc }}" },
          { type: "Item", props: { n: "${{ t }}" } },
        ],
      },
      { items: [1, 2] },
    );
    expect(result).toEqual({
      children: [
        { type: "Item", props: { n: 1 } },
        { type: "Item", props: { n: 2 } },
      ],
    });
  });

  it("honours a nested $if inside a single-node body (guard sees `t`)", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        children: "${{ items | map(t => _) | compact }}",
        _: {
          "$if": "${{ t.show }}",
          type: "Item",
          props: { name: "${{ t.name }}" },
        },
      },
      { items: [{ name: "a", show: true }, { name: "b", show: false }] },
    );
    expect(result).toEqual({
      children: [{ type: "Item", props: { name: "a" } }],
    });
  });

  it("flatMap + a multi-node list body (many nodes per row)", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        children: "${{ groups | flatMap(g => _) }}",
        _: [
          { type: "Header", props: { title: "${{ g.name }}" } },
          { type: "Divider" },
        ],
      },
      { groups: [{ name: "A" }, { name: "B" }] },
    );
    expect(result).toEqual({
      children: [
        { type: "Header", props: { title: "A" } },
        { type: "Divider" },
        { type: "Header", props: { title: "B" } },
        { type: "Divider" },
      ],
    });
  });

  it("`$_` host whose hole sits in a nested lambda — every enclosing variable is in scope", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        result: {
          $_: "${{ flatMap(rows, l => ((l.details ?? []) | filter(d => d.mark != null) | map(d => _))) }}",
          _: {
            id: "${{ d.id }}",
            subject: "${{ l.subject ?? '' }}",
            attended: "${{ d.mark == 1 }}",
          },
        },
      },
      {
        rows: [
          {
            subject: "Vocals",
            details: [{ id: 1, mark: 1 }, { id: 2, mark: null }, { id: 3, mark: 0 }],
          },
          { subject: null, details: null },
        ],
      },
    );
    expect(result).toEqual({
      result: [
        { id: 1, subject: "Vocals", attended: true },
        { id: 3, subject: "Vocals", attended: false },
      ],
    });
  });

  it("reduce + a $if that inspects the accumulator (group-header pattern)", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        children: "${{ rows | reduce((acc, t) => _, []) }}",
        _: [
          { "...": "${{ acc }}" },
          {
            "$if": "${{ (acc | last)?.group != t.group }}",
            type: "SectionHeader",
            group: "${{ t.group }}",
            props: { title: "${{ t.group }}" },
          },
          { type: "Item", group: "${{ t.group }}", props: { name: "${{ t.name }}" } },
        ],
      },
      {
        rows: [
          { group: "G1", name: "a" },
          { group: "G1", name: "b" },
          { group: "G2", name: "c" },
        ],
      },
    );
    expect(result).toEqual({
      children: [
        { type: "SectionHeader", group: "G1", props: { title: "G1" } },
        { type: "Item", group: "G1", props: { name: "a" } },
        { type: "Item", group: "G1", props: { name: "b" } },
        { type: "SectionHeader", group: "G2", props: { title: "G2" } },
        { type: "Item", group: "G2", props: { name: "c" } },
      ],
    });
  });

  it("one-shot transform (no loop) — body spliced at the bare `_`", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        card: "${{ user != null ? _ : null }}",
        _: { type: "Card", props: { title: "${{ user.name }}" } },
      },
      { user: { name: "Ann" } },
    );
    expect(result).toEqual({ card: { type: "Card", props: { title: "Ann" } } });
  });

  it("throws when the `_` body has no sibling expression that references `_`", async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject({ children: "${{ items }}", _: { type: "Row" } }, { items: [] }),
    ).rejects.toThrow(/no sibling .* references `_`/);
  });

  it("rejects block tags inside a `_` body", async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        { children: "${{ items | map(t => _) }}", _: { x: "${% if t %}y${% endif %}" } },
        { items: [1] },
      ),
    ).rejects.toThrow(/block tags/);
  });

  it("keeps an array element whose $if is truthy (guard stripped)", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      [{ "$if": "${{ ok }}", type: "B" }],
      { ok: true },
    );
    expect(result).toEqual([{ type: "B" }]);
  });

  it("spread element whose inner value is itself guarded away is dropped", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      [1, { "...": { "$if": "${{ false }}", type: "X" } }, 2],
    );
    expect(result).toEqual([1, 2]);
  });

  it("`_` host on a plain key, with extra siblings rendered normally", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        rows: "${{ items | map(t => _) }}",
        title: "${{ heading }}",
        missing: "${{ absent }}",
        "...": "${{ extra }}",
        _: { label: "${{ t }}" },
      },
      { items: ["a"], heading: "H", absent: null, extra: { flag: true } },
    );
    expect(result).toEqual({ rows: [{ label: "a" }], title: "H", flag: true });
  });

  it("body leaves: literal number/bool/null and text+span keys", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        rows: "${{ items | map(t => _) }}",
        _: {
          key: "row-${{ t.id }}-x",
          count: 3,
          active: true,
          note: null,
          label: "static",
        },
      },
      { items: [{ id: 7 }] },
    );
    expect(result).toEqual({
      rows: [{ key: "row-7-x", count: 3, active: true, note: null, label: "static" }],
    });
  });

  it("empty `_:` list body yields an empty array per iteration", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { rows: "${{ items | flatMap(t => _) }}", _: [] },
      { items: [1, 2] },
    );
    expect(result).toEqual({ rows: [] });
  });

  it('object spread inside a `_` body merges the source object', async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { rows: "${{ items | map(t => _) }}", _: { "...": "${{ t }}", type: "X" } },
      { items: [{ a: 1 }, { a: 2, b: 3 }] },
    );
    expect(result).toEqual({
      rows: [
        { a: 1, type: "X" },
        { a: 2, b: 3, type: "X" },
      ],
    });
  });

  it('object spread inside a `_` body: order decides the override', async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        rows: "${{ items | map(t => _) }}",
        _: { type: "Before", "...": "${{ t }}", label: "After" },
      },
      { items: [{ type: "FromSpread", label: "FromSpread" }] },
    );
    // The spread is evaluated in key order: it overrides the key written before
    // it and is overridden by the one written after.
    expect(result).toEqual({ rows: [{ type: "FromSpread", label: "After" }] });
  });

  it('a spread-only `_` body evaluates to the source object', async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { rows: "${{ items | map(t => _) }}", _: { "...": "${{ t }}" } },
      { items: [{ a: 1 }] },
    );
    expect(result).toEqual({ rows: [{ a: 1 }] });
  });

  it('a null spread value inside a `_` body contributes nothing', async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      { rows: "${{ items | map(t => _) }}", _: { "...": "${{ t.missing ?? null }}", type: "X" } },
      { items: [{}] },
    );
    expect(result).toEqual({ rows: [{ type: "X" }] });
  });

  it('a `$if` guard wins over a `_` body spread', async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        rows: "${{ items | map(t => _) }}",
        _: { "...": "${{ t }}", "$if": "${{ t.vip }}" },
      },
      { items: [{ vip: true, a: 1 }, { vip: false, a: 2 }] },
    );
    // The guard wraps the whole body, so a failing guard nulls the element.
    expect(result).toEqual({ rows: [{ vip: true, a: 1 }, null] });
  });

  it('a non-object spread value inside a `_` body is an error', async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        { rows: "${{ items | map(t => _) }}", _: { "...": "${{ t.n }}", type: "X" } },
        { items: [{ n: 5 }] },
      ),
    ).rejects.toThrow(/Object spread requires a plain object, got number/);
  });

  it('an array spread value inside a `_` body is an error', async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        { rows: "${{ items | map(t => _) }}", _: { "...": "${{ t.arr }}", type: "X" } },
        { items: [{ arr: [1, 2] }] },
      ),
    ).rejects.toThrow(/Object spread requires a plain object, got array/);
  });

  it('object spread inside a `_` body resolves through the async evaluator', async () => {
    const eng = createEngine();
    const store: Record<string, unknown> = { rows: [{ a: 1 }] };
    const result = await eng.renderObject(
      { rows: "${{ data.rows | map(t => _) }}", _: { "...": "${{ t }}", type: "X" } },
      { data: resolve(async (key: string) => store[key] ?? null) },
    );
    expect(result).toEqual({ rows: [{ a: 1, type: "X" }] });
  });

  it('a null spread value resolves through the async evaluator too', async () => {
    const eng = createEngine();
    const store: Record<string, unknown> = { rows: [{}] };
    const result = await eng.renderObject(
      {
        rows: "${{ data.rows | map(t => _) }}",
        _: { "...": "${{ t.missing ?? null }}", type: "X" },
      },
      { data: resolve(async (key: string) => store[key] ?? null) },
    );
    expect(result).toEqual({ rows: [{ type: "X" }] });
  });

  it('a non-object spread value is an error on the async path too', async () => {
    const eng = createEngine();
    const store: Record<string, unknown> = { rows: [{ n: 5 }] };
    await expect(
      eng.renderObject(
        { rows: "${{ data.rows | map(t => _) }}", _: { "...": "${{ t.n }}", type: "X" } },
        { data: resolve(async (key: string) => store[key] ?? null) },
      ),
    ).rejects.toThrow(/Object spread requires a plain object, got number/);
  });

  it('a function value cannot be spread into a `_` body', async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        { rows: "${{ items | map(t => _) }}", _: { "...": "${{ map }}" } },
        { items: [{}] },
      ),
    ).rejects.toThrow(/Object spread requires a plain object, got function/);
  });

  it('a date value cannot be spread into a `_` body', async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        { rows: "${{ items | map(t => _) }}", _: { "...": "${{ now() }}" } },
        { items: [{}] },
      ),
    ).rejects.toThrow(/Object spread requires a plain object, got instant/);
  });

  it('a lazy context root cannot be spread into a `_` body', async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        { rows: "${{ data.rows | map(t => _) }}", _: { "...": "${{ data }}" } },
        { data: resolve(async () => [{}]) },
      ),
    ).rejects.toThrow(/Object spread requires a plain object, got resolver/);
  });

  it("nested object value carrying a $if inside the body → node or omitted key", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        rows: "${{ items | map(t => _) }}",
        _: {
          type: "Row",
          badge: { "$if": "${{ t.vip }}", type: "Badge" },
        },
      },
      { items: [{ vip: true }, { vip: false }] },
    );
    expect(result).toEqual({
      rows: [
        { type: "Row", badge: { type: "Badge" } },
        { type: "Row" },
      ],
    });
  });

  it("nested `_` hole inside a `_` body", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        sections: "${{ groups | map(g => _) }}",
        _: {
          type: "Section",
          title: "${{ g.name }}",
          items: "${{ g.rows | map(r => _) }}",
          _: { type: "Row", text: "${{ r }}" },
        },
      },
      { groups: [{ name: "A", rows: ["x", "y"] }] },
    );
    expect(result).toEqual({
      sections: [
        {
          type: "Section",
          title: "A",
          items: [{ type: "Row", text: "x" }, { type: "Row", text: "y" }],
        },
      ],
    });
  });

  it("$unless-only and $if+$unless guards inside a `_` body", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        rows: "${{ items | flatMap(t => _) }}",
        _: [
          { "$unless": "${{ t.hide }}", type: "Visible" },
          { "$if": "${{ t.a }}", "$unless": "${{ t.b }}", type: "Both" },
        ],
      },
      { items: [{ hide: false, a: true, b: false }, { hide: true, a: true, b: true }] },
    );
    expect(result).toEqual({ rows: [{ type: "Visible" }, { type: "Both" }] });
  });

  it("list-position `- $_: … / _:` hole inside a flatMap body", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        children: "${{ groups | flatMap(g => _) }}",
        _: [
          { type: "Header", props: { title: "${{ g.name }}" } },
          { $_: "${{ g.rows | map(r => _) }}", _: { type: "Row", text: "${{ r }}" } },
        ],
      },
      { groups: [{ name: "A", rows: ["x", "y"] }] },
    );
    expect(result).toEqual({
      children: [
        { type: "Header", props: { title: "A" } },
        { type: "Row", text: "x" },
        { type: "Row", text: "y" },
      ],
    });
  });

  it("nested `_` hole with a non-host sibling that references no `_`", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        sections: "${{ groups | map(g => _) }}",
        _: {
          type: "Section",
          count: "${{ size(g.rows) }}",
          items: "${{ g.rows | map(r => _) }}",
          _: { type: "Row", text: "${{ r }}" },
        },
      },
      { groups: [{ rows: ["x"] }] },
    );
    expect(result).toEqual({
      sections: [{ type: "Section", count: 1, items: [{ type: "Row", text: "x" }] }],
    });
  });

  it("`_` reachable through array / object / index-key literal nodes", async () => {
    const eng = createEngine();
    const viaArray = await eng.renderObject(
      { card: "${{ [_] | first }}", _: { type: "X" } },
      {},
    );
    expect(viaArray).toEqual({ card: { type: "X" } });

    const viaIndexKey = await eng.renderObject(
      { pick: '${{ ["a", "b", "c"][_] }}', _: 1 },
      {},
    );
    expect(viaIndexKey).toEqual({ pick: "b" });
  });

  it("`_` reachable through member / binary / unary / let / index / pipe nodes", async () => {
    const eng = createEngine();
    const oneShot = await eng.renderObject(
      {
        card: "${{ _ != null && !(_.hidden) ? _ : null }}",
        _: { hidden: false, type: "Card" },
      },
      {},
    );
    expect(oneShot).toEqual({ card: { hidden: false, type: "Card" } });

    const viaLetIndex = await eng.renderObject(
      {
        first: "${{ let arr = (items | map(t => _)) in arr[0] }}",
        _: { type: "Row", n: "${{ t }}" },
      },
      { items: [1, 2] },
    );
    expect(viaLetIndex).toEqual({ first: { type: "Row", n: 1 } });
  });

  it("`_` reachable as a unary operand, a call arg, and inside an object literal", async () => {
    const eng = createEngine();
    expect(await eng.renderObject({ v: "${{ -(_) }}", _: 5 }, {})).toEqual({ v: -5 });
    expect(await eng.renderObject({ v: "${{ size(_) }}", _: [1, 2, 3] }, {})).toEqual({
      v: 3,
    });
    expect(await eng.renderObject({ v: '${{ { "x": _ } }}', _: 7 }, {})).toEqual({
      v: { x: 7 },
    });
  });

  it("`$_` host resolving to a non-array value is pushed as one element", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      [{ $_: "${{ keep ? _ : null }}", _: { type: "Solo" } }],
      { keep: true },
    );
    expect(result).toEqual([{ type: "Solo" }]);
  });

  it("`_` mapping with a guarded sibling (dropped) and a non-string sibling", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        rows: "${{ items | map(t => _) }}",
        gone: { "$if": "${{ false }}", type: "X" },
        n: 4,
        _: { label: "${{ t }}" },
      },
      { items: ["a"] },
    );
    expect(result).toEqual({ rows: [{ label: "a" }], n: 4 });
  });

  it("literal-boolean and bad guards inside a `_` body", async () => {
    const eng = createEngine();
    const ok = await eng.renderObject(
      { rows: "${{ items | flatMap(t => _) }}", _: [{ "$if": true, type: "Always" }] },
      { items: [1, 2] },
    );
    expect(ok).toEqual({ rows: [{ type: "Always" }, { type: "Always" }] });

    await expect(
      eng.renderObject(
        { rows: "${{ items | map(t => _) }}", _: { "$if": "plain", type: "X" } },
        { items: [1] },
      ),
    ).rejects.toThrow(/\$if \/ \$unless must be a boolean/);
  });

  it("nested `_` body with no consuming sibling throws", async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        {
          sections: "${{ groups | map(g => _) }}",
          _: { type: "Section", items: "${{ g.rows }}", _: { type: "Row" } },
        },
        { groups: [{ rows: [] }] },
      ),
    ).rejects.toThrow(/nested `_` body has no sibling/);
  });

  it("a `$_` host that is not a single expression span throws", async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        {
          children: "${{ items | flatMap(t => _) }}",
          _: [{ $_: "x ${{ t }} y", _: { type: "Row" } }],
        },
        { items: [1] },
      ),
    ).rejects.toThrow(/`\$_` must be a single expression span/);

    await expect(
      eng.renderObject({ $_: "${{ items }}", _: { type: "Row" } }, { items: [1] }),
    ).rejects.toThrow(/`\$_` must be a single expression span/);
  });

  it("a `\"...\"` host with a `_` body is rejected — `$_` replaced it", async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        [{ "...": "${{ items | map(t => _) }}", _: { type: "Row" } }],
        { items: [1] },
      ),
    ).rejects.toThrow(/use `\$_`/);
  });

  it("`$_` is the value of the mapping it sits in — no wrapper key", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        type: "ListSection",
        children: { $_: "${{ items | map(t => _) }}", _: { type: "Row", n: "${{ t }}" } },
      },
      { items: [1, 2] },
    );
    expect(result).toEqual({
      type: "ListSection",
      children: [
        { type: "Row", n: 1 },
        { type: "Row", n: 2 },
      ],
    });
  });

  it("`$_` unwraps a value without a subtree hole", async () => {
    const eng = createEngine();
    await expect(eng.renderObject({ value: { "$_": "${{ row.id }}" } }, { row: { id: 7 } }))
      .resolves.toEqual({ value: 7 });
    await expect(eng.renderObject([{ "$_": "${{ rows }}" }], { rows: [1, 2] }))
      .resolves.toEqual([1, 2]);
  });

  it("rejects a sibling next to `$_` without a subtree hole", async () => {
    const eng = createEngine();
    await expect(eng.renderObject(
      { value: { "$_": "${{ row.id }}", type: "Row" } },
      { row: { id: 7 } },
    )).rejects.toThrow(/`\$_` must be the only key in its mapping, got: type/);
  });

  it("`$_` unwraps a one-shot call — the body is the whole argument map", async () => {
    const eng = createEngine({
      filters: {
        card: (args: Value) => ({ ...(args as Record<string, Value>), type: "Card" }),
      },
    });
    const result = await eng.renderObject(
      {
        $_: "${{ card(_) }}",
        _: { id: "${{ row.id }}", title: "${{ row.name }}" },
      },
      { row: { id: 7, name: "a" } },
    );
    expect(result).toEqual({ id: 7, title: "a", type: "Card" });
  });

  it("`$_` with any other sibling throws — there is nowhere to put it", async () => {
    const eng = createEngine();
    await expect(
      eng.renderObject(
        { type: "Row", $_: "${{ items | map(t => _) }}", _: { n: "${{ t }}" } },
        { items: [1] },
      ),
    ).rejects.toThrow(/`\$_` must be the only sibling of its `_` body, got: type/);
  });

  it("nested `$_` inside a `_` body unwraps per row", async () => {
    const eng = createEngine();
    const result = await eng.renderObject(
      {
        sections: "${{ groups | map(g => _) }}",
        _: {
          type: "Section",
          rows: { $_: "${{ g.rows | map(r => _) }}", _: { type: "Row", text: "${{ r }}" } },
        },
      },
      { groups: [{ rows: ["x", "y"] }] },
    );
    expect(result).toEqual({
      sections: [
        {
          type: "Section",
          rows: [
            { type: "Row", text: "x" },
            { type: "Row", text: "y" },
          ],
        },
      ],
    });
  });
});

// A `_` body is walked by the same code as the rest of the tree, in its host's scope.
describe("engine.evaluate() — `_` body follows the tree rules", () => {
  const eng = createEngine();
  const row = { a: null, o: { k: 1 }, n: 5 };
  const run = (template: Value) => eng.evaluate(eng.parseValueTemplate(template), { row, rows: [row] });
  const inHole = (body: Value) => run({ v: "${{ rows | map(row => _) }}", _: body });
  const failure = (promise: Promise<Value>) => promise.then(
    () => expect.fail("Should have thrown"),
    (e: ExpressionError) => e.errors[0],
  );

  it("drops a key whose expression is null, keeps a literal null", async () => {
    expect(await run({ x: "${{ row.a }}", y: null })).toEqual({ y: null });
    expect(await inHole({ x: "${{ row.a }}", y: null })).toEqual({ v: [{ y: null }] });
  });

  it("JSON-encodes an object in text", async () => {
    expect(await run({ x: "o=${{ row.o }}" })).toEqual({ x: 'o={"k":1}' });
    expect(await inHole({ x: "o=${{ row.o }}" })).toEqual({ v: [{ x: 'o={"k":1}' }] });
  });

  it("rejects a non-object object spread at its path", async () => {
    expect(await failure(run({ o: { "...": "${{ row.n }}" } }))).toMatchObject({ path: ["o", "..."] });
    expect(await failure(inHole({ o: { "...": "${{ row.n }}" } }))).toMatchObject({
      message: "Object spread requires a plain object, got number",
      path: ["_", "o", "..."],
    });
  });

  it("rejects a scalar array spread at its path", async () => {
    expect(await failure(run(["${{ 0 }}", { "...": "${{ row.n }}" }]))).toMatchObject({ path: [1, "..."] });
    expect(await failure(inHole(["${{ 0 }}", { "...": "${{ row.n }}" }]))).toMatchObject({
      message: "Array spread requires an array, got number",
      path: ["_", 1, "..."],
    });
  });

  it("locates a runtime error at the failing expression and its path", async () => {
    expect(await failure(run({ a: { b: "${{ row.n | toUpperCase }}" } }))).toMatchObject({
      location: { source: " row.n | toUpperCase " },
      path: ["a", "b"],
    });
    expect(await failure(inHole({ x: "${{ row.n | toUpperCase }}" }))).toMatchObject({
      location: { source: " row.n | toUpperCase " },
      path: ["_", "x"],
    });
    expect(await failure(inHole({ x: "n=${{ row.n | toUpperCase }}" }))).toMatchObject({
      location: { source: " row.n | toUpperCase " },
      path: ["_", "x"],
    });
  });

  it("locates an error in a nested `_` body at the innermost path", async () => {
    const tree = { v: "${{ rows | map(r => _) }}", _: { w: "${{ [r] | map(s => _) }}", _: { x: "${{ s.n | toUpperCase }}" } } };
    expect(await failure(run(tree))).toMatchObject({ path: ["_", "_", "x"] });
  });

  it("walks a `_` body the same way under a lazy context root", async () => {
    const data = resolve(async (key) => (key === "rows" ? [{ n: 5, o: { k: 1 } }] : null));
    const body = { v: "${{ data.rows | map(r => _) }}", _: { t: "o=${{ r.o }}", u: "${{ r.nope ?? null }}" } };
    expect(await eng.evaluate(eng.parseValueTemplate(body), { data })).toEqual({ v: [{ t: 'o={"k":1}' }] });
    const failing = { v: "${{ data.rows | map(r => _) }}", _: { t: "n=${{ r.n | toUpperCase }}" } };
    expect(await failure(eng.evaluate(eng.parseValueTemplate(failing), { data }))).toMatchObject({
      location: { source: " r.n | toUpperCase " },
      path: ["_", "t"],
    });
  });

  it("locates an error thrown by a custom filter in a `_` body", async () => {
    const custom = createEngine({
      filters: {
        plain: () => { throw new Error("plain failure"); },
        tavnit: () => { throw new ExpressionError([{ message: "filter failure" }]); },
      },
    });
    const at = (span: string) => custom.evaluate(custom.parseValueTemplate({ v: "${{ [1] | map(i => _) }}", _: { t: `t=${span}` } }));
    expect(await failure(at("${{ plain() }}"))).toMatchObject({ message: "plain failure", location: { source: " plain() " }, path: ["_", "t"] });
    expect(await failure(at("${{ tavnit() }}"))).toMatchObject({ message: "filter failure", path: ["_", "t"] });
  });

  it("keeps a nested host's key", async () => {
    expect(await inHole({ items: "${{ [1] | map(i => _) }}", _: { i: "${{ i }}" } })).toEqual({ v: [{ items: [{ i: 1 }] }] });
  });
});

// ── timeoutMs ─────────────────────────────────────────────────────────────────

describe("derive overrides maxRegexInput", () => {
  it("validates and applies the override", async () => {
    const child = createEngine({ regex: "native" }).derive({ maxRegexInput: 5 });
    await expect(child.evaluate('matches("abcdefgh", "a")')).rejects.toThrow("longer than 5 characters");
    expect(() => createEngine().derive({ maxRegexInput: 0 })).toThrow(RangeError);
  });
});

describe("timeoutMs", () => {
  it("throws ExpressionError when timeoutMs is exceeded", async () => {
    // timeoutMs: -1 means elapsed > -1 is always true (elapsed >= 0)
    const engine = createEngine({ timeoutMs: -1 });
    await expect(engine.evaluate("1 + 2")).rejects.toThrow(ExpressionError);
    await expect(engine.evaluate("1 + 2")).rejects.toThrow(/timed out/i);
  });

  it("stops an async expression whose Resolver read overran the budget", async () => {
    const engine = createEngine({ timeoutMs: 20 });
    const slow = resolve(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return 1;
    });
    await expect(engine.evaluate("state.x + 1", { state: slow })).rejects.toThrow(/timed out/i);
  });

  it("stops an async expression whose awaited filter overran the budget", async () => {
    const engine = createEngine({
      timeoutMs: 20,
      filters: { slowId: async (v: Value) => { await new Promise((r) => setTimeout(r, 60)); return v; } },
    });
    const root = resolve(async () => 1);
    await expect(engine.evaluate("slowId(1)", { state: root })).rejects.toThrow(/timed out/i);
  });

  it("timeoutMs error wraps as ExpressionError", async () => {
    const engine = createEngine({ timeoutMs: -1 });
    try {
      await engine.evaluate("1");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      const err = e as ExpressionError;
      expect(err.errors[0].message).toMatch(/timed out/i);
      expect(err.message).toBe(err.errors[0].message);
    }
  });

  it("stops a synchronous expression that overruns after a slow filter", async () => {
    const slow = (v: Value): Value => {
      const until = Date.now() + 5;
      while (Date.now() < until) { /* busy */ }
      return v;
    };
    const engine = createEngine({ timeoutMs: 1, filters: { slow } });
    // More nodes after the filter than the sync path visits between two clock reads.
    const source = `[slow(0), ${Array.from({ length: 300 }, () => "1").join(", ")}]`;
    await expect(engine.evaluate(source)).rejects.toThrow(/timed out/i);
  });
});

// ── secretRoots ───────────────────────────────────────────────────────────────

describe("secretRoots", () => {
  it("does not expose secret root string values in error messages", async () => {
    const engine = createEngine({
      secretRoots: ["secrets"],
      filters: {
        failWithValue: (v: Value) => {
          throw new Error(`got: ${String(v)}`);
        },
      },
    });

    const secretValue = "supersecret_abc123";
    try {
      await engine.evaluate("failWithValue(secrets)", { secrets: secretValue });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      const err = e as ExpressionError;
      // The raw secret must not appear in any diagnostic message
      for (const diag of err.errors) {
        expect(diag.message).not.toContain(secretValue);
      }
      // The redaction placeholder should be present
      expect(err.errors[0].message).toContain("[redacted]");
    }
  });

  it("non-secret context values are not redacted", async () => {
    const engine = createEngine({
      secretRoots: ["secrets"],
      filters: {
        failWithValue: (v: Value) => {
          throw new Error(`got: ${String(v)}`);
        },
      },
    });

    try {
      await engine.evaluate("failWithValue(publicVal)", {
        secrets: "topsecret",
        publicVal: "visible",
      });
      expect.fail("Should have thrown");
    } catch (e) {
      const err = e as ExpressionError;
      expect(err.errors[0].message).toContain("visible");
      expect(err.errors[0].message).not.toContain("topsecret");
    }
  });
});

// ── compile() ─────────────────────────────────────────────────────────────────

describe("engine.compile()", () => {
  it("returns a callable FilterFn for an arrow expression", () => {
    const engine = createEngine();
    const double = engine.compile("x => x * 2");
    expect(typeof double).toBe("function");
    expect(double(5)).toBe(10);
  });

  it("throws ExpressionError for a non-arrow expression", () => {
    const engine = createEngine();
    expect(() => engine.compile("1 + 2")).toThrow(ExpressionError);
  });
});

// ── ExpressionError contract ──────────────────────────────────────────────────

describe("ExpressionError contract", () => {
  it("message equals errors[0].message for parse errors", () => {
    const engine = createEngine();
    try {
      engine.parse("(");
      expect.fail("Should have thrown");
    } catch (e) {
      const err = e as ExpressionError;
      expect(err.message).toBe(err.errors[0].message);
    }
  });

  it("message equals errors[0].message for runtime errors", async () => {
    const engine = createEngine();
    try {
      await engine.evaluate("null.prop");
      expect.fail("Should have thrown");
    } catch (e) {
      const err = e as ExpressionError;
      expect(err.message).toBe(err.errors[0].message);
    }
  });

  it("is instanceof ExpressionError", async () => {
    const engine = createEngine();
    try {
      await engine.evaluate("badFn()");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it("message falls back to 'Expression error' when constructed with an empty errors array", () => {
    const err = new ExpressionError([]);
    expect(err.message).toBe("Expression error");
    expect(err.errors).toHaveLength(0);
  });
});

// ── derive() ─────────────────────────────────────────────────────────────────

describe("engine.derive()", () => {
  it("inherits parent filters", async () => {
    const parent = createEngine({
      filters: { double: (v) => (v as number) * 2 },
    });
    const child = parent.derive();
    expect(await child.evaluate("double(x)", { x: 5 })).toBe(10);
  });

  it("child filter shadows parent filter of same name", async () => {
    const parent = createEngine({
      filters: { fn: () => "parent" },
    });
    const child = parent.derive({
      filters: { fn: () => "child" },
    });
    expect(await child.evaluate("fn()")).toBe("child");
  });

  it("child inherits resource limits from parent", async () => {
    const parent = createEngine({ timeoutMs: -1 });
    const child = parent.derive();
    await expect(child.evaluate("1")).rejects.toThrow(/timed out/i);
  });

  it("child can override resource limits", async () => {
    const parent = createEngine({ timeoutMs: -1 });
    const child = parent.derive({ timeoutMs: 100 });
    expect(await child.evaluate("1 + 1")).toBe(2);
  });

  it("child inherits secretRoots from parent", async () => {
    const parent = createEngine({
      secretRoots: ["env"],
      filters: { fail: (v: Value) => { throw new Error(String(v)); } },
    });
    const child = parent.derive();
    const secretValue = "hidden_secret_xyz";
    try {
      await child.evaluate("fail(env)", { env: secretValue });
      expect.fail("Should have thrown");
    } catch (e) {
      const err = e as ExpressionError;
      expect(err.errors[0].message).not.toContain(secretValue);
      expect(err.errors[0].message).toContain("[redacted]");
    }
  });

  it("child secretRoots replaces parent secretRoots when overridden", async () => {
    const parent = createEngine({ secretRoots: ["env"] });
    // Override without "env" — env is no longer protected
    const child = parent.derive({ secretRoots: ["other"] });
    const filters = { fail: (v: Value) => { throw new Error(String(v)); } };
    const engineWithFilter = child.derive({ filters });
    const envValue = "not_secret_anymore";
    try {
      await engineWithFilter.evaluate("fail(env)", { env: envValue });
      expect.fail("Should have thrown");
    } catch (e) {
      const err = e as ExpressionError;
      // env is no longer in secretRoots, so its value appears in the message
      expect(err.errors[0].message).toContain(envValue);
    }
  });
});

// ── Reserved-name registration guard ─────────────────────────────────────────

describe("reserved-name registration", () => {
  const RESERVED_NAMES = [
    "__proto__",
    "constructor",
    "prototype",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
  ];

  for (const name of RESERVED_NAMES) {
    it(`createEngine() throws immediately when filter named '${name}' is registered`, () => {
      expect(() =>
        createEngine({ filters: { [name]: () => null } }),
      ).toThrow(ExpressionError);
      expect(() =>
        createEngine({ filters: { [name]: () => null } }),
      ).toThrow(/reserved/i);
    });

    it(`derive() throws immediately when filter named '${name}' is registered`, () => {
      const parent = createEngine();
      expect(() =>
        parent.derive({ filters: { [name]: () => null } }),
      ).toThrow(ExpressionError);
      expect(() =>
        parent.derive({ filters: { [name]: () => null } }),
      ).toThrow(/reserved/i);
    });
  }

  it("non-reserved names are accepted without error", () => {
    expect(() =>
      createEngine({ filters: { myFilter: () => null } }),
    ).not.toThrow();
  });

  it("built-in name can be overridden by a custom filter (not a reserved name)", async () => {
    const engine = createEngine({ filters: { str: () => "overridden" } });
    expect(await engine.evaluate("str(42)")).toBe("overridden");
  });
});

// ── Object.prototype members are neither functions nor data ──────────────────

describe("Object.prototype member names", () => {
  const engine = createEngine({ strict: false });

  it.each(["toString(1)", "valueOf(1)", "x | toLocaleString"])("%s is an unknown function", async (source) => {
    await expect(engine.evaluate(source, { x: 1 })).rejects.toThrow(/^Unknown function/);
  });

  it("a bare name reads as an absent key", async () => {
    expect(await engine.evaluate("[toString, valueOf]")).toEqual([null, null]);
  });

  it("a data key with such a name is reachable", async () => {
    expect(await engine.evaluate("a.toString + a.valueOf", { a: { toString: 1, valueOf: 2 } })).toBe(3);
  });
});

// ── undefined from the host ──────────────────────────────────────────────────

describe("an undefined from the host is null", () => {
  const engine = createEngine({ filters: { nothing: () => undefined } });
  const context = { a: undefined, o: { b: undefined } };

  it.each([
    ["a", null], ["o.b", null], ["nothing()", null], ["a == null", true],
    ["!nothing()", true], ["[a, nothing()]", [null, null]], ["a ?? 1", 1],
  ])("%s", async (source, expected) => {
    expect(await engine.evaluate(source, context)).toEqual(expected);
  });

  it("the same on the async path", async () => {
    expect(await engine.evaluate("[a == null, r.x]", { ...context, r: resolve(async () => undefined) })).toEqual([true, null]);
  });

  it("renders as empty text", async () => {
    expect(await engine.render("[${{ a }}][${{ nothing() }}]", context)).toBe("[][]");
  });

  it("property access on it names null", async () => {
    await expect(engine.evaluate("a.x", context)).rejects.toThrow("is null, cannot read `x`");
  });

  it("property and index access on it name null on the async path", async () => {
    const async = { ...context, r: resolve(async () => null) };
    await expect(engine.evaluate("[r.x, a.x]", async)).rejects.toThrow("is null, cannot read `x`");
    await expect(engine.evaluate("[r.x, a[0]]", async)).rejects.toThrow("is null, cannot read an index");
  });

  it("a hole in a for iterable is null", async () => {
    expect(await engine.render("${% for x in xs %}[${{ x }}]${% endfor %}", { xs: new Array<Value>(2) })).toBe("[][]");
  });
});

// ── path() reserved-name runtime check ───────────────────────────────────────

describe("path() reserved-name runtime check", () => {
  it("throws when dotPath contains 'constructor'", async () => {
    const engine = createEngine();
    await expect(
      engine.evaluate('path(obj, "constructor")', { obj: {} }),
    ).rejects.toThrow(/reserved/i);
  });

  it("throws when dotPath contains 'constructor.prototype' (any segment)", async () => {
    const engine = createEngine();
    await expect(
      engine.evaluate('path(obj, "constructor.prototype")', { obj: {} }),
    ).rejects.toThrow(/reserved/i);
  });

  it("throws when dotPath contains '__proto__'", async () => {
    const engine = createEngine();
    await expect(
      engine.evaluate('path(obj, "__proto__")', { obj: {} }),
    ).rejects.toThrow(/reserved/i);
  });

  it("safe dotPath resolves normally", async () => {
    const engine = createEngine();
    const result = await engine.evaluate('path(obj, "a.b")', {
      obj: { a: { b: 42 } },
    });
    expect(result).toBe(42);
  });
});

// ── maxIterations cumulative check ────────────────────────────────────────────

describe("maxIterations cumulative across pipe steps", () => {
  it("two chained filter calls over a 6000-item array exhaust a 10000-iteration budget", async () => {
    const engine = createEngine({ maxIterations: 10_000, timeoutMs: 30_000 });
    // 6000-item array; filter visits each element — two filters = 12000 total iterations
    const arr = Array.from({ length: 6_000 }, (_, i) => i);
    await expect(
      engine.evaluate(
        "items | filter(x => x > -1) | filter(x => x < 9999)",
        { items: arr },
      ),
    ).rejects.toThrow(/iteration/i);
  });

  it("single filter within budget succeeds", async () => {
    const engine = createEngine({ maxIterations: 10_000 });
    const arr = Array.from({ length: 5_000 }, (_, i) => i);
    const result = await engine.evaluate("items | filter(x => x > 4998)", {
      items: arr,
    });
    expect(result).toEqual([4999]);
  });
});

// ── resolve() ─────────────────────────────────────────────────────────────────

describe("resolve()", () => {
  it("member access calls fn with the property name", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { token: "abc123", count: 42 };
    const result = await engine.evaluate("state.token", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("abc123");
  });

  it("index access with string key calls fn", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { x: 99 };
    const result = await engine.evaluate('state["x"]', {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe(99);
  });

  it("index access with numeric key coerces to string", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { "0": "zero", "42": "forty-two" };
    const result = await engine.evaluate("state[42]", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("forty-two");
  });

  it("nested Resolver: fn returns another Resolver", async () => {
    const engine = createEngine();
    const users: Record<string, Value> = { name: "Alice", age: 30 };
    const root = resolve(async (key) => {
      if (key === "user") return resolve(async (k) => users[k] ?? null);
      return null;
    });
    const result = await engine.evaluate("state.user.name", { state: root });
    expect(result).toBe("Alice");
  });

  it("Resolver travels through a let binding", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { val: "hello" };
    const result = await engine.evaluate("let s = state in s.val", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("hello");
  });

  it("missing key returns null when fn returns null", async () => {
    const engine = createEngine();
    const result = await engine.evaluate("state.missing", {
      state: resolve(async () => null),
    });
    expect(result).toBeNull();
  });

  it("optional chaining on Resolver result", async () => {
    const engine = createEngine();
    const result = await engine.evaluate("state.missing?.nested", {
      state: resolve(async () => null),
    });
    expect(result).toBeNull();
  });

  it("render() interpolates Resolver values", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { greeting: "hi" };
    const result = await engine.render("say ${{ state.greeting }}!", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("say hi!");
  });

  it("non-Resolver context keys continue to work normally", async () => {
    const engine = createEngine();
    const result = await engine.evaluate("x + 1", { x: 41 });
    expect(result).toBe(42);
  });

  it("Resolver and plain values coexist in the same context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { key: "found" };
    const result = await engine.evaluate("plain + state.key", {
      plain: "value=",
      state: resolve(async (k) => store[k] ?? null),
    });
    expect(result).toBe("value=found");
  });

  it("array literal evaluates in async (Resolver) context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { x: 1, y: 2 };
    const result = await engine.evaluate("[state.x, state.y]", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toEqual([1, 2]);
  });

  it("object literal evaluates in async (Resolver) context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { val: "hello" };
    const result = await engine.evaluate("{ a: state.val }", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toEqual({ a: "hello" });
  });

  it("unary operator evaluates in async (Resolver) context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { flag: false };
    const result = await engine.evaluate("!state.flag", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe(true);
  });

  it("index access on non-Resolver evaluates normally in async context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { i: 1 };
    const result = await engine.evaluate("data[1]", {
      data: [10, 20, 30],
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe(20);
  });

  it("Resolver index access with non-string non-number key throws", async () => {
    const engine = createEngine();
    await expect(
      engine.evaluate("state[key]", {
        key: null,
        state: resolve(async () => null),
      }),
    ).rejects.toThrow(/Resolver key must be a string or number/);
  });

  it("function call evaluates in async (Resolver) context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { s: "  hello  " };
    const result = await engine.evaluate("trim(state.s)", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("hello");
  });

  it("ternary evaluates in async (Resolver) context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { cond: true };
    const result = await engine.evaluate("state.cond ? 'yes' : 'no'", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("yes");
  });

  it("pipe evaluates in async (Resolver) context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { s: "  hello  " };
    const result = await engine.evaluate("state.s | trim", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("hello");
  });

  it("arrow function is created in async (Resolver) context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { n: 5 };
    // The arrow is created (covers the "arrow" case in evaluateAsync);
    // state.n is the body, accessed via the Resolver
    const result = await engine.evaluate("let f = x => x in state.n", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe(5);
  });

  it("&& short-circuits in async (Resolver) context when left is falsy", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { a: null };
    const result = await engine.evaluate("state.a && 'right'", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBeNull();
  });

  it("&& evaluates right operand in async context when left is truthy", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { a: true };
    const result = await engine.evaluate("state.a && 'right'", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("right");
  });

  it("|| evaluates right operand in async context when left is falsy", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { a: null };
    const result = await engine.evaluate("state.a || 'default'", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("default");
  });

  it("?? evaluates right operand in async context when left is null", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { a: null };
    const result = await engine.evaluate("state.a ?? 'fallback'", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("fallback");
  });

  it("pipe with arguments evaluates args async in Resolver context", async () => {
    const engine = createEngine();
    const store: Record<string, Value> = { n: 10 };
    const result = await engine.evaluate("state.n | toFixed(1)", {
      state: resolve(async (key) => store[key] ?? null),
    });
    expect(result).toBe("10.0");
  });

  it("FunctionValue element in async array literal throws", async () => {
    const engine = createEngine();
    await expect(
      engine.evaluate("[(x => x)]", {
        state: resolve(async () => null),
      }),
    ).rejects.toThrow(/Function values cannot be stored inside array literals/);
  });

  it("Resolver element in async array literal throws", async () => {
    const engine = createEngine();
    await expect(
      engine.evaluate("[state]", {
        state: resolve(async () => null),
      }),
    ).rejects.toThrow(/Resolver values cannot be stored inside array literals/);
  });

  it("FunctionValue element in async object literal throws", async () => {
    const engine = createEngine();
    // size is a builtin filter name — evaluateIdentifier returns a FunctionValue for it
    await expect(
      engine.evaluate("{ a: size }", {
        state: resolve(async () => null),
      }),
    ).rejects.toThrow(/Function values cannot be stored inside object literals/);
  });

  it("Resolver element in async object literal throws", async () => {
    const engine = createEngine();
    await expect(
      engine.evaluate("{ a: state }", {
        state: resolve(async () => null),
      }),
    ).rejects.toThrow(/Resolver values cannot be stored inside object literals/);
  });
});

// ── Block tag rendering: ${% if %} ────────────────────────────────────────────

describe("engine.render() — ${% if %}", () => {
  it("if true branch renders", async () => {
    const eng = createEngine();
    expect(await eng.render("${% if show %}yes${% endif %}", { show: true })).toBe("yes");
  });

  it("if false branch produces empty string (no else)", async () => {
    const eng = createEngine();
    expect(await eng.render("${% if show %}yes${% endif %}", { show: false })).toBe("");
  });

  it("if–else selects correct branch", async () => {
    const eng = createEngine();
    expect(await eng.render("${% if ok %}A${% else %}B${% endif %}", { ok: true })).toBe("A");
    expect(await eng.render("${% if ok %}A${% else %}B${% endif %}", { ok: false })).toBe("B");
  });

  it("if–elif–else: first truthy branch wins", async () => {
    const tmpl = "${% if a %}A${% elif b %}B${% else %}C${% endif %}";
    const eng = createEngine();
    expect(await eng.render(tmpl, { a: true, b: true })).toBe("A");
    expect(await eng.render(tmpl, { a: false, b: true })).toBe("B");
    expect(await eng.render(tmpl, { a: false, b: false })).toBe("C");
  });

  it("condition can contain a full Tavnit expression", async () => {
    const eng = createEngine();
    expect(await eng.render("${% if count > 0 %}positive${% endif %}", { count: 5 })).toBe("positive");
    expect(await eng.render("${% if count > 0 %}positive${% endif %}", { count: 0 })).toBe("");
  });

  it("if body can contain expression spans", async () => {
    const eng = createEngine();
    expect(await eng.render("${% if show %}Hello ${{ name }}!${% endif %}", { show: true, name: "World" })).toBe("Hello World!");
  });

  it("if condition expression error is enriched with template position", async () => {
    const eng = createEngine();
    try {
      await eng.render("${% if 1 + %}yes${% endif %}");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      const err = e as ExpressionError;
      expect(err.errors[0].location?.source).toBe("${% if 1 + %}yes${% endif %}");
    }
  });

  it("elif condition expression error is enriched with template position", async () => {
    const eng = createEngine();
    const tmpl = "${% if false %}A${% elif unknownFilter() %}B${% endif %}";
    try {
      await eng.render(tmpl);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      const err = e as ExpressionError;
      expect(err.errors[0].location?.source).toBe(tmpl);
    }
  });
});

// ── Block tag rendering: ${% for %} ──────────────────────────────────────────

describe("engine.render() — ${% for %}", () => {
  it("for produces correct concatenated output", async () => {
    const eng = createEngine();
    expect(
      await eng.render("${% for item in items %}[${{ item }}]${% endfor %}", { items: ["a", "b", "c"] }),
    ).toBe("[a][b][c]");
  });

  it("for injects forloop.index (0-based)", async () => {
    const eng = createEngine();
    expect(
      await eng.render("${% for x in list %}${{ forloop.index }}${% endfor %}", { list: ["a", "b", "c"] }),
    ).toBe("012");
  });

  it("for injects forloop.index1 (1-based)", async () => {
    const eng = createEngine();
    expect(
      await eng.render("${% for x in list %}${{ forloop.index1 }}${% endfor %}", { list: ["a", "b"] }),
    ).toBe("12");
  });

  it("for injects forloop.first and forloop.last", async () => {
    const eng = createEngine();
    const result = await eng.render(
      "${% for x in list %}${{ forloop.first }};${{ forloop.last }}|${% endfor %}",
      { list: ["a", "b", "c"] },
    );
    expect(result).toBe("true;false|false;false|false;true|");
  });

  it("for injects forloop.length", async () => {
    const eng = createEngine();
    expect(
      await eng.render("${% for x in list %}${{ forloop.length }}${% endfor %}", { list: [1, 2, 3] }),
    ).toBe("333");
  });

  it("for over empty array produces empty string", async () => {
    const eng = createEngine();
    expect(await eng.render("${% for x in list %}${{ x }}${% endfor %}", { list: [] })).toBe("");
  });

  it("for over non-array throws ExpressionError", async () => {
    const eng = createEngine();
    await expect(
      eng.render("${% for x in items %}${{ x }}${% endfor %}", { items: "not an array" }),
    ).rejects.toThrow(ExpressionError);
  });

  it("for iterable expression error is enriched with template position", async () => {
    const eng = createEngine();
    const tmpl = "${% for item in unknownFilter() %}${{ item }}${% endfor %}";
    try {
      await eng.render(tmpl);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      const err = e as ExpressionError;
      expect(err.errors[0].location?.source).toBe(tmpl);
    }
  });
});

// ── Nested blocks ─────────────────────────────────────────────────────────────

describe("engine.render() — nested blocks", () => {
  it("for inside if: renders only when condition is true", async () => {
    const eng = createEngine();
    const tmpl = "${% if show %}${% for x in list %}${{ x }},${% endfor %}${% endif %}";
    expect(await eng.render(tmpl, { show: true, list: [1, 2, 3] })).toBe("1,2,3,");
    expect(await eng.render(tmpl, { show: false, list: [1, 2, 3] })).toBe("");
  });

  it("if inside for: condition evaluated per-iteration", async () => {
    const eng = createEngine();
    const tmpl = "${% for x in list %}${% if x %}yes${% else %}no${% endif %}|${% endfor %}";
    expect(await eng.render(tmpl, { list: [true, false, true] })).toBe("yes|no|yes|");
  });
});

// ── Resource limits ───────────────────────────────────────────────────────────

describe("engine.render() — resource limits", () => {
  it("loopBudget exhausted throws ExpressionError", async () => {
    const eng = createEngine({ maxIterations: 5 });
    await expect(
      eng.render("${% for x in list %}${{ x }}${% endfor %}", { list: [1, 2, 3, 4, 5, 6] }),
    ).rejects.toThrow(ExpressionError);
  });

  it("maxOutputBytes exceeded throws ExpressionError", async () => {
    const eng = createEngine({ maxOutputBytes: 10 });
    await expect(
      eng.render("${% for x in list %}${{ x }}${% endfor %}", { list: ["hello", "world", "extra"] }),
    ).rejects.toThrow(ExpressionError);
  });

  it("maxOutputBytes of 0 blocks even literal text", async () => {
    const eng = createEngine({ maxOutputBytes: 0 });
    await expect(eng.render("hello")).rejects.toThrow(ExpressionError);
  });
});

// ── Template caching ──────────────────────────────────────────────────────────

describe("engine.render() — template caching", () => {
  it("renders correctly on repeated calls (cache hit path)", async () => {
    const eng = createEngine();
    const tmpl = "${% if ok %}yes${% endif %}";
    expect(await eng.render(tmpl, { ok: true })).toBe("yes");
    expect(await eng.render(tmpl, { ok: false })).toBe("");
    expect(await eng.render(tmpl, { ok: true })).toBe("yes");
  });

  it("derive() shares template cache with parent", async () => {
    const parent = createEngine();
    const child = parent.derive();
    // Same template rendered by parent then child — child should hit the cache
    await parent.render("${% if x %}A${% endif %}", { x: true });
    const result = await child.render("${% if x %}A${% endif %}", { x: false });
    expect(result).toBe(""); // child evaluates with different context
  });

  it("derive() can override maxOutputBytes", async () => {
    const parent = createEngine({ maxOutputBytes: 1_048_576 });
    const child = parent.derive({ maxOutputBytes: 5 });
    await expect(child.render("hello world")).rejects.toThrow(ExpressionError);
    expect(await parent.render("hello world")).toBe("hello world");
  });
});

// ── renderObject() single-expression check with block tags ───────────────────

describe("engine.renderObject() — single-expression check with parseTemplate", () => {
  it("plain ${{ expr }} still passes through as raw Value", async () => {
    const eng = createEngine();
    expect(await eng.renderObject("${{ 42 }}", {})).toBe(42);
    expect(await eng.renderObject("${{ true }}", {})).toBe(true);
    expect(await eng.renderObject("${{ null }}", {})).toBeNull();
  });

  it("block-tag template renders to string (not raw Value)", async () => {
    const eng = createEngine();
    const result = await eng.renderObject("${% if ok %}yes${% endif %}", { ok: true });
    expect(result).toBe("yes");
    expect(typeof result).toBe("string");
  });
});

// ── Error location enrichment inside block bodies ─────────────────────────────

// ── compile() — fewer args than params ───────────────────────────────────────

describe("engine.compile() — missing call arguments", () => {
  it("compiled fn fills missing positional args with null via ?? null", () => {
    // allArgs[i] is undefined when the caller supplies fewer args than params;
    // `?? null` converts it to null so the arrow body sees a Tavnit null.
    const fn = createEngine().compile("(a, b) => b ?? 99");
    expect(fn(1)).toBe(99); // b is missing → undefined → null → ?? 99 → 99
  });
});

// ── toExpressionError — ExpressionError pass-through ─────────────────────────

describe("toExpressionError — ExpressionError thrown from a custom filter", () => {
  it("ExpressionError thrown directly from a filter is returned as-is (not re-wrapped)", async () => {
    const original = new ExpressionError([{ message: "from filter" }]);
    const engine = createEngine({ filters: { fail: () => { throw original; } } });
    const caught = await engine.evaluate("fail(1)").catch((e) => e);
    expect(caught).toBe(original);
  });
});

// ── toExpressionError — non-Error throw ──────────────────────────────────────

describe("toExpressionError — non-Error thrown value", () => {
  it("wraps a thrown string as ExpressionError with 'Unknown error' message", async () => {
    // Filters may throw anything; the engine must handle non-Error values.
    // This covers the `e instanceof Error ? e.message : "Unknown error"` false branch.
    const engine = createEngine({
      filters: { explode: () => { throw "plain string, not an Error"; } },
    });
    try {
      await engine.evaluate("explode(1)");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      expect((e as ExpressionError).message).toBe("Unknown error");
    }
  });
});

// ── valueToString — ZonedDateTime ─────────────────────────────────────────────

describe("valueToString — ZonedDateTime", () => {
  it("render() stringifies a ZonedDateTime value as an ISO string", async () => {
    const engine = createEngine({ timeoutMs: 5000 });
    const result = await engine.render("${{ now() | toZonedDateTime('UTC') }}", {});
    expect(typeof result).toBe("string");
    expect(result).toMatch(/UTC/);
  });
});

describe("engine.render() — error location enrichment in blocks", () => {
  it("expression error inside for body carries template source", async () => {
    const eng = createEngine();
    try {
      await eng.render("${% for x in list %}${{ 1 + }}${% endfor %}", { list: [1] });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      const err = e as ExpressionError;
      expect(err.errors[0].location?.source).toBe(
        "${% for x in list %}${{ 1 + }}${% endfor %}",
      );
    }
  });

  it("rejects an invalid expression in an untaken branch when compiling", async () => {
    const eng = createEngine();
    await expect(eng.render("${% if false %}${{ 1 + }}${% endif %}")).rejects.toThrow(ExpressionError);
  });

  it("expression error inside if body carries template source", async () => {
    const eng = createEngine();
    try {
      await eng.render("${% if true %}${{ 1 + }}${% endif %}");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      const err = e as ExpressionError;
      expect(err.errors[0].location?.source).toBe("${% if true %}${{ 1 + }}${% endif %}");
    }
  });
});

// ── maxStringLength / maxRegexInput ───────────────────────────────────────────

describe("maxStringLength and maxRegexInput", () => {
  it("cap string built-ins at the configured length", async () => {
    const engine = createEngine({ maxStringLength: 10 });
    expect(await engine.evaluate("'abc' | padStart(10)", {})).toBe("       abc");
    await expect(engine.evaluate("'abc' | padStart(11)", {})).rejects.toThrow(/padStart\(\) result exceeds 10 characters/);
    await expect(engine.evaluate("'abcdef' | append('ghijk')", {})).rejects.toThrow(/append\(\) result exceeds 10 characters/);
    await expect(engine.evaluate("['abcdef', 'ghijkl'] | join(',')", {})).rejects.toThrow(/join\(\) result exceeds 10 characters/);
    await expect(engine.evaluate("'abcdef' | indent(20)", {})).rejects.toThrow(/indent\(\) result exceeds 10 characters/);
    await expect(engine.evaluate("'aaaaaaaa' | replaceAll('a', 'bb')", {})).rejects.toThrow(/replaceAll\(\) result exceeds 10 characters/);
  });

  it("keeps the default of 10 000 000 characters", async () => {
    const engine = createEngine();
    await expect(engine.evaluate("'a' | padStart(10000001)", {})).rejects.toThrow(/exceeds 10000000 characters/);
  });

  it("caps the native regex subject at maxRegexInput", async () => {
    const engine = createEngine({ regex: "native", maxRegexInput: 5 });
    expect(await engine.evaluate("'abcde' | matches('c')", {})).toBe(true);
    await expect(engine.evaluate("'abcdef' | matches('c')", {})).rejects.toThrow(/subject is longer than 5 characters/);
    // the linear engine has no subject cap
    expect(await createEngine({ maxRegexInput: 5 }).evaluate("'abcdef' | matches('f')", {})).toBe(true);
  });

  it("rejects values that are not positive integers", () => {
    for (const bad of [0, -1, 1.5, Infinity, NaN]) {
      expect(() => createEngine({ maxStringLength: bad })).toThrow(RangeError);
      expect(() => createEngine({ maxRegexInput: bad })).toThrow(RangeError);
      expect(() => createEngine().derive({ maxStringLength: bad })).toThrow(RangeError);
    }
  });

  it("derive inherits and overrides", async () => {
    const parent = createEngine({ maxStringLength: 5 });
    await expect(parent.derive().evaluate("'abc' | append('def')", {})).rejects.toThrow(/exceeds 5 characters/);
    expect(await parent.derive({ maxStringLength: 6 }).evaluate("'abc' | append('def')", {})).toBe("abcdef");
  });
});
