import type { ContextFilterFn, EvalContext, FilterFn, Value } from "../evaluator/types.js";
import { contextFilter, EvaluationError, typeName } from "../evaluator/types.js";
import { ensureString, ensureStringArg } from "./args.js";
import { limited } from "./limits.js";

function includes(v: Value, substr: Value): Value {
  return ensureString(v, "includes").includes(
    ensureStringArg(substr, "includes", "substr"),
  );
}

function startsWith(v: Value, prefix: Value): Value {
  return ensureString(v, "startsWith").startsWith(
    ensureStringArg(prefix, "startsWith", "prefix"),
  );
}

function endsWith(v: Value, suffix: Value): Value {
  return ensureString(v, "endsWith").endsWith(
    ensureStringArg(suffix, "endsWith", "suffix"),
  );
}

function split(v: Value, delimiter: Value): Value {
  const str = ensureString(v, "split");
  const delim = ensureStringArg(delimiter, "split", "delimiter");
  if (str === "") return [];
  return str.split(delim);
}

function toUpperCase(v: Value): Value {
  return ensureString(v, "toUpperCase").toUpperCase();
}

function toLowerCase(v: Value): Value {
  return ensureString(v, "toLowerCase").toLowerCase();
}

function squish(v: Value): Value {
  return ensureString(v, "squish").replace(/\s+/g, " ").trim();
}

function trim(v: Value): Value {
  return ensureString(v, "trim").trim();
}

function trimStart(v: Value): Value {
  return ensureString(v, "trimStart").trimStart();
}

function trimEnd(v: Value): Value {
  return ensureString(v, "trimEnd").trimEnd();
}

const padStart = contextFilter((ctx: EvalContext, v: Value, n: Value, fill: Value = " "): Value => {
  const str = ensureString(v, "padStart");
  if (typeof n !== "number") {
    throw new EvaluationError(`padStart() requires a number for length, got ${typeName(n)}`);
  }
  const fillChar = ensureStringArg(fill, "padStart", "fill");
  const max = ctx.limits.maxStringLength;
  return limited(str.padStart(Math.min(n, max + 1), fillChar), "padStart", max);
});

const padEnd = contextFilter((ctx: EvalContext, v: Value, n: Value, fill: Value = " "): Value => {
  const str = ensureString(v, "padEnd");
  if (typeof n !== "number") {
    throw new EvaluationError(`padEnd() requires a number for length, got ${typeName(n)}`);
  }
  const fillChar = ensureStringArg(fill, "padEnd", "fill");
  const max = ctx.limits.maxStringLength;
  return limited(str.padEnd(Math.min(n, max + 1), fillChar), "padEnd", max);
});

const replace = contextFilter((ctx: EvalContext, v: Value, search: Value, replacement: Value): Value => {
  return limited(ensureString(v, "replace").replace(
    ensureStringArg(search, "replace", "search"),
    ensureStringArg(replacement, "replace", "replacement"),
  ), "replace", ctx.limits.maxStringLength);
});

const replaceAll = contextFilter((ctx: EvalContext, v: Value, search: Value, replacement: Value): Value => {
  return limited(ensureString(v, "replaceAll").replaceAll(
    ensureStringArg(search, "replaceAll", "search"),
    ensureStringArg(replacement, "replaceAll", "replacement"),
  ), "replaceAll", ctx.limits.maxStringLength);
});

function remove(v: Value, substr: Value): Value {
  return ensureString(v, "remove").replaceAll(
    ensureStringArg(substr, "remove", "substr"),
    "",
  );
}

const append = contextFilter((ctx: EvalContext, v: Value, suffix: Value): Value => {
  return limited(ensureString(v, "append") + ensureStringArg(suffix, "append", "suffix"), "append", ctx.limits.maxStringLength);
});

