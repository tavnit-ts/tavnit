import {
  contextFilter,
  type ContextFilterFn,
  type EvalContext,
  EvaluationError,
  FunctionValue,
  type Value,
  typeName,
} from "../evaluator/types.js";
import { chargeIterations } from "../evaluator/errors.js";
import { limited } from "./limits.js";
import { isBlankValue } from "./null-safety.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureArray(v: Value, name: string): Value[] {
  if (!Array.isArray(v)) {
    throw new EvaluationError(
      `${name}() requires an array, got ${typeName(v)}`,
    );
  }
  return v;
}

function ensureNumber(v: Value, name: string): number {
  if (typeof v !== "number") {
    throw new EvaluationError(`${name}() requires a number, got ${typeName(v)}`);
  }
  return v;
}

function consumeIter(ctx: EvalContext, n: number): void {
  chargeIterations(ctx, n);
}

/**
 * Invoke a Value as a function. Throws if it is not a FunctionValue.
 * Delegates to ctx.invokeFn for FunctionValue dispatch.
 * Returns Promise<Value> when ctx.asyncMode is true.
 */
function callValue(fn: Value, args: Value[], ctx: EvalContext): Value | Promise<Value> {
  if (fn instanceof FunctionValue) {
    return ctx.invokeFn(fn, args);
  }
  throw new EvaluationError(`Expected a function value, got ${typeName(fn)}`);
}

/** Stable string key for sorting mixed-type values (matches JS default sort for primitives). */
function toSortKey(v: Value): string {
  if (v === null) return "null";
  if (typeof v !== "object") return String(v);
  return JSON.stringify(v);
}

/** Stringify an array element for join(): null → "", objects → JSON. */
function stringifyElement(el: Value): string {
  if (el === null) return "";
  if (typeof el !== "object") return String(el);
  return JSON.stringify(el);
}

// ── Natural comparator for sort() ─────────────────────────────────────────────

const COLLATOR_CACHE_LIMIT = 64;
const collators = new Map<string, Intl.Collator>();

/** A collator for `locale`, built once: constructing one costs far more than a comparison. */
function collatorFor(locale: string): Intl.Collator {
  const cached = collators.get(locale);
  if (cached !== undefined) return cached;
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(locale);
  } catch {
    throw new EvaluationError(`sort() locale is not a valid language tag, got "${locale}"`);
  }
  if (collators.size >= COLLATOR_CACHE_LIMIT) collators.clear();
  collators.set(locale, collator);
  return collator;
}

/** Reads `{ locale }` from the options argument of `sort()`. */
function sortLocale(options: Value): Intl.Collator | null {
  if (options === null) return null;
  if (typeof options !== "object" || Array.isArray(options) || options instanceof FunctionValue) {
    throw new EvaluationError(`sort() options must be an object, got ${typeName(options)}`);
  }
  const record = options as Record<string, Value>;
  for (const key of Object.keys(record)) {
    if (key !== "locale") {
      throw new EvaluationError(`sort() does not take the option '${key}'; only 'locale'`);
    }
  }
  const locale = record.locale ?? null;
  if (locale === null) return null;
  if (typeof locale !== "string") {
    throw new EvaluationError(`sort() locale must be a string, got ${typeName(locale)}`);
  }
  return collatorFor(locale);
}

