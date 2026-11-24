// Structural performance counters: tests that assert the work Tavnit does, never the time it
// takes, so they cannot flake. Each guards one optimisation recorded in
// docs/performance.md; reverting the optimisation must fail exactly its test.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCache } from "./engine/cache.js";
import { createEngine } from "./engine/engine.js";
import { contextFilter, isContextFilter, resolve } from "./evaluator/types.js";

afterEach(() => { vi.restoreAllMocks(); });

const ITEMS = Array.from({ length: 5000 }, (_, i) => i);
// ~3 nodes per item: one clock read per 256 nodes is about 60 reads. Reading per node would
// be 15,000. The bound sits between, with room for a change of node count.
const MAX_CLOCK_READS = 200;
// The tests count clock reads, not time: a slow machine must not trip the default timeout.
const NO_TIMEOUT = 600_000;

describe("sampled timeout clock", () => {
  it("reads the clock about once per 256 nodes on the sync path", async () => {
    const engine = createEngine({ maxIterations: 100_000, timeoutMs: NO_TIMEOUT });
    const now = vi.spyOn(Date, "now");
    await engine.evaluate("items | map(x => x + 1) | size", { items: ITEMS });
    expect(now.mock.calls.length).toBeLessThan(MAX_CLOCK_READS);
  });

  // The async path also reads the clock after each awaited Resolver, so the expression awaits one.
  it("reads the clock about once per 256 nodes on the async path", async () => {
    const engine = createEngine({ maxIterations: 100_000, timeoutMs: NO_TIMEOUT });
    const state = resolve(async () => 1);
    const now = vi.spyOn(Date, "now");
    await engine.evaluate("(items | map(x => x + 1) | size) + state.y", { items: ITEMS, state });
    expect(now.mock.calls.length).toBeLessThan(MAX_CLOCK_READS);
  });
});

describe("compile once", () => {
  it("compiles an expression source once however often it is evaluated", async () => {
    const cache = createCache();
    const engine = createEngine({ cache });
    for (let i = 0; i < 100; i++) await engine.evaluate("a + b * 2", { a: i, b: 1 });
    expect(cache.metrics().expressions.misses).toBe(1);
  });

  it("compiles a text template once, with each expression in it", async () => {
    const cache = createCache();
    const engine = createEngine({ cache });
    for (let i = 0; i < 50; i++) await engine.render("Hello ${{ name }}, ${{ n + 1 }}", { name: "x", n: i });
    expect(cache.metrics().textTemplates.misses).toBe(1);
    expect(cache.metrics().expressions.misses).toBe(2);
  });

  it("compiles a value tree once per identity and reuses its strings in a fresh tree", async () => {
    const cache = createCache();
    const engine = createEngine({ cache });
    const tree = { a: "${{ x }}", b: ["${{ x + 1 }}", "text ${{ x }}"] };
    for (let i = 0; i < 50; i++) await engine.evaluate(engine.parseValueTemplate(tree), { x: i });
    expect(cache.metrics().valueTemplates).toEqual({ hits: 49, misses: 1 });
    const strings = cache.metrics().textTemplates.misses;
    for (let i = 0; i < 20; i++) engine.parse({ a: "${{ x }}", b: ["${{ x + 1 }}", "text ${{ x }}"] });
    expect(cache.metrics().textTemplates.misses).toBe(strings);
  });
});

describe("Intl formatter cache", () => {
  const formatAt = (zone: string, hour: number) =>
    `instant("2026-09-26T${String(hour).padStart(2, "0")}:34:00Z") | toZonedDateTime("${zone}") | formatCalendar(instant("2026-09-26T23:00:00Z"), "ru")`;

  it("constructs a formatter per locale, zone and part, not per call", async () => {
    const engine = createEngine();
    // A zone no other test uses, so the module-level cache starts empty for it.
    const zone = "America/Argentina/Ushuaia";
    const construct = vi.spyOn(Intl, "DateTimeFormat");
    for (let hour = 0; hour < 20; hour++) await engine.evaluate(formatAt(zone, hour), {});
    const first = construct.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    // Every call is «today», so one part (time) is built once for the whole batch.
    expect(first).toBeLessThanOrEqual(2);
    for (let hour = 0; hour < 20; hour++) await engine.evaluate(formatAt(zone, hour), {});
    expect(construct.mock.calls.length).toBe(first);
  });
});

describe("no scope copies", () => {
  it("nested lambdas read the data context in place, never enumerate or copy it", async () => {
    const engine = createEngine();
    let enumerations = 0;
    const data = new Proxy({ rows: [[1, 2], [3, 4]], k: 10 }, {
      ownKeys(target) { enumerations++; return Reflect.ownKeys(target); },
    });
    // The engine checks a context once, by identity, and that one pass enumerates it.
    await engine.evaluate("1", data);
    enumerations = 0;
    await expect(engine.evaluate("rows | map(r => r | map(x => x + k))", data)).resolves.toEqual([[11, 12], [13, 14]]);
    expect(enumerations).toBe(0);
  });
});

describe("benchmarks stay out of the package", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  it("keeps bench/ out of the published files", () => {
    const { files } = JSON.parse(read("package.json")) as { files: string[] };
    expect(files.filter((f) => f.includes("bench"))).toEqual([]);
  });

  it("compiles only src/, so no benchmark reaches dist or the coverage threshold", () => {
    const { include } = JSON.parse(read("tsconfig.json")) as { include: string[] };
    expect(include.every((glob) => glob.startsWith("src/"))).toBe(true);
    const names = readdirSync(new URL("./", import.meta.url), { recursive: true }) as string[];
    expect(names.filter((n) => /bench/i.test(n))).toEqual([]);
  });
});

describe("context filters", () => {
  it("carry no property: a mark on the function changes its hidden class and slows every filter call", () => {
    const filter = contextFilter((_ctx, value) => value);
    expect(isContextFilter(filter)).toBe(true);
    expect(Reflect.ownKeys(filter).sort()).toEqual(Reflect.ownKeys(() => 0).sort());
  });
});