function truncate(v: Value, n: Value): Value {
  const str = ensureString(v, "truncate");
  if (typeof n !== "number") {
    throw new EvaluationError(`truncate() requires a number, got ${typeName(n)}`);
  }
  // slice() counts UTF-16 code units, so a cut falling inside a surrogate pair
  // leaves a lone surrogate: ill-formed Unicode that JSON.stringify emits as
  // "\ud83d" and that PostgreSQL's jsonb refuses. Drop the dangling half
  // instead — the result is at most one code unit shorter than asked.
  const out = str.slice(0, Math.trunc(n));
  const last = out.charCodeAt(out.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** An index of `str` for a cut: truncated toward zero, a negative one counted from the end, clamped to `[0, length]`. */
function cutIndex(n: number, length: number): number {
  const i = Number.isNaN(n) ? 0 : Math.trunc(n);
  return i < 0 ? Math.max(0, length + i) : Math.min(i, length);
}

/** `str.slice(start, end)` on clamped indexes, dropping a half pair a cut would leave at either edge. */
function sliceWhole(str: string, start: number, end: number): string {
  if (start > 0 && isLow(str.charCodeAt(start)) && isHigh(str.charCodeAt(start - 1))) start++;
  if (end < str.length && isHigh(str.charCodeAt(end - 1)) && isLow(str.charCodeAt(end))) end--;
  return start >= end ? "" : str.slice(start, end);
}

function substring(v: Value, start: Value, end: Value = null): Value {
  const str = ensureString(v, "substring");
  if (typeof start !== "number" && start !== null) {
    throw new EvaluationError(`substring() requires a number for start, got ${typeName(start)}`);
  }
  if (typeof end !== "number" && end !== null) {
    throw new EvaluationError(`substring() requires a number for end, got ${typeName(end)}`);
  }
  return sliceWhole(
    str,
    start === null ? 0 : cutIndex(start, str.length),
    end === null ? str.length : cutIndex(end, str.length),
  );
}

/** The count of `left` / `right`: truncated toward zero, a negative or NaN one is 0, clamped to the length. */
function countOf(n: Value, name: string, length: number): number {
  if (typeof n !== "number") {
    throw new EvaluationError(`${name}() requires a number, got ${typeName(n)}`);
  }
  return Number.isNaN(n) ? 0 : Math.min(Math.max(Math.trunc(n), 0), length);
}

function left(v: Value, n: Value): Value {
  const str = ensureString(v, "left");
  return sliceWhole(str, 0, countOf(n, "left", str.length));
}

function right(v: Value, n: Value): Value {
  const str = ensureString(v, "right");
  return sliceWhole(str, str.length - countOf(n, "right", str.length), str.length);
}

function stripNewlines(v: Value): Value {
  return ensureString(v, "stripNewlines").replace(/\r?\n|\r/g, "");
}

const indent = contextFilter((ctx: EvalContext, v: Value, n: Value): Value => {
  const str = ensureString(v, "indent");
  if (typeof n !== "number") {
    throw new EvaluationError(`indent() requires a number, got ${typeName(n)}`);
  }
  const width = Math.max(0, Math.trunc(n));
  const lines = str.split("\n");
  const max = ctx.limits.maxStringLength;
  if (width * lines.length > max) {
    throw new EvaluationError(`indent() result exceeds ${max} characters`);
  }
  const spaces = " ".repeat(width);
  return limited(lines.map((line) => spaces + line).join("\n"), "indent", max);
});

function chunks(v: Value, maxLen: Value, separators: Value = ["\n\n", "\n"]): Value {
  const str = ensureString(v, "chunks");
  if (typeof maxLen !== "number" || !Number.isFinite(maxLen)) {
    throw new EvaluationError(
      `chunks() requires a finite number for maxLen, got ${typeName(maxLen)}`,
    );
  }
  const limit = Math.trunc(maxLen);
  if (limit < 1) {
    throw new EvaluationError(`chunks() maxLen must be at least 1, got ${limit}`);
  }
  if (!Array.isArray(separators) || separators.some((s) => typeof s !== "string")) {
    throw new EvaluationError(`chunks() separators must be an array of strings`);
  }
  const seps = separators as string[];
  if (str === "") return [];
  if (str.length <= limit) return [str];
  const result: string[] = [];
  let remaining = str;
  while (remaining.length > limit) {
    let splitAt = -1;
    for (const sep of seps) {
      const pos = remaining.lastIndexOf(sep, limit - sep.length);
      if (pos > 0) {
        splitAt = pos;
        const chunk = remaining.slice(0, splitAt);
        result.push(chunk);
        remaining = remaining.slice(splitAt + sep.length);
        break;
      }
    }
    if (splitAt === -1) {
      result.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
    }
  }
  // Every cut leaves more than it took off a string longer than `limit`, so the rest is never empty.
  result.push(remaining);
  return result;
}

export const stringBuiltins: Record<string, FilterFn | ContextFilterFn> = {
  includes,
  startsWith,
  endsWith,
  split,
  toUpperCase,
  toLowerCase,
  squish,
  trim,
  trimStart,
  trimEnd,
  padStart,
  padEnd,
  replace,
  replaceAll,
  remove,
  append,
  truncate,
  substring,
  left,
  right,
  stripNewlines,
  indent,
  chunks,
};