function naturalCompare(a: Value, b: Value, collator: Intl.Collator | null = null): number {
  if (typeof a === "number" && typeof b === "number") {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (collator !== null && typeof a === "string" && typeof b === "string") {
    return collator.compare(a, b);
  }
  // Fall back to string comparison (matches JS Array.prototype.sort default)
  const sa = toSortKey(a);
  const sb = toSortKey(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/**
 * Stable merge sort with an async comparator. Used by sort() in asyncMode when a
 * 2-param comparator is supplied — native Array.prototype.sort cannot be async.
 */
async function asyncMergeSort(
  arr: Value[],
  compare: (a: Value, b: Value) => Promise<number>,
): Promise<Value[]> {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  const [left, right] = await Promise.all([
    asyncMergeSort(arr.slice(0, mid), compare),
    asyncMergeSort(arr.slice(mid), compare),
  ]);
  const result: Value[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const cmp = await compare(left[i], right[j]);
    if (cmp <= 0) {
      result.push(left[i++]);
    } else {
      result.push(right[j++]);
    }
  }
  while (i < left.length) result.push(left[i++]);
  while (j < right.length) result.push(right[j++]);
  return result;
}

// ── size ─────────────────────────────────────────────────────────────────────

const size = contextFilter((_ctx: EvalContext, v: Value): Value => {
  if (v === null) return 0;
  if (Array.isArray(v)) return v.length;
  if (typeof v === "string") return v.length;
  if (typeof v === "object" && !(v instanceof FunctionValue)) {
    return Object.keys(v).length;
  }
  throw new EvaluationError(
    `size() requires an array, string, object, or null, got ${typeName(v)}`,
  );
});

// ── map ───────────────────────────────────────────────────────────────────────

const map = contextFilter((ctx: EvalContext, v: Value, fn: Value = null): Value | Promise<Value> => {
  const arr = ensureArray(v, "map");
  consumeIter(ctx, arr.length);
  if (ctx.asyncMode) {
    return (async () => {
      const result: Value[] = [];
      for (const item of arr) {
        result.push(await (callValue(fn, [item], ctx)));
      }
      return result;
    })();
  }
  return arr.map((item) => callValue(fn, [item], ctx) as Value);
});

// ── filter ────────────────────────────────────────────────────────────────────

const filter = contextFilter(
  (ctx: EvalContext, v: Value, fn: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "filter");
    consumeIter(ctx, arr.length);
    if (ctx.asyncMode) {
      return (async () => {
        const result: Value[] = [];
        for (const item of arr) {
          const keep = await (callValue(fn, [item], ctx));
          if (keep !== null && keep !== false && keep !== 0 && keep !== "") {
            result.push(item);
          }
        }
        return result;
      })();
    }
    return arr.filter((item) => {
      const result = callValue(fn, [item], ctx) as Value;
      return result !== null && result !== false && result !== 0 && result !== "";
    });
  },
);

// ── find ──────────────────────────────────────────────────────────────────────

const find = contextFilter(
  (ctx: EvalContext, v: Value, fn: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "find");
    consumeIter(ctx, arr.length);
    if (ctx.asyncMode) {
      return (async () => {
        for (const item of arr) {
          const result = await (callValue(fn, [item], ctx));
          if (result !== null && result !== false && result !== 0 && result !== "") {
            return item;
          }
        }
        return null;
      })();
    }
    for (const item of arr) {
      const result = callValue(fn, [item], ctx) as Value;
      if (result !== null && result !== false && result !== 0 && result !== "") {
        return item;
      }
    }
    return null;
  },
);

// ── some ──────────────────────────────────────────────────────────────────────

const some = contextFilter(
  (ctx: EvalContext, v: Value, fn: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "some");
    consumeIter(ctx, arr.length);
    if (ctx.asyncMode) {
      return (async () => {
        for (const item of arr) {
          const result = await (callValue(fn, [item], ctx));
          if (result !== null && result !== false && result !== 0 && result !== "") {
            return true;
          }
        }
        return false;
      })();
    }
    for (const item of arr) {
      const result = callValue(fn, [item], ctx) as Value;
      if (result !== null && result !== false && result !== 0 && result !== "") {
        return true;
      }
    }
    return false;
  },
);

// ── every ─────────────────────────────────────────────────────────────────────

const every = contextFilter(
  (ctx: EvalContext, v: Value, fn: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "every");
    consumeIter(ctx, arr.length);
    if (ctx.asyncMode) {
      return (async () => {
        for (const item of arr) {
          const result = await (callValue(fn, [item], ctx));
          if (result === null || result === false || result === 0 || result === "") {
            return false;
          }
        }
        return true;
      })();
    }
    for (const item of arr) {
      const result = callValue(fn, [item], ctx) as Value;
      if (result === null || result === false || result === 0 || result === "") {
        return false;
      }
    }
    return true;
  },
);

// ── reduce ────────────────────────────────────────────────────────────────────

const reduce = contextFilter(
  (ctx: EvalContext, v: Value, fn: Value = null, init: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "reduce");
    consumeIter(ctx, arr.length);
    if (ctx.asyncMode) {
      return (async () => {
        let acc = init;
        for (const item of arr) {
          acc = await (callValue(fn, [acc, item], ctx));
        }
        return acc;
      })();
    }
    let acc = init;
    for (const item of arr) {
      acc = callValue(fn, [acc, item], ctx) as Value;
    }
    return acc;
  },
);

// ── flatMap ───────────────────────────────────────────────────────────────────

