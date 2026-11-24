import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "../evaluator/errors.js";
import { resolve } from "../evaluator/types.js";
import { createEngine } from "./engine.js";
import { type Diagnostic, ExpressionError, type Value } from "./types.js";

const engine = createEngine();
const lenientEngine = createEngine({ strict: false });

async function failure(run: () => Promise<Value | string>): Promise<ExpressionError> {
  const error = await run().then(
    () => { throw new Error("expected a rejection"); },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ExpressionError);
  return error as ExpressionError;
}

describe("every diagnostic carries a stable code", () => {
  const cases: Array<[string, () => Promise<Value | string>, string]> = [
    ["a syntax error", () => engine.evaluate("1 +"), "TAV_SYNTAX"],
    ["an unterminated span", () => engine.render("${{ 1"), "TAV_SYNTAX"],
    ["an unterminated block tag", () => engine.render("${% if x"), "TAV_SYNTAX"],
    ["a syntax error inside a span", () => engine.render("a ${{ 1 + }}"), "TAV_SYNTAX"],
    ["a bad value-tree directive", () => engine.renderObject({ $if: "yes", a: 1 }), "TAV_SYNTAX"],
    ["a type error", () => engine.evaluate('1 - "a"'), "TAV_TYPE"],
    ["a bad for iterable", () => engine.render("${% for i in 5 %}${% endfor %}"), "TAV_TYPE"],
    ["a bad spread", () => engine.renderObject({ "...": "${{ 1 }}" }), "TAV_TYPE"],
    ["a function rendered", () => engine.render("${{ x => x }}"), "TAV_TYPE"],
    ["a null access", () => engine.evaluate("a.b", { a: null }), "TAV_NULL_ACCESS"],
    ["an unknown function", () => engine.evaluate("nope(1)"), "TAV_UNKNOWN_FUNCTION"],
    ["a built-in argument error", () => engine.evaluate("map(5, x => x)"), "TAV_RUNTIME"],
    ["a host filter error", () => createEngine({ filters: { boom: () => { throw new Error("boom"); } } }).evaluate("boom(1)"), "TAV_HOST"],
    ["an async filter on the sync path", () => createEngine({ filters: { later: async () => 1 } }).evaluate("later(1)"), "TAV_ASYNC"],
    ["a reserved filter name", async () => createEngine({ filters: { constructor: () => 1 } }).evaluate("1"), "TAV_USAGE"],
    ["a compile() without an arrow", async () => engine.compile("1 + 1"), "TAV_USAGE"],
    ["a strict unknown name", () => createEngine({ strict: true }).evaluate("x", {}), "TAV_UNKNOWN_NAME"],
    ["a strict unknown property", () => createEngine({ strict: true }).evaluate("a.x", { a: {} }), "TAV_UNKNOWN_PROPERTY"],
    ["a division by zero", () => createEngine({ strict: true }).evaluate("1 / 0"), "TAV_DIVISION_BY_ZERO"],
    ["an iteration limit", () => createEngine({ maxIterations: 1 }).evaluate("[1, 2] | map(x => x)"), "TAV_LIMIT_ITERATIONS"],
    ["a step limit", () => createEngine({ maxSteps: 2 }).evaluate("1 + 2"), "TAV_LIMIT_STEPS"],
    ["a timeout", () => createEngine({ timeoutMs: -1 }).evaluate("1 + 2"), "TAV_LIMIT_TIMEOUT"],
    ["an output limit", () => createEngine({ maxOutputBytes: 2 }).render("abc"), "TAV_LIMIT_OUTPUT"],
    ["a depth limit", () => createEngine({ maxDepth: 2 }).evaluate("1 + (2 + (3 + 4))"), "TAV_LIMIT_DEPTH"],
    ["a string limit", () => createEngine({ maxStringLength: 3 }).evaluate('padStart("a", 10)'), "TAV_LIMIT_STRING"],
    ["a loop limit", () => createEngine({ maxIterations: 1 }).render("${% for i in [1, 2] %}${% endfor %}"), "TAV_LIMIT_ITERATIONS"],
    ["a bad context value", () => engine.evaluate("a", { a: () => 1 } as never), "TAV_CONTEXT"],
  ];

  it.each(cases)("%s", async (_name, run, code) => {
    const error = await failure(run);
    for (const diagnostic of error.errors) expect(diagnostic.code).toBe(code);
  });

  it("uses only codes the catalog lists", () => {
    const used = new Set(cases.map(([, , code]) => code));
    for (const code of used) expect(ERROR_CODES).toContain(code);
  });

  it("keeps the code through a value tree path and a text template", async () => {
    const tree = await failure(() => engine.renderObject({ a: { b: "${{ x.y }}" } }, { x: null }));
    expect(tree.errors[0]).toMatchObject({ code: "TAV_NULL_ACCESS", path: ["a", "b"], access: "x" });
    const text = await failure(() => engine.render("a ${{ x.y }}", { x: null }));
    expect(text.errors[0]).toMatchObject({ code: "TAV_NULL_ACCESS", access: "x" });
  });

  it("codes a failure of a compiled lambda", () => {
    const lambda = engine.compile("x => x.a.b");
    expect(() => lambda({ a: null })).toThrow(expect.objectContaining({ errors: [expect.objectContaining({ code: "TAV_NULL_ACCESS" })] }));
  });
});

