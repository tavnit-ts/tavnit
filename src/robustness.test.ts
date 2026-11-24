// Hostile input: every case ends in a clear ExpressionError, quickly, and never in a JS resource error.
import { describe, expect, it } from "vitest";
import { isBacktrackingRisk } from "./builtins/regex.js";
import { createEngine } from "./engine/engine.js";
import { ExpressionError } from "./engine/types.js";

const engine = createEngine({ timeoutMs: 5000, maxIterations: 1e6 });
const native = createEngine({ timeoutMs: 5000, maxIterations: 1e6, regex: "native" });

async function failure(source: string, data = {}, via = engine): Promise<string> {
  try {
    await via.evaluate(source, data);
  } catch (e) {
    expect(e).toBeInstanceOf(ExpressionError);
    return (e as ExpressionError).message;
  }
  throw new Error("expected a failure");
}

describe("regular expressions", () => {
  it("native mode refuses a repeated group with an alternation, at once", async () => {
    const started = performance.now();
    expect(await failure("s | matches('(a|aa)+$')", { s: `${"a".repeat(41)}!` }, native)).toMatch(/unsafe regular expression/);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it.each([
    ["(a|aa)+$", true], ["(a|b)*", true], ["(a?)*", true], ["(a)\\1+", false], ["(a\\1)+", true], ["(?<x>a)\\k<x>*", false],
    ["((a|b))+", true], ["(a|b)", false], ["a)+", false], ["(a|b))", false], ["(a|b)?", false], ["(?=a)b+", false], ["(a+?)*", true], ["(a|b){2}", false], ["((ab)+c)?d", false],
    ["[(|]+", false], ["\\(a|b\\)+", false], ["(?:ab)+c", false], ["a|b+", false], ["(a|b){2,}", true],
  ])("%s -> risk %s", (pattern, risk) => {
    expect(isBacktrackingRisk(pattern)).toBe(risk);
  });

  it("keeps ordinary patterns working", async () => {
    expect(await engine.evaluate("'ab12' | matches('^[a-z]+\\\\d+$')", {})).toBe(true);
    expect(await engine.evaluate("'2026-11-07' | capture('(\\\\d+)-(\\\\d+)', 2)", {})).toBe("11");
    expect(await engine.evaluate("'x' | matches('(?:foo|bar)')", {})).toBe(false);
  });

  it.each(["matches('a')", "capture('a', 1)", "captures('a')"])("native mode: %s refuses a subject over 100000 characters", async (call) => {
    expect(await failure(`s | ${call}`, { s: "a".repeat(100_001) }, native)).toMatch(/subject is longer than 100000/);
    await native.evaluate(`s | ${call}`, { s: "a".repeat(100_000) });
  });

  it.each(["(a|aa)+$", "^(a+)+$", "(a*)*b", "(a|a)*c"])("linear mode: %s on a near miss answers at once", async (pattern) => {
    const started = performance.now();
    expect(await engine.evaluate(`s | matches('${pattern}')`, { s: `${"a".repeat(41)}!` })).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("linear mode: a million-character subject is not refused", async () => {
    const subject = `${"y".repeat(1_000_000)}x`;
    expect(await engine.evaluate("s | matches('.*x.*')", { s: subject })).toBe(true);
    expect(await engine.evaluate("s | capture('(y+)x', 1) | size", { s: subject })).toBe(1_000_000);
    expect(await engine.evaluate("s | captures('(x)')", { s: subject })).toEqual(["x"]);
  });
});

describe("parse depth", () => {
  it.each([
    ["parentheses", `${"(".repeat(5000)}1${")".repeat(5000)}`],
    ["arrays", `${"[".repeat(5000)}${"]".repeat(5000)}`],
    ["unary", `${"!".repeat(100_000)}true`],
    ["a long chain", `1${"+1".repeat(100_000)}`],
    ["a long pipe", `1${" | abs".repeat(50_000)}`],
    ["member chain", `a${".b".repeat(100_000)}`],
    ["ternaries", `${"true?".repeat(20_000)}1${":2".repeat(20_000)}`],
  ])("%s fail with the depth message", async (_name, source) => {
    expect(await failure(source)).toMatch(/nested deeper than 500 levels/);
  });

  it("accepts nesting just below the limit", async () => {
    expect(await engine.evaluate(`${"(".repeat(100)}1${")".repeat(100)}`, {})).toBe(1);
  });
});

describe("string size", () => {
  it.each([
    "'x' | padStart(500000000)",
    "'x' | padEnd(500000000)",
    "'x' | padEnd(1e9)".replace("1e9", "1000000000"),
    "'x' | indent(100000000)",
    "'a\\nb\\nc' | indent(5000000)",
    "s | replaceAll('x', 'yy')",
    "s | replace('x', s)",
    "s | append(s)",
    "[s, s] | join(',')",
    "[s, s] | joinFilled(',')",
  ])("%s fails with a size message", async (source) => {
    expect(await failure(source, { s: "x".repeat(6_000_000) })).toMatch(/exceeds 10000000 characters/);
  });

  it("maps the JS string-length error", async () => {
    const wide = createEngine({ filters: { boom: () => { throw new RangeError("Invalid string length"); } } });
    await expect(wide.evaluate("boom()", {})).rejects.toThrow("String result is too long");
  });

  it("maps a stack overflow", async () => {
    const deep = createEngine({ filters: { boom: () => { throw new RangeError("Maximum call stack size exceeded"); } } });
    await expect(deep.evaluate("boom()", {})).rejects.toThrow("Expression or data nested too deeply");
  });

  it("keeps other RangeErrors as they are", async () => {
    const other = createEngine({ filters: { boom: () => { throw new RangeError("elsewhere"); } } });
    await expect(other.evaluate("boom()", {})).rejects.toThrow("elsewhere");
  });
});