const flatMap = contextFilter(
  (ctx: EvalContext, v: Value, fn: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "flatMap");
    consumeIter(ctx, arr.length);
    if (ctx.asyncMode) {
      return (async () => {
        const result: Value[] = [];
        for (const item of arr) {
          const mapped = await (callValue(fn, [item], ctx));
          if (Array.isArray(mapped)) {
            result.push(...mapped);
          } else {
            result.push(mapped);
          }
        }
        return result;
      })();
    }
    const result: Value[] = [];
    for (const item of arr) {
      const mapped = callValue(fn, [item], ctx) as Value;
      if (Array.isArray(mapped)) {
        result.push(...mapped);
      } else {
        result.push(mapped);
      }
    }
    return result;
  },
);

// ── flatten ──────────────────────────────────────────────────────────────────

function flattenHelper(arr: Value[], depth: number, result: Value[]): void {
  for (const item of arr) {
    if (Array.isArray(item) && depth > 0) {
      flattenHelper(item, depth - 1, result);
    } else {
      result.push(item);
    }
  }
}

const flatten = contextFilter(
  (ctx: EvalContext, v: Value, depth: Value = null): Value => {
    const arr = ensureArray(v, "flatten");
    const d =
      depth === null ? Number.POSITIVE_INFINITY : ensureNumber(depth, "flatten");
    const result: Value[] = [];
    flattenHelper(arr, d, result);
    consumeIter(ctx, result.length);
    return result;
  },
);

// ── join ─────────────────────────────────────────────────────────────────────

const join = contextFilter(
  (ctx: EvalContext, v: Value, separator: Value = null): Value => {
    const arr = ensureArray(v, "join");
    consumeIter(ctx, arr.length);
    let sep: string;
    if (separator === null) {
      sep = ",";
    } else if (typeof separator === "string") {
      sep = separator;
    } else {
      throw new EvaluationError(
        `join() separator must be a string, got ${typeName(separator)}`,
      );
    }
    return limited(arr.map(stringifyElement).join(sep), "join", ctx.limits.maxStringLength);
  },
);

// ── joinFilled ───────────────────────────────────────────────────────────────

const joinFilled = contextFilter(
  (ctx: EvalContext, v: Value, separator: Value = null): Value => {
    if (v === null) return "";
    const arr = ensureArray(v, "joinFilled");
    consumeIter(ctx, arr.length);
    if (separator !== null && typeof separator !== "string") {
      throw new EvaluationError(
        `joinFilled() separator must be a string, got ${typeName(separator)}`,
      );
    }
    return limited(arr
      .filter((item) => !isBlankValue(item))
      .map(stringifyElement)
      .join(separator ?? ","), "joinFilled", ctx.limits.maxStringLength);
  },
);

// ── concat ───────────────────────────────────────────────────────────────────

const concat = contextFilter(
  (ctx: EvalContext, v: Value, other: Value = null): Value => {
    const a = ensureArray(v, "concat");
    // `other ?? []` converts null to an empty array before the ensureArray call,
    // so ensureArray's null-branch error message is intentionally unreachable here.
    const b = ensureArray(other ?? [], "concat");
    consumeIter(ctx, a.length + b.length);
    return [...a, ...b];
  },
);

// ── reverse ──────────────────────────────────────────────────────────────────

const reverse = contextFilter((ctx: EvalContext, v: Value): Value => {
  const arr = ensureArray(v, "reverse");
  consumeIter(ctx, arr.length);
  return [...arr].reverse();
});

// ── sort ─────────────────────────────────────────────────────────────────────

const sort = contextFilter(
  (ctx: EvalContext, v: Value, fnArg: Value = null, optionsArg: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "sort");
    // `sort(arr, { locale })` is `sort(arr, null, { locale })`.
    const optionsInSecond =
      fnArg !== null && typeof fnArg === "object" && !Array.isArray(fnArg) && !(fnArg instanceof FunctionValue);
    const fn = optionsInSecond ? null : fnArg;
    const collator = sortLocale(optionsInSecond ? fnArg : optionsArg);
    consumeIter(ctx, arr.length);
    const copy = [...arr];
    if (fn === null) {
      copy.sort((a, b) => naturalCompare(a, b, collator));
      return copy;
    }
    if (fn instanceof FunctionValue) {
      if (fn.params.length === 1) {
        if (ctx.asyncMode) {
          // Pre-compute all keys asynchronously, then sort synchronously.
          return (async () => {
            const keys = await Promise.all(
              copy.map((item) => Promise.resolve(callValue(fn, [item], ctx))),
            );
            const indexed = copy.map((item, i) => ({ item, key: keys[i] }));
            indexed.sort((a, b) => naturalCompare(a.key, b.key, collator));
            return indexed.map((x) => x.item);
          })();
        }
        // Key extractor: sort ascending by extracted key
        copy.sort((a, b) => {
          const ka = callValue(fn, [a], ctx) as Value;
          const kb = callValue(fn, [b], ctx) as Value;
          return naturalCompare(ka, kb, collator);
        });
      } else {
        if (collator !== null) {
          throw new EvaluationError("sort() locale applies to natural or key order, not to a comparator");
        }
        if (ctx.asyncMode) {
          return asyncMergeSort(copy, async (a, b) => {
            const result = await (callValue(fn, [a, b], ctx));
            if (typeof result !== "number") {
              throw new EvaluationError(
                `sort() comparator must return a number, got ${typeName(result)}`,
              );
            }
            return result;
          });
        }
        // Comparator: 2-param function returning negative/zero/positive
        copy.sort((a, b) => {
          const result = callValue(fn, [a, b], ctx) as Value;
          if (typeof result !== "number") {
            throw new EvaluationError(
              `sort() comparator must return a number, got ${typeName(result)}`,
            );
          }
          return result;
        });
      }
      return copy;
    }
    throw new EvaluationError(`sort() second argument must be a function, got ${typeName(fn)}`);
  },
);

