import { describe, expect, it } from "vitest";
import { resolve } from "../evaluator/types.js";
import { createEngine } from "./engine.js";
import type { ExpressionError, Value } from "./types.js";

function numbers(count: number): Value[] {
  return Array.from({ length: count }, (_, i) => i);
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Busy-wait: the synchronous stall a loaded machine or a slow filter causes. */
function stall(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* wait */ }
}

describe("default budgets", () => {
  const engine = createEngine();

  it("passes a map over 100 000 items", async () => {
    const result = await engine.evaluate("a | map(x => x + 1) | size", { a: numbers(100_000) });
    expect(result).toBe(100_000);
  });

  it("passes a filter, map and sort chain over 100 000 items", async () => {
    const result = await engine.evaluate("a | filter(x => x % 2 == 0) | map(x => x * 2) | sort(x => x) | size", { a: numbers(100_000) });
    expect(result).toBe(50_000);
  });

  it("passes a 200 x 200 nested loop", async () => {
    const rows = numbers(200);
    const text = await engine.render("${% for r in rows %}${% for c in rows %}.${% endfor %}${% endfor %}", { rows });
    expect(text).toHaveLength(40_000);
  });

  it("states its defaults", async () => {
    const error = await engine.evaluate("a | map(x => x)", { a: numbers(1_000_001) }).catch((e: ExpressionError) => e);
    expect((error as ExpressionError).errors[0]).toMatchObject({ code: "TAV_LIMIT_ITERATIONS", value: 1_000_000, option: "maxIterations" });
  });
});

describe("the unit of maxIterations is the engine call", () => {
  it("shares one budget across the pipe steps of an expression", async () => {
    const engine = createEngine({ maxIterations: 150 });
    await expect(engine.evaluate("a | map(x => x) | filter(x => true)", { a: numbers(100) })).rejects.toThrow("Iteration limit 150 exceeded");
    expect(await engine.evaluate("a | map(x => x)", { a: numbers(100) })).toHaveLength(100);
  });

  it("shares one budget across the spans and loops of a render", async () => {
    const engine = createEngine({ maxIterations: 10 });
    const context = { a: numbers(6) };
    expect(await engine.render("${{ a | size }}${{ a | map(x => x) | size }}", context)).toBe("66");
    await expect(engine.render("${{ a | map(x => x) | size }}${{ a | map(x => x) | size }}", context)).rejects.toThrow("Iteration limit 10 exceeded");
    await expect(engine.render("${% for x in a %}${% endfor %}${{ a | map(x => x) | size }}", context)).rejects.toThrow("Iteration limit 10 exceeded");
  });

  it("shares one budget across the leaves of a value tree", async () => {
    const engine = createEngine({ maxIterations: 10 });
    const tree = { x: "${{ a | map(v => v) | size }}", y: "${{ a | map(v => v) | size }}" };
    await expect(engine.renderObject(tree, { a: numbers(6) })).rejects.toThrow("Iteration limit 10 exceeded");
  });

  it("starts a fresh budget for each call", async () => {
    const engine = createEngine({ maxIterations: 10 });
    for (let call = 0; call < 3; call++) {
      expect(await engine.evaluate("a | map(x => x) | size", { a: numbers(8) })).toBe(8);
    }
  });
});

describe("maxSteps is a deterministic budget", () => {
  it("counts expression nodes exactly", async () => {
    // `1 + 2` visits three nodes: the sum and its two literals.
    expect(await createEngine({ maxSteps: 3 }).evaluate("1 + 2")).toBe(3);
    await expect(createEngine({ maxSteps: 2 }).evaluate("1 + 2")).rejects.toThrow("Step limit 2 exceeded; raise maxSteps");
  });

  it("stops the same expression at the same point every time", async () => {
    const engine = createEngine({ maxSteps: 250 });
    const outcomes = new Set<string>();
    for (let run = 0; run < 5; run++) {
      const outcome = await engine.evaluate("a | map(x => x + 1) | size", { a: numbers(100) }).then(String, (e: ExpressionError) => e.message);
      outcomes.add(outcome);
    }
    expect([...outcomes]).toEqual(["Step limit 250 exceeded; raise maxSteps"]);
  });

  it("bounds an expression with no collection in it", async () => {
    const engine = createEngine({ maxSteps: 100 });
    const long = `[${Array.from({ length: 200 }, () => "1").join(", ")}]`;
    await expect(engine.evaluate(long)).rejects.toThrow("Step limit 100 exceeded");
  });

  it("is shared by the spans of a render and by derive()", async () => {
    const engine = createEngine({ maxSteps: 5 });
    expect(await engine.render("${{ 1 + 2 }}", {})).toBe("3");
    await expect(engine.render("${{ 1 + 2 }}${{ 1 + 2 }}", {})).rejects.toThrow("Step limit 5 exceeded");
    expect(await engine.derive({ maxSteps: 100 }).render("${{ 1 + 2 }}${{ 1 + 2 }}", {})).toBe("33");
    await expect(engine.derive().evaluate("1 + 2 + 3 + 4")).rejects.toThrow("Step limit 5 exceeded");
  });

  it("counts steps on the async path too", async () => {
    const engine = createEngine({ maxSteps: 4 });
    await expect(engine.evaluate("[state.x, 1 + 2]", { state: resolve(async () => 1) })).rejects.toThrow("Step limit 4 exceeded");
  });

  it("rejects a value that is not a positive integer", () => {
    expect(() => createEngine({ maxSteps: 0 })).toThrow(RangeError);
    expect(() => createEngine().derive({ maxSteps: 1.5 })).toThrow("maxSteps must be a positive finite integer, got 1.5");
  });
});

describe("timeoutMs is an opt-in guard", () => {
  const slowFilter = { slow: (value: Value): Value => { stall(120); return value; } };

  it("is off by default: the same template gives the same result under artificial delay", async () => {
    const engine = createEngine({ filters: slowFilter });
    const template = "${{ slow(1) + slow(2) }}-${{ [1, 2, 3] | map(x => x * 2) | join(',') }}";
    const idle = await createEngine().render("${{ 1 + 2 }}-${{ [1, 2, 3] | map(x => x * 2) | join(',') }}", {});
    expect(idle).toBe("3-2,4,6");
    for (let run = 0; run < 3; run++) {
      expect(await engine.render(template, {})).toBe("3-2,4,6");
    }
  });

  it("is not affected by a slow async filter or resolver", async () => {
    const engine = createEngine({ filters: { wait: async (value: Value) => { await sleep(150); return value; } } });
    const state = resolve(async () => { await sleep(150); return 7; });
    expect(await engine.evaluate("wait(state.x) + 1", { state })).toBe(8);
  });

  // The clock is read at the first node and then every 256 nodes, so a stall is seen by the next sample.
  const afterStall = `slow(1) + size([${Array.from({ length: 600 }, () => "1").join(", ")}])`;

  it("raises when the host sets it and the call overruns", async () => {
    const engine = createEngine({ timeoutMs: 20, filters: slowFilter });
    await expect(engine.evaluate(afterStall)).rejects.toThrow("Evaluation timed out after 20 ms; raise timeoutMs");
  });

  it("is inherited by derive() and overridden by it", async () => {
    const guarded = createEngine({ timeoutMs: 20, filters: slowFilter });
    await expect(guarded.derive().evaluate(afterStall)).rejects.toThrow("timed out");
    expect(await guarded.derive({ timeoutMs: 5_000 }).evaluate(afterStall)).toBe(601);
  });
});
