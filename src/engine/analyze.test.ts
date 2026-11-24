import { describe, expect, it } from "vitest";
import { createEngine } from "./engine.js";
import { ExpressionError } from "./types.js";

const engine = createEngine();

describe("engine.analyze", () => {
  it("lists the free variables and the calls of an expression", () => {
    const analysis = engine.analyze("items | filter(i => i.on && flag) | map(i => size(i.tags) + extra)");
    expect(analysis.variables).toEqual(["items", "flag", "extra"]);
    expect(analysis.functions).toEqual(["filter", "map", "size"]);
    expect(analysis.calls.map((call) => call.name)).toEqual(["filter", "map", "size"]);
  });

  it("gives each call the span of its name and arguments", () => {
    const { calls } = engine.analyze("a | trim() ?? squish(b)");
    expect(calls).toEqual([
      { name: "trim", start: { line: 1, column: 5 }, end: { line: 1, column: 11 } },
      { name: "squish", start: { line: 1, column: 15 }, end: { line: 1, column: 24 } },
    ]);
  });

  it("does not count arrow parameters and let bindings as free", () => {
    expect(engine.analyze("let k = base * 2 in items | map(x => x + k + y)").variables).toEqual(["base", "items", "y"]);
    expect(engine.analyze("let a = b, b = 1 in a").variables).toEqual(["b"]);
  });

  it("reports a name once but every call", () => {
    const analysis = engine.analyze("a + a + size(b) + size(c)");
    expect(analysis.variables).toEqual(["a", "b", "c"]);
    expect(analysis.functions).toEqual(["size"]);
    expect(analysis.calls).toHaveLength(2);
  });

  it("reads a text template, with loop variables bound and positions in the template", () => {
    const template = "Hi ${{ name }}\n${% for t in tags %}${{ t | squish() }} #${{ forloop.index1 }} ${{ other }}${% endfor %}";
    const analysis = engine.analyze(template, "text");
    expect(analysis.variables).toEqual(["name", "tags", "other"]);
    expect(analysis.calls).toEqual([{ name: "squish", start: { line: 2, column: 29 }, end: { line: 2, column: 37 } }]);
  });

  it("reads if conditions and else branches of a text template", () => {
    const analysis = engine.analyze("${% if a %}${{ b }}${% elif c %}${{ d }}${% else %}${{ e }}${% endif %}", "text");
    expect(analysis.variables).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("reads an if without else and a guard with only $unless", () => {
    expect(engine.analyze("${% if a %}${{ b }}${% endif %}", "text").variables).toEqual(["a", "b"]);
    expect(engine.analyze(engine.parseValueTemplate({ $unless: "${{ off }}", v: 1 })).variables).toEqual(["off"]);
    expect(engine.analyze(engine.parseValueTemplate({ $if: "${{ on }}", v: 1 })).variables).toEqual(["on"]);
  });

  it("accepts the compiled forms", () => {
    expect(engine.analyze(engine.parse("a + f(b)")).variables).toEqual(["a", "b"]);
    expect(engine.analyze(engine.parseTextTemplate("${{ a }}${{ g(b) }}")).functions).toEqual(["g"]);
  });

  it("reads a value tree: expressions, text, keys, guards, spreads and holes", () => {
    const tree = engine.parseValueTemplate({
      $if: "${{ cond }}",
      title: "Hello ${{ user }}",
      "key-${{ k }}": "${{ val | trim() }}",
      list: ["${{ item }}", { a: 1, "...": "${{ extra }}" }],
      rows: { $_: "${{ rows | map(r => _) }}", _: { id: "${{ r.id + bound }}" } },
      literal: 1,
      many: [{ "...": "${{ more }}" }, { $_: "${{ keep ? _ : null }}", _: { type: "Solo" } }],
    });
    const analysis = engine.analyze(tree);
    for (const name of ["cond", "user", "k", "val", "item", "extra", "rows", "bound", "more", "keep"]) expect(analysis.variables).toContain(name);
    expect(analysis.functions).toEqual(["trim", "map"]);
    expect(analysis.variables).not.toContain("r");
  });

  it("throws an ExpressionError on a syntax error", () => {
    expect(() => engine.analyze("a +")).toThrow(ExpressionError);
    expect(() => engine.analyze("${{ a +", "text")).toThrow(ExpressionError);
  });
});

describe("engine.check", () => {
  it("returns nothing when every name resolves", () => {
    expect(engine.check("items | map(i => i.id)", { variables: ["items"] })).toEqual([]);
  });

  it("reports an unknown variable with the nearest name and its location", () => {
    const [diagnostic, ...rest] = engine.check("price * qty", { variables: ["prise", "qty"] });
    expect(rest).toEqual([]);
    expect(diagnostic).toEqual({
      code: "TAV_UNKNOWN_NAME",
      severity: "error",
      message: "Unknown name 'price'; did you mean 'prise'?",
      location: { source: "price * qty", start: { line: 1, column: 1 }, end: { line: 1, column: 6 } },
      access: "price",
    });
  });

  it("reports an unknown function with the nearest built-in", () => {
    const [diagnostic] = engine.check("items | mapp(i => i)", { variables: ["items"] });
    expect(diagnostic?.code).toBe("TAV_UNKNOWN_FUNCTION");
    expect(diagnostic?.message).toBe("Unknown function 'mapp'; did you mean 'map'?");
    expect(diagnostic?.location?.start).toEqual({ line: 1, column: 9 });
  });

  it("checks only functions when no variables are given", () => {
    expect(engine.check("zzz + nope(1)").map((d) => d.code)).toEqual(["TAV_UNKNOWN_FUNCTION"]);
  });

  it("knows the engine's own filters and the extra filters", () => {
    const custom = createEngine({ filters: { mine: (v) => v } });
    expect(custom.check("a | mine()", { variables: ["a"] })).toEqual([]);
    expect(engine.check("a | host()", { variables: ["a"], filters: ["host"] })).toEqual([]);
    expect(engine.check("a | host()", { variables: ["a"] })).toHaveLength(1);
  });

  it("does not report bound names", () => {
    expect(engine.check("let k = 1 in xs | map(x => x + k)", { variables: ["xs"] })).toEqual([]);
  });

  it("locates a name in a text template and binds the loop variable", () => {
    const template = "a\n${% for t in tags %}${{ t }} ${{ tgs }}${% endfor %} ${{ forloop }}";
    const diagnostics = engine.check(template, { kind: "text", variables: ["tags"] });
    expect(diagnostics.map((d) => d.message)).toEqual(["Unknown name 'tgs'; did you mean 'tags'?", "Unknown name 'forloop'"]);
    expect(diagnostics[0]?.location).toEqual({ source: template, start: { line: 2, column: 34 }, end: { line: 2, column: 37 } });
  });

  it("returns the diagnostics in source order", () => {
    const diagnostics = engine.check("nope(1) + missing", { variables: [] });
    expect(diagnostics.map((d) => d.access ?? d.message)).toEqual(["Unknown function 'nope'", "missing"]);
  });

  it("checks a value tree", () => {
    const diagnostics = engine.check(engine.parseValueTemplate({ a: "${{ x }}", b: "t ${{ y | nope() }}" }), { variables: ["x"] });
    expect(diagnostics.map((d) => d.code).sort()).toEqual(["TAV_UNKNOWN_FUNCTION", "TAV_UNKNOWN_NAME"]);
  });

  it("agrees with a strict run: a clean check means no unknown-name error at run time", async () => {
    const strict = createEngine({ strict: true });
    const source = "items | map(i => i.id) | size()";
    expect(strict.check(source, { variables: ["items"] })).toEqual([]);
    await expect(strict.evaluate(source, { items: [{ id: 1 }] })).resolves.toBe(1);
  });
});