// ── uniqBy ───────────────────────────────────────────────────────────────────

const uniqBy = contextFilter(
  (ctx: EvalContext, v: Value, fn: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "uniqBy");
    consumeIter(ctx, arr.length);
    if (ctx.asyncMode) {
      return (async () => {
        const seen = new Set<string>();
        const result: Value[] = [];
        for (const item of arr) {
          const key = await (callValue(fn, [item], ctx));
          const keyStr = JSON.stringify(key);
          if (!seen.has(keyStr)) {
            seen.add(keyStr);
            result.push(item);
          }
        }
        return result;
      })();
    }
    const seen = new Set<string>();
    const result: Value[] = [];
    for (const item of arr) {
      const key = callValue(fn, [item], ctx) as Value;
      const keyStr = JSON.stringify(key);
      if (!seen.has(keyStr)) {
        seen.add(keyStr);
        result.push(item);
      }
    }
    return result;
  },
);

// ── groupBy ──────────────────────────────────────────────────────────────────

const groupBy = contextFilter(
  (ctx: EvalContext, v: Value, fn: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "groupBy");
    consumeIter(ctx, arr.length);

    function toKeyStr(key: Value): string {
      if (key === null) return "null";
      if (typeof key === "object") return JSON.stringify(key);
      return String(key);
    }

    if (ctx.asyncMode) {
      return (async () => {
        const groups: Record<string, Value[]> = {};
        for (const item of arr) {
          const key = await (callValue(fn, [item], ctx));
          const keyStr = toKeyStr(key);
          if (!Object.hasOwn(groups, keyStr)) {
            groups[keyStr] = [];
          }
          groups[keyStr].push(item);
        }
        return groups;
      })();
    }
    const groups: Record<string, Value[]> = {};
    for (const item of arr) {
      const key = callValue(fn, [item], ctx) as Value;
      // Stringify key consistently — null → "null", objects → JSON, primitives → string
      const keyStr = toKeyStr(key);
      if (!Object.hasOwn(groups, keyStr)) {
        groups[keyStr] = [];
      }
      groups[keyStr].push(item);
    }
    return groups;
  },
);

// ── keyBy ────────────────────────────────────────────────────────────────────

const keyBy = contextFilter(
  (ctx: EvalContext, v: Value, fn: Value = null): Value | Promise<Value> => {
    const arr = ensureArray(v, "keyBy");
    consumeIter(ctx, arr.length);

    function toKeyStr(key: Value): string {
      if (key === null) return "null";
      if (typeof key === "object") return JSON.stringify(key);
      return String(key);
    }

    if (ctx.asyncMode) {
      return (async () => {
        const result: Record<string, Value> = {};
        for (const item of arr) {
          const key = await (callValue(fn, [item], ctx));
          result[toKeyStr(key)] = item;
        }
        return result;
      })();
    }
    const result: Record<string, Value> = {};
    for (const item of arr) {
      const key = callValue(fn, [item], ctx) as Value;
      // Stringify key consistently — null → "null", objects → JSON, primitives → string.
      // Later items win on duplicate keys, matching Lodash's keyBy semantics.
      result[toKeyStr(key)] = item;
    }
    return result;
  },
);

// ── chunk ────────────────────────────────────────────────────────────────────