describe("a null access names its path", () => {
  const read = async (source: string, context: Record<string, Value>): Promise<Diagnostic> => (await failure(() => engine.evaluate(source, context))).errors[0];

  it("names a dotted path", async () => {
    const diagnostic = await read("a.b.c", { a: { b: null } });
    expect(diagnostic.message).toBe("`a.b` is null, cannot read `c`");
    expect(diagnostic.access).toBe("a.b");
  });

  it("names a root", async () => {
    expect((await failure(() => lenientEngine.evaluate("a.c", {}))).errors[0].message).toBe("`a` is null, cannot read `c`");
  });

  it("names an index path", async () => {
    expect((await read("a[0].c", { a: [null] })).message).toBe("`a[0]` is null, cannot read `c`");
    expect((await read('a["k"].c', { a: { k: null } })).message).toBe('`a["k"]` is null, cannot read `c`');
    expect((await read("a[i].c", { a: [null], i: 0 })).message).toBe("`a[…]` is null, cannot read `c`");
  });

  it("names a null that is indexed", async () => {
    expect((await read("a.b[0]", { a: { b: null } })).message).toBe("`a.b` is null, cannot read an index");
  });

  it("describes a receiver that is no plain path", async () => {
    const diagnostic = await read("first(a).c", { a: [] });
    expect(diagnostic.message).toBe("Value is null, cannot read `c`");
    expect(diagnostic.access).toBeUndefined();
  });

  it("describes a receiver that is a call result, however long the chain", async () => {
    expect((await read("first(rows).a.c", { rows: [{ a: null }] })).message).toBe("Value is null, cannot read `c`");
    expect((await read("first(rows)[0].c", { rows: [[null]] })).message).toBe("Value is null, cannot read `c`");
  });

  it("names the path on the async path", async () => {
    const context = { state: resolve(async () => 1), a: { b: null } };
    await expect(engine.evaluate("[state.x, a.b.c]", context)).rejects.toThrow("`a.b` is null, cannot read `c`");
  });
});

describe("an unknown function suggests the nearest", () => {
  it("offers a built-in near the typo", async () => {
    const error = await failure(() => engine.evaluate("lenght(a)", { a: [] }));
    expect(error.errors[0].message).toBe("Unknown function 'lenght'");
    const near = await failure(() => engine.evaluate("trimm(a)", { a: "" }));
    expect(near.errors[0].message).toBe("Unknown function 'trimm'; did you mean 'trim'?");
  });
});

describe("a limit diagnostic is structured", () => {
  it("names the iteration limit, its value and the option", async () => {
    const error = await failure(() => createEngine({ maxIterations: 3 }).evaluate("[1, 2, 3, 4] | map(x => x)"));
    expect(error.errors[0]).toMatchObject({
      code: "TAV_LIMIT_ITERATIONS",
      message: "Iteration limit 3 exceeded; raise maxIterations",
      limit: "iterations",
      value: 3,
      option: "maxIterations",
    });
  });

  it.each([
    ["steps", () => createEngine({ maxSteps: 2 }).evaluate("1 + 2"), "Step limit 2 exceeded; raise maxSteps", "maxSteps", 2],
    ["timeout", () => createEngine({ timeoutMs: -1 }).evaluate("1"), "Evaluation timed out after -1 ms; raise timeoutMs", "timeoutMs", -1],
    ["output", () => createEngine({ maxOutputBytes: 2 }).render("abc"), "Output size limit of 2 bytes exceeded; raise maxOutputBytes", "maxOutputBytes", 2],
    ["depth", () => createEngine({ maxDepth: 2 }).evaluate("1 + (2 + (3 + 4))"), "Recursion depth limit 2 exceeded; raise maxDepth", "maxDepth", 2],
    ["string", () => createEngine({ maxStringLength: 3 }).evaluate('padStart("a", 10)'), "padStart() result exceeds 3 characters; raise maxStringLength", "maxStringLength", 3],
    ["iterations", () => createEngine({ maxIterations: 1 }).render("${% for i in [1, 2] %}${% endfor %}"), "Iteration limit 1 exceeded; raise maxIterations", "maxIterations", 1],
  ])("%s", async (limit, run, message, option, value) => {
    const error = await failure(run);
    expect(error.errors[0]).toMatchObject({ limit, message, option, value });
    expect(error.message).toBe(message);
  });
});
