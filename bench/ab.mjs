#!/usr/bin/env node
// Layer 3 of docs/performance.md: compare two builds on one machine, alternating.
// Usage: node bench/ab.mjs <distA> <distB> [--rounds 9] [--time 200] [--round-timeout 180] [--json out.json]
//        [--warn-over 10] [--fail-over 25] [--enforce] [--markdown report.md]
// A is the base, B the head. A case is judged on the MEDIAN of its per-round deltas (docs/performance.md):
// slower than --fail-over percent fails, slower than --warn-over warns. The exit code is 1 only with --enforce.
// Each round runs A then B (B then A on odd rounds) in fresh processes and takes the ratio B / A.
// With the same build for both sides this is the A/A run: it measures the noise of the gate.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const [distA, distB] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")).map((d) => path.resolve(d));
const rounds = Number(flag("--rounds", 9));
const warnOver = Number(flag("--warn-over", 10));
const failOver = Number(flag("--fail-over", 25));
const script = fileURLToPath(new URL("./run.mjs", import.meta.url));
const time = flag("--time", "200");

const measure = (dist) => {
  const child = spawnSync(process.execPath, [script, "--once", "--time", time], {
    encoding: "utf8",
    env: { ...process.env, TAVNIT_DIST: dist },
    // One pathological case in a build that lacks a fix (a ReDoS runs for a minute per iteration) must fail the
    // round, not hang the job. A round takes about 10 s.
    timeout: Number(flag("--round-timeout", 180)) * 1000,
  });
  if (child.error?.code === "ETIMEDOUT") throw new Error(`a round on ${dist} took longer than the round timeout; skip the case with TAVNIT_BENCH_SKIP`);
  if (child.status !== 0) throw new Error(child.stderr);
  return JSON.parse(child.stdout);
};

const ratios = {};
for (let round = 0; round < rounds; round++) {
  const first = round % 2 === 0 ? "A" : "B";
  const runs = {};
  for (const side of first === "A" ? ["A", "B"] : ["B", "A"]) runs[side] = measure(side === "A" ? distA : distB);
  for (const name of Object.keys(runs.A)) {
    ratios[name] ??= [];
    ratios[name].push(runs.B[name].meanNs / runs.A[name].meanNs);
  }
}

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const pct = (r) => +((r - 1) * 100).toFixed(1);
const report = {};
for (const [name, xs] of Object.entries(ratios)) {
  const s = sorted(xs);
  const median = pct(s[Math.floor(s.length / 2)]);
  report[name] = {
    medianDeltaPercent: median,
    minDeltaPercent: pct(s[0]),
    maxDeltaPercent: pct(s[s.length - 1]),
    roundsOver10: xs.filter((r) => Math.abs(r - 1) > 0.1).length,
    roundsOver25: xs.filter((r) => Math.abs(r - 1) > 0.25).length,
    status: median > failOver ? "fail" : median > warnOver ? "warn" : median < -warnOver ? "faster" : "ok",
  };
}
const env = { node: process.version, cpu: os.cpus()[0]?.model, platform: `${process.platform}-${process.arch}`, rounds, warnOver, failOver };
console.log(JSON.stringify(env));
console.table(report);

const count = (status) => Object.values(report).filter((r) => r.status === status).length;
const failed = count("fail");
if (flag("--markdown", null)) {
  const icon = { fail: "🔴", warn: "🟡", faster: "🟢", ok: "" };
  const rows = Object.entries(report).filter(([, r]) => r.status !== "ok");
  const lines = [
    "<!-- tavnit-bench -->",
    "### Tavnit benchmark: head against base",
    "",
    `${Object.keys(report).length} cases, ${rounds} alternating rounds, median delta. ` +
      `🔴 ${failed} slower than ${failOver}%, 🟡 ${count("warn")} slower than ${warnOver}%, 🟢 ${count("faster")} faster than ${warnOver}%.`,
    `${env.node}, ${env.cpu}. Noise of the paired median is under 1%; a single round can reach 50%.`,
    "",
  ];
  if (rows.length > 0) {
    lines.push("| Case | Median | Min | Max | Rounds >10% | |", "|---|---|---|---|---|---|");
    for (const [name, r] of rows) {
      lines.push(`| ${name} | ${r.medianDeltaPercent}% | ${r.minDeltaPercent}% | ${r.maxDeltaPercent}% | ${r.roundsOver10} | ${icon[r.status]} |`);
    }
  } else {
    lines.push("No case moved by more than the warn threshold.");
  }
  writeFileSync(flag("--markdown"), `${lines.join("\n")}\n`);
}
const out = flag("--json", null);
if (out) writeFileSync(out, JSON.stringify({ env, report, ratios }, null, 2));
if (args.includes("--enforce") && failed > 0) {
  console.error(`${failed} case(s) slower than ${failOver}% in the median of ${rounds} rounds`);
  process.exit(1);
}
