import { beforeEach, describe, expect, it, vi } from "vitest";
import * as evaluator from "../evaluator/evaluate.js";
import { resolve } from "../evaluator/types.js";
import { createEngine } from "./engine.js";
import { type DataContext, ExpressionError, type Value } from "./types.js";

// Count the expressions the engine sends down the async path: the synchronous methods send none.
vi.mock("../evaluator/evaluate.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../evaluator/evaluate.js")>();
  return { ...original, evaluateAsync: vi.fn(original.evaluateAsync) };
});

const evaluateAsync = vi.mocked(evaluator.evaluateAsync);
const engine = createEngine();
const context: DataContext = {
  user: { name: "Ada", tags: ["a", "b"] },
  items: [{ id: 1, on: true }, { id: 2, on: false }, { id: 3, on: true }],
  n: 4,
  nulls: [null, 1],
};

function codeOf(error: unknown): string | undefined {
  return error instanceof ExpressionError ? error.errors[0]?.code : undefined;
}

beforeEach(() => { evaluateAsync.mockClear(); });

describe("evaluateSync", () => {
  const expressions = [
    "n * 2 + 1",
    "user.name | toUpperCase()",
    "items | filter(i => i.on) | map(i => i.id)",
    "let k = n in k * k",
    "n > 3 ? 'big' : 'small'",
    "[1, 2, 3] | reduce((a, b) => a + b, 0)",
    "user?.missing ?? 'none'",
    "{ a: n }",
  ];

  it.each(expressions)("returns what evaluate returns: %s", async (expression) => {
    expect(engine.evaluateSync(expression, context)).toEqual(await engine.evaluate(expression, context));
  });

  it("accepts a parsed Expression and runs on the synchronous path", () => {
    expect(engine.evaluateSync(engine.parse("n + 1"), context)).toBe(5);
    expect(evaluateAsync).not.toHaveBeenCalled();
  });

  it("passes the host options", () => {
    const value = engine.derive({ filters: {} }).evaluateSync("n", context, { runtimeValues: {} });
    expect(value).toBe(4);
  });

  it("raises a syntax error as an ExpressionError located in the source", () => {
    expect(() => engine.evaluateSync("n +", context)).toThrow(ExpressionError);
    try { engine.evaluateSync("n +", context); } catch (error) { expect(codeOf(error)).toBe("TAV_SYNTAX"); }
  });

  it("raises a runtime error as the async method does", async () => {
    const strict = createEngine({ strict: true });
    const sync = (() => { try { strict.evaluateSync("nope", {}); } catch (error) { return error; } })();
    const async = await strict.evaluate("nope", {}).catch((error: unknown) => error);
    expect(sync).toBeInstanceOf(ExpressionError);
    expect((sync as ExpressionError).errors).toEqual((async as ExpressionError).errors);
  });

  it("validates the context at the boundary", () => {
    expect(() => engine.evaluateSync("a", { a: () => 1 } as unknown as DataContext)).toThrow(ExpressionError);
  });

  it("throws TAV_ASYNC_REQUIRED naming the Resolver root", () => {
    const state = resolve(async () => 1);
    try {
      engine.evaluateSync("state.x", { state });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe("TAV_ASYNC_REQUIRED");
      expect((error as ExpressionError).message).toBe("Resolver 'state' requires async evaluation; evaluateSync() cannot wait for it, use evaluate()");
    }
  });

  it("does not refuse a Resolver that nothing reads", () => {
    const state = resolve(async () => 1);
    expect(engine.evaluateSync("false && state.x", { state })).toBe(false);
    expect(engine.evaluateSync("true || state.x", { state })).toBe(true);
    expect(engine.renderSync("${{ false && state.x }}", { state })).toBe("false");
    expect(engine.renderObjectSync({ a: "${{ false && state.x }}" }, { state })).toEqual({ a: false });
  });

  it("reads a Resolver's staticValues synchronously", () => {
    const state = resolve(async () => 1, { x: 7 });
    expect(engine.evaluateSync("state.x", { state })).toBe(7);
    expect(engine.evaluateSync("state['x']", { state })).toBe(7);
    try {
      engine.evaluateSync("state.y", { state });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe("TAV_ASYNC_REQUIRED");
      expect((error as ExpressionError).message).toContain("Resolver 'state'");
    }
  });

  it("refuses a Resolver returned whole", () => {
    try {
      engine.evaluateSync("state", { state: resolve(async () => 1) });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe("TAV_ASYNC_REQUIRED");
    }
  });

  it("throws TAV_ASYNC_REQUIRED naming an async filter", () => {
    const slow = createEngine({ filters: { slow: async (v: Value): Promise<Value> => v } });
    try {
      slow.evaluateSync("n | slow()", { n: 1 });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe("TAV_ASYNC_REQUIRED");
      expect((error as ExpressionError).message).toBe("Filter 'slow' is async; evaluateSync() cannot wait for it, use evaluate()");
    }
  });

  it("still runs a custom synchronous filter", () => {
    const sync = createEngine({ filters: { twice: (v: Value): Value => (v as number) * 2 } });
    expect(sync.evaluateSync("n | twice()", { n: 2 })).toBe(4);
  });
});

