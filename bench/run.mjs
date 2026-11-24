#!/usr/bin/env node
// Layer 2 of docs/performance.md: run the corpus against a build.
// Usage: node bench/run.mjs [--dist <dir>] [--time <ms>] [--filter <text>] [--once] [--json <file>]
//   --once  print {"<group> / <name>": {meanNs, rme}} as JSON on stdout (the worker of noise.mjs and ab.mjs)
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bench } from "tinybench";
import { buildCorpus } from "./corpus.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dist = path.resolve(process.env.TAVNIT_DIST ?? flag("--dist", fileURLToPath(new URL("../dist", import.meta.url))));
const time = Number(flag("--time", 200));
const filter = flag("--filter", "");

// TAVNIT_BENCH_SKIP: comma-separated texts; a case whose name contains one is left out. A comparison against a
// build that lacks a feature the corpus measures (a pathological case would run for a minute) skips its group.
const skip = (process.env.TAVNIT_BENCH_SKIP ?? "").split(",").filter(Boolean);
const corpus = (await buildCorpus(dist)).filter((c) => {
  const name = `${c.group} / ${c.name}`;
  return name.includes(filter) && !skip.some((s) => name.includes(s));
});
const bench = new Bench({ time, warmupTime: Math.max(50, time / 2), warmupIterations: 5, iterations: 10 });
for (const c of corpus) bench.add(`${c.group} / ${c.name}`, c.fn);
await bench.run();

const result = {};
for (const task of bench.tasks) {
  const latency = task.result?.latency;
  if (!latency) throw new Error(`no result for ${task.name}: ${task.result?.error?.message ?? task.result?.state}`);
  result[task.name] = { meanNs: latency.mean * 1e6, rme: latency.rme };
}

if (args.includes("--once")) {
  process.stdout.write(JSON.stringify(result));
} else {
  const env = {
    node: process.version,
    v8: process.versions.v8,
    temporal: typeof globalThis.Temporal === "object" ? "native" : "polyfill",
    cpu: os.cpus()[0]?.model,
    platform: `${process.platform}-${process.arch}`,
  };
  console.log(JSON.stringify(env));
  console.table(Object.fromEntries(Object.entries(result).map(([name, r]) => [name, { "mean (µs)": +(r.meanNs / 1000).toFixed(2), "±rme %": +r.rme.toFixed(1) }])));
  const out = flag("--json", null);
  if (out) writeFileSync(out, JSON.stringify({ env, result }, null, 2));
}
