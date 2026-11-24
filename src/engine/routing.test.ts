import { beforeEach, describe, expect, it, vi } from "vitest";
import * as evaluator from "../evaluator/evaluate.js";
import { contextFilter, resolve, synchronousFilter } from "../evaluator/types.js";
import { createEngine } from "./engine.js";
import type { Value } from "./types.js";

// Count the expressions the engine sends down the async path.
vi.mock("../evaluator/evaluate.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../evaluator/evaluate.js")>();
  return { ...original, evaluateAsync: vi.fn(original.evaluateAsync) };
});

const evaluateAsync = vi.mocked(evaluator.evaluateAsync);
const state = resolve(async (key) => (key === "y" ? 2 : null));

describe("Resolver routing", () => {
  beforeEach(() => { evaluateAsync.mockClear(); });

  it("evaluates synchronously an expression that names no Resolver and no custom filter", async () => {
    const engine = createEngine();
    await expect(engine.evaluate("[1, 2] | map((n) => n + x)", { x: 1, state })).resolves.toEqual([2, 3]);
    expect(evaluateAsync).not.toHaveBeenCalled();
  });

  it("evaluates asynchronously an expression that names a Resolver", async () => {
    const engine = createEngine();
    await expect(engine.evaluate("[1] | map((n) => n + state.y)", { state })).resolves.toEqual([3]);
    expect(evaluateAsync).toHaveBeenCalledOnce();
  });

  it("evaluates asynchronously an expression that names a custom filter while a Resolver is present", async () => {
    const twice = async (v: Value): Promise<Value> => (v as number) * 2;
    const engine = createEngine({ filters: { twice } });
    await expect(engine.evaluate("x | twice()", { x: 4, state })).resolves.toBe(8);
    await expect(engine.evaluate("[1] | map(twice)", { state })).resolves.toEqual([2]);
    expect(evaluateAsync).toHaveBeenCalledTimes(2);
  });

  it("retries a marked host filter only for calls that need the async path", async () => {
    let asynchronous = true;
    const twice = synchronousFilter(contextFilter((_ctx, value: Value) =>
      asynchronous ? Promise.resolve((value as number) * 2) : (value as number) * 2));
    const engine = createEngine({ filters: { twice } });
    await expect(engine.evaluate("twice(x)", { x: 4, state })).resolves.toBe(8);
    asynchronous = false;
    await expect(engine.evaluate("twice(x)", { x: 4, state })).resolves.toBe(8);
    expect(evaluateAsync).toHaveBeenCalledOnce();
  });

  it("remembers a Resolver read even when a marked filter runs before it", async () => {
    let calls = 0;
    const twice = synchronousFilter(contextFilter((_ctx, value: Value) => { calls++; return (value as number) * 2; }));
    const engine = createEngine({ filters: { twice } });
    const expression = engine.parse("twice(x) + state.y");
    await expect(engine.evaluate(expression, { x: 2, state })).resolves.toBe(6);
    await expect(engine.evaluate(expression, { x: 2, state })).resolves.toBe(6);
    expect(calls).toBe(3);
    expect(evaluateAsync).toHaveBeenCalledTimes(2);
  });

  it("counts a custom filter that shadows a built-in as custom", async () => {
    const upcase = async (v: Value): Promise<Value> => `<${String(v)}>`;
    const engine = createEngine({ filters: { upcase } });
    await expect(engine.evaluate("upcase('a')", { state })).resolves.toBe("<a>");
    expect(evaluateAsync).toHaveBeenCalledOnce();
  });

  it("routes each leaf of a value template on its own", async () => {
    const engine = createEngine();
    await expect(engine.evaluate(engine.parse({ a: "${{ x }}", b: "${{ state.y }}" }), { x: 1, state }))
      .resolves.toEqual({ a: 1, b: 2 });
    expect(evaluateAsync).toHaveBeenCalledOnce();
  });

  it("remembers the node that met a Resolver and sends it down the async path from then on", async () => {
    const reads: string[] = [];
    const counted = resolve(async (key) => { reads.push(key); return 2; });
    const engine = createEngine();
    const expr = engine.parse("1 + counted.y");
    await expect(engine.evaluate(expr, { counted })).resolves.toBe(3);
    await expect(engine.evaluate(expr, { counted })).resolves.toBe(3);
    // The sync trial of the first call stops at the Resolver without reading it: one read per call.
    expect(reads).toEqual(["y", "y"]);
    // Only the first call tried the sync path; the second went straight to the async one.
    expect(evaluateAsync).toHaveBeenCalledTimes(2);
  });

  it("spends the budget once when the sync trial is repeated on the async path", async () => {
    const engine = createEngine({ maxSteps: 12 });
    // Six nodes before the Resolver and six after: the trial's steps would exceed the limit unless they were given back.
    await expect(engine.evaluate("(1 + 2 + 3) + state.y + (4 + 5)", { state })).resolves.toBe(17);
  });

  it("never runs a custom filter on a trial path: it runs once even when a Resolver follows it", async () => {
    let calls = 0;
    const tap = (v: Value): Value => { calls++; return v; };
    const engine = createEngine({ filters: { tap } });
    await expect(engine.evaluate("(1 | tap()) + state.y", { state })).resolves.toBe(3);
    expect(calls).toBe(1);
  });
});