describe("renderSync", () => {
  const templates = [
    "Hello ${{ user.name }}!",
    "${% for i in items %}${% if i.on %}${{ i.id }},${% endif %}${% endfor %}",
    "${% if n > 9 %}big${% elif n > 3 %}mid${% else %}small${% endif %}",
    "no spans",
    "${% for x in nulls %}[${{ x }}]${% endfor %}",
    "${{ items | size }} items, first ${{ items[0].id }}",
    "${% for t in user.tags %}${{ forloop.index1 }}/${{ forloop.length }} ${{ t }} ${% endfor %}",
  ];

  it.each(templates)("returns what render returns: %s", async (template) => {
    expect(engine.renderSync(template, context)).toBe(await engine.render(template, context));
  });

  it("never takes the async path", () => {
    engine.renderSync("${% for i in items %}${{ i.id }}${% endfor %}", context);
    expect(evaluateAsync).not.toHaveBeenCalled();
  });

  it("locates an error in the template", async () => {
    const strict = createEngine({ strict: true });
    const template = "line\nab ${{ nope }}";
    const sync = (() => { try { strict.renderSync(template, {}); } catch (error) { return error; } })();
    const async = await strict.render(template, {}).catch((error: unknown) => error);
    expect((sync as ExpressionError).errors).toEqual((async as ExpressionError).errors);
    expect((sync as ExpressionError).errors[0]?.location?.start).toEqual({ line: 2, column: 8 });
  });

  it("honours maxOutputBytes and maxIterations as render does", () => {
    expect(() => createEngine({ maxOutputBytes: 4 }).renderSync("12345")).toThrow(ExpressionError);
    expect(() => createEngine({ maxIterations: 2 }).renderSync("${% for i in items %}x${% endfor %}", context)).toThrow(ExpressionError);
    expect(() => engine.renderSync("${% for i in n %}x${% endfor %}", context)).toThrow("The 'for' iterable must be an array");
  });

  it("throws TAV_ASYNC_REQUIRED with a position in the template", () => {
    const state = resolve(async () => 1);
    try {
      engine.renderSync("a ${{ state.x }}", { state });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe("TAV_ASYNC_REQUIRED");
      expect((error as ExpressionError).message).toContain("renderSync() cannot wait for it, use render()");
      expect((error as ExpressionError).errors[0]?.location?.source).toBe("a ${{ state.x }}");
    }
  });
});

describe("renderObjectSync", () => {
  const trees: Value[] = [
    { name: "${{ user.name }}", count: "${{ items | size }}" },
    { list: ["${{ n }}", "x ${{ n }}", { $if: "${{ n > 3 }}", v: 1 }] },
    { ok: { $if: "${{ n > 9 }}", v: 1 }, ...{} },
    { rows: { $: "${{ items }}" } },
    "plain ${{ n }} text",
    "${{ items | map(i => i.id) }}",
    { "k-${{ n }}": "v", $x: 1 },
  ];

  it.each(trees)("returns what renderObject returns: %j", async (tree) => {
    expect(engine.renderObjectSync(tree, context)).toEqual(await engine.renderObject(tree, context));
  });

  it("accepts a compiled ValueTemplate", () => {
    const template = engine.parseValueTemplate({ a: "${{ n }}" });
    expect(engine.renderObjectSync(template, context)).toEqual({ a: 4 });
    expect(evaluateAsync).not.toHaveBeenCalled();
  });

  it("throws TAV_ASYNC_REQUIRED with the path of the failing node", () => {
    const state = resolve(async () => 1);
    try {
      engine.renderObjectSync({ a: { b: "${{ state.x }}" } }, { state });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe("TAV_ASYNC_REQUIRED");
      expect((error as ExpressionError).errors[0]?.path).toEqual(["a", "b"]);
      expect((error as ExpressionError).message).toContain("use renderObject()");
    }
  });
});

describe("renderObject with a compiled tree", () => {
  it("accepts a ValueTemplate and the host options", async () => {
    const template = engine.parseValueTemplate({ a: "${{ n }}" });
    await expect(engine.renderObject(template, context)).resolves.toEqual({ a: 4 });
    const host = engine.derive({});
    await expect(host.renderObject({ a: "${{ n }}" }, context, { runtimeValues: {} })).resolves.toEqual({ a: 4 });
  });
});