const chunk = contextFilter((ctx: EvalContext, v: Value, size: Value = null): Value => {
  const arr = ensureArray(v, "chunk");
  if (size === null) {
    throw new EvaluationError("chunk() requires a size argument");
  }
  const n = ensureNumber(size, "chunk");
  const chunkSize = Math.trunc(n);
  if (chunkSize <= 0) {
    throw new EvaluationError(`chunk() size must be a positive integer, got ${n}`);
  }
  consumeIter(ctx, arr.length);
  const result: Value[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    result.push(arr.slice(i, i + chunkSize));
  }
  return result;
});

// ── first / last / slice ──────────────────────────────────────────────────────

const first = contextFilter((_ctx: EvalContext, v: Value): Value => {
  const arr = ensureArray(v, "first");
  return arr.length > 0 ? arr[0] : null;
});

const last = contextFilter((_ctx: EvalContext, v: Value): Value => {
  const arr = ensureArray(v, "last");
  return arr.at(-1) ?? null;
});

const slice = contextFilter(
  (ctx: EvalContext, v: Value, from: Value = null, to: Value = null): Value => {
    const arr = ensureArray(v, "slice");
    const f = from === null ? 0 : ensureNumber(from, "slice");
    const t = to === null ? arr.length : ensureNumber(to, "slice");
    const result = arr.slice(Math.trunc(f), Math.trunc(t));
    consumeIter(ctx, result.length);
    return result;
  },
);

// ── compact ──────────────────────────────────────────────────────────────────

const compact = contextFilter((ctx: EvalContext, v: Value): Value => {
  const arr = ensureArray(v, "compact");
  consumeIter(ctx, arr.length);
  return arr.filter((item) => item !== null);
});

// ── sum / min / max / range ─────────────────────────────────────────────────

function numbersOf(ctx: EvalContext, v: Value, name: string): number[] {
  const arr = ensureArray(v, name);
  consumeIter(ctx, arr.length);
  return arr.map((item, index) => {
    if (typeof item !== "number") {
      throw new EvaluationError(
        `${name}() requires an array of numbers, got ${typeName(item)} at index ${index}`,
      );
    }
    return item;
  });
}

const sum = contextFilter((ctx: EvalContext, v: Value): Value =>
  numbersOf(ctx, v, "sum").reduce((total, n) => total + n, 0),
);

const min = contextFilter((ctx: EvalContext, v: Value): Value => {
  const numbers = numbersOf(ctx, v, "min");
  return numbers.length === 0 ? null : numbers.reduce((a, b) => Math.min(a, b));
});

const max = contextFilter((ctx: EvalContext, v: Value): Value => {
  const numbers = numbersOf(ctx, v, "max");
  return numbers.length === 0 ? null : numbers.reduce((a, b) => Math.max(a, b));
});

/** `range(end)`, `range(start, end)`, `range(start, end, step)`: the end is exclusive. */
const range = contextFilter(
  (ctx: EvalContext, a: Value, b: Value = null, stepArg: Value = null): Value => {
    const lead = ensureNumber(a, "range");
    const start = b === null ? 0 : lead;
    const end = b === null ? lead : ensureNumber(b, "range");
    const step = stepArg === null ? 1 : ensureNumber(stepArg, "range");
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step === 0) {
      throw new EvaluationError("range() requires finite bounds and a step other than 0");
    }
    const count = Math.max(0, Math.ceil((end - start) / step));
    consumeIter(ctx, count);
    const result: Value[] = [];
    for (let index = 0; index < count; index++) result.push(start + index * step);
    return result;
  },
);

// ── indexOf ──────────────────────────────────────────────────────────────────

const indexOf = contextFilter(
  (ctx: EvalContext, v: Value, needle: Value = null): Value => {
    if (Array.isArray(v)) {
      consumeIter(ctx, v.length);
      return v.indexOf(needle);
    }
    if (typeof v === "string") {
      if (typeof needle !== "string") {
        throw new EvaluationError(
          `indexOf() on a string requires a string needle, got ${typeName(needle)}`,
        );
      }
      return v.indexOf(needle);
    }
    throw new EvaluationError(
      `indexOf() requires an array or string, got ${typeName(v)}`,
    );
  },
);

// ── Registry ──────────────────────────────────────────────────────────────────

export const collectionBuiltins: Record<string, ContextFilterFn> = {
  size,
  map,
  filter,
  find,
  some,
  every,
  reduce,
  flatMap,
  flatten,
  join,
  joinFilled,
  concat,
  reverse,
  sort,
  uniqBy,
  groupBy,
  keyBy,
  chunk,
  compact,
  first,
  last,
  slice,
  indexOf,
  sum,
  min,
  max,
  range,
};
