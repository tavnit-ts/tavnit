#!/usr/bin/env node
// Noise baseline (docs/performance.md): how much does one case move between runs of the same code?
// Usage: node bench/noise.mjs [--runs 30] [--time 200] [--dist <dir>] [--json out.json]
// Each run is a fresh process of run.mjs, so process-level variance (JIT, GC, scheduling) is included.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const runs = Number(flag("--runs", 30));
const worker = fileURLToPath(new URL("./run.mjs", import.meta.url));
const dist = path.resolve(flag("--dist", fileURLToPath(new URL("../dist", import.meta.url))));

const samples = {};
for (let i = 0; i < runs; i++) {
  const child = spawnSync(process.execPath, [worker, "--once", "--time", flag("--time", "200")], {
    encoding: "utf8",
    env: { ...process.env, TAVNIT_DIST: dist },
  });
  if (child.status !== 0) throw new Error(child.stderr);
  for (const [name, r] of Object.entries(JSON.parse(child.stdout))) {
    samples[name] ??= [];
    samples[name].push(r.meanNs);
  }
}

const env = {
  node: process.version,
  v8: process.versions.v8,
  temporal: typeof globalThis.Temporal === "object" ? "native" : "polyfill",
  cpu: os.cpus()[0]?.model,
  platform: `${process.platform}-${process.arch}`,
  runs,
};
const report = {};
for (const [name, xs] of Object.entries(samples)) {
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  report[name] = {
    "median (ns)": Math.round(sorted[Math.floor(xs.length / 2)]),
    "cv %": +((sd / mean) * 100).toFixed(1),
    "spread %": +(((sorted[sorted.length - 1] - sorted[0]) / sorted[Math.floor(xs.length / 2)]) * 100).toFixed(1),
  };
}
console.log(JSON.stringify(env));
console.table(report);
const out = flag("--json", null);
if (out) writeFileSync(out, JSON.stringify({ env, report, samples }, null, 2));
