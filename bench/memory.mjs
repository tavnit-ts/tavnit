#!/usr/bin/env node
// Layer 4 of docs/performance.md: memory that Tavnit retains, measured after a forced GC.
// Usage: node --expose-gc bench/memory.mjs [--dist <dir>] [--json out.json] [--enforce]
// A case fails when the heap it leaves behind grows past its bound. Bounds are set at about
// three times the first measurement (docs/performance.md); lower one when a change earns it.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (typeof globalThis.gc !== "function") {
  console.error("Run with: node --expose-gc bench/memory.mjs");
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dist = path.resolve(flag("--dist", fileURLToPath(new URL("../dist", import.meta.url))));
const { createCache, createEngine } = await import(pathToFileURL(`${dist}/index.js`).href);

const heap = () => {
  globalThis.gc();
  globalThis.gc();
  return process.memoryUsage().heapUsed;
};

/** Heap retained after `work` has run and its results are dropped. */
async function retained(work) {
  const before = heap();
  await work();
  return heap() - before;
}

const cards = Array.from({ length: 50 }, (_, i) => ({ id: i, title: `Card ${i}`, done: i % 3 === 0 }));
const screen = { rows: "${{ cards | map(c => _) }}", _: { key: "row-${{ c.id }}", text: "${{ c.title }}" } };

const cases = [
  {
    name: "1000 evaluations of one cached expression",
    boundBytes: 768 * 1024,
    run: async () => {
      const engine = createEngine();
      for (let i = 0; i < 1000; i++) await engine.evaluate("cards | filter(c => c.done) | map(c => c.id) | size", { cards });
    },
  },
  {
    name: "1000 evaluations of a 50-card tree",
    boundBytes: 384 * 1024,
    run: async () => {
      const engine = createEngine();
      const template = engine.parseValueTemplate(screen);
      for (let i = 0; i < 1000; i++) await engine.evaluate(template, { cards });
    },
  },
  {
    name: "100 evaluations of a 10,000-item map",
    boundBytes: 160 * 1024,
    run: async () => {
      const engine = createEngine({ maxIterations: 100_000 });
      const items = Array.from({ length: 10_000 }, (_, i) => i);
      for (let i = 0; i < 100; i++) await engine.evaluate("items | map(x => x * 2) | size", { items });
    },
  },
  {
    // The cache keeps every distinct source forever: this documents the cost per template.
    name: "cache after 5000 distinct expressions (kept: bound is the cache itself)",
    boundBytes: 12 * 1024 * 1024,
    run: async (keep) => {
      const cache = createCache();
      const engine = createEngine({ cache });
      for (let i = 0; i < 5000; i++) engine.parse(`a + ${i} * b - ${i}`);
      keep.push(cache);
    },
  },
  {
    // The cache has no bound of its own: this documents how it grows with distinct sources, through evaluate.
    name: "cache after 20000 distinct evaluated expressions (kept: bound is the cache itself)",
    boundBytes: 60 * 1024 * 1024,
    run: async (keep) => {
      const cache = createCache();
      const engine = createEngine({ cache });
      for (let i = 0; i < 20_000; i++) await engine.evaluate(`a + ${i} * b - ${i}`, { a: 1, b: 2 });
      keep.push(cache);
    },
  },
  {
    // A derived engine that is dropped must leave nothing behind.
    name: "10000 derive() calls with a filter each, engines dropped",
    boundBytes: 64 * 1024,
    run: async () => {
      const root = createEngine();
      for (let i = 0; i < 10_000; i++) {
        const child = root.derive({ filters: { twice: (v) => v * 2 } });
        await child.evaluate("x | twice()", { x: i });
      }
    },
  },
];

const keep = [];
const report = {};
let failed = 0;
for (const c of cases) {
  keep.length = 0;
  const bytes = await retained(() => c.run(keep));
  const ok = bytes <= c.boundBytes;
  if (!ok) failed++;
  report[c.name] = { "retained (KiB)": Math.round(bytes / 1024), "bound (KiB)": c.boundBytes / 1024, ok };
}
console.log(JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}` }));
console.table(report);
if (flag("--json", null)) writeFileSync(flag("--json"), JSON.stringify(report, null, 2));
if (args.includes("--enforce") && failed > 0) {
  console.error(`${failed} case(s) retained more than their bound`);
  process.exit(1);
}
