import { RESTRICTED } from "../evaluator/restricted.js";
import { EvaluationError, typeName, type FilterRegistry, type Value } from "../evaluator/types.js";

function ensureObject(v: Value, name: string): Record<string, Value> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new EvaluationError(
      `${name}() requires an object, got ${typeName(v)}`,
    );
  }
  return v as Record<string, Value>;
}

function ensureString(v: Value, name: string, argLabel = "argument"): string {
  if (typeof v !== "string") {
    throw new EvaluationError(
      `${name}() ${argLabel} requires a string, got ${typeName(v)}`,
    );
  }
  return v;
}

function pick(v: Value, ...keyArgs: Value[]): Value {
  const obj = ensureObject(v, "pick");
  const result: Record<string, Value> = {};
  for (const keyArg of keyArgs) {
    const k = ensureString(keyArg, "pick", "key");
    if (Object.hasOwn(obj, k)) {
      result[k] = obj[k] as Value;
    }
  }
  return result;
}

function omit(v: Value, ...keyArgs: Value[]): Value {
  const obj = ensureObject(v, "omit");
  const omitSet = new Set(keyArgs.map((k) => ensureString(k, "omit", "key")));
  const result: Record<string, Value> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (!omitSet.has(k)) {
      result[k] = val;
    }
  }
  return result;
}

function objectKeys(v: Value): Value {
  return Object.keys(ensureObject(v, "keys"));
}

function objectValues(v: Value): Value {
  return Object.values(ensureObject(v, "values"));
}

function path(v: Value, dotPath: Value): Value {
  const obj = ensureObject(v, "path");
  const pathStr = ensureString(dotPath, "path", "dotPath");
  const segments = pathStr.split(".");
  for (const seg of segments) {
    if (RESTRICTED.has(seg)) {
      throw new EvaluationError(`Access to reserved name '${seg}' is not allowed`);
    }
  }
  let current: Value = obj;
  for (const seg of segments) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    const record = current as Record<string, Value>;
    current = Object.hasOwn(record, seg) ? record[seg] : null;
  }
  return current;
}

export const objectBuiltins: FilterRegistry = {
  pick,
  omit,
  keys: objectKeys,
  values: objectValues,
  path,
};
