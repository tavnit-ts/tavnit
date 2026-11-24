import safeRegex from "safe-regex2";
import { codedError } from "../evaluator/errors.js";
import type { ContextFilterFn, EvalContext, LinearRegexEngine, Value } from "../evaluator/types.js";
import { contextFilter, EvaluationError, typeName } from "../evaluator/types.js";
import { ensureString, ensureStringArg } from "./args.js";

/**
 * `safe-regex2` bounds star height only. A group repeated without bound that holds an alternation
 * or another repeat (`(a|aa)+$`, `(a?)*`) backtracks exponentially on a near miss, and a
 * backreference inside one does the same, so those are refused as well.
 */
export function isBacktrackingRisk(pattern: string): boolean {
  // Per open group: does it hold `|`, a repeat, a backreference?
  const open: Array<{ alt: boolean; rep: boolean; ref: boolean }> = [];
  let inClass = false;
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "\\") {
      const top = open[open.length - 1];
      if (top && !inClass && /[1-9k]/.test(pattern.charAt(i + 1))) top.ref = true;
      i += 2;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      i++;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "(") open.push({ alt: false, rep: false, ref: false });
    else if (c === "|") {
      const top = open[open.length - 1];
      if (top) top.alt = true;
    } else if (c === ")") {
      const group = open.pop();
      // An unbalanced `)` is a syntax error that `new RegExp` reports.
      if (!group) return false;
      const rest = pattern.slice(i + 1);
      const unbounded = /^(?:[*+]|\{\d+,\})/.test(rest);
      if (unbounded && (group.alt || group.rep || group.ref)) return true;
      const parent = open[open.length - 1];
      if (parent) {
        parent.alt ||= group.alt;
        parent.rep ||= group.rep || /^(?:[*+?]|\{)/.test(rest);
        parent.ref ||= group.ref;
      }
    } else if (c === "*" || c === "+" || c === "{" || (c === "?" && pattern[i - 1] !== "(")) {
      const top = open[open.length - 1];
      if (top) top.rep = true;
    }
    i++;
  }
  return false;
}

function makeRegex(pattern: string, flags: string): RegExp {
  if (!safeRegex(pattern) || isBacktrackingRisk(pattern)) {
    throw new EvaluationError(`Potentially unsafe regular expression: ${pattern}`);
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw new EvaluationError(`Invalid regular expression: ${pattern}`);
  }
}

function checkRegexInput(ctx: EvalContext, str: string, name: string): void {
  const max = ctx.limits.maxRegexInput;
  if (str.length > max) {
    throw new EvaluationError(`${name}() subject is longer than ${max} characters`);
  }
}

/**
 * The linear engine of this evaluation, or `undefined` for `native` (the JavaScript engine behind the static
 * guards and the subject cap). `linear` without an engine is a usage error: the lean entry points ship none.
 */
function linearEngine(ctx: EvalContext, name: string): LinearRegexEngine | undefined {
  const mode = ctx.regex;
  if (mode === "native") return undefined;
  if (typeof mode === "object") return mode;
  throw codedError(
    "TAV_USAGE",
    `${name}() needs a regular-expression engine: pass regex: linearRegex (from '@tavnit-ts/tavnit/regex-linear') or regex: 'native' to createEngine`,
  );
}

function matches(ctx: EvalContext, v: Value, pattern: Value): Value {
  const str = ensureString(v, "matches");
  const pat = ensureStringArg(pattern, "matches", "pattern");
  const linear = linearEngine(ctx, "matches");
  if (linear) return linear.compile(pat, "matches").test(str);
  checkRegexInput(ctx, str, "matches");
  const re = makeRegex(pat, "");
  return re.test(str);
}

function capture(ctx: EvalContext, v: Value, pattern: Value, group: Value): Value {
  const str = ensureString(v, "capture");
  const pat = ensureStringArg(pattern, "capture", "pattern");
  const linear = linearEngine(ctx, "capture");
  if (!linear) checkRegexInput(ctx, str, "capture");
  if (typeof group !== "number") {
    throw new EvaluationError(
      `capture() requires a number for group, got ${typeName(group)}`,
    );
  }
  const idx = Math.trunc(group);
  if (linear) {
    const m = linear.compile(pat, "capture").matcher(str);
    if (!m.find() || idx < 1 || idx > m.groupCount()) return "";
    return m.group(idx) ?? "";
  }
  const re = makeRegex(pat, "");
  const match = re.exec(str);
  if (!match) return "";
  if (idx < 1 || idx >= match.length) return "";
  return match[idx] ?? "";
}

function captures(ctx: EvalContext, v: Value, pattern: Value): Value {
  const str = ensureString(v, "captures");
  const pat = ensureStringArg(pattern, "captures", "pattern");
  const linear = linearEngine(ctx, "captures");
  if (linear) {
    const m = linear.compile(pat, "captures").matcher(str);
    if (!m.find()) return null;
    return Array.from({ length: m.groupCount() }, (_, i) => m.group(i + 1) ?? "");
  }
  checkRegexInput(ctx, str, "captures");
  const match = makeRegex(pat, "").exec(str);
  if (!match) return null;
  return match.slice(1).map((group) => group ?? "");
}

export const regexBuiltins: Record<string, ContextFilterFn> = {
  matches: contextFilter(matches),
  capture: contextFilter(capture),
  captures: contextFilter(captures),
};
