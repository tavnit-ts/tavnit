import {
  EvaluationError,
  FunctionValue,
  Resolver,
  TavnitDateBase,
  TavnitDuration,
  TavnitInstant,
  TavnitPlainDate,
  TavnitPlainDateTime,
  TavnitPlainTime,
  type FilterRegistry,
  type Value,
  typeName,
} from "../evaluator/types.js";

const DEEP_EQUALS_MAX_DEPTH = 200;

function deepEqual(a: Value, b: Value, depth: number): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (depth > DEEP_EQUALS_MAX_DEPTH) {
    throw new EvaluationError(`deepEquals() exceeds the nesting limit of ${DEEP_EQUALS_MAX_DEPTH}`);
  }
  if (a instanceof FunctionValue || b instanceof FunctionValue || a instanceof Resolver || b instanceof Resolver) {
    return false;
  }
  if (a instanceof TavnitDateBase || b instanceof TavnitDateBase) {
    return (
      a instanceof TavnitDateBase &&
      b instanceof TavnitDateBase &&
      a.constructor === b.constructor &&
      str(a) === str(b)
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index], depth + 1));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key], depth + 1),
  );
}

/** Structural equality: arrays by element, objects by key, date types by value; `NaN` equals `NaN`. */
function deepEquals(a: Value, b: Value): Value {
  return deepEqual(a, b, 0);
}

function str(v: Value): Value {
  if (typeof v === "string") return v;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new EvaluationError(
        `str() cannot convert ${v} to a string — use a finite number`,
      );
    }
    return String(v);
  }
  if (v instanceof FunctionValue) {
    throw new EvaluationError("str() cannot convert a function value");
  }
  if (v instanceof TavnitDateBase) {
    if (v instanceof TavnitInstant) return v._inner.toString();
    if (v instanceof TavnitPlainDate) return v._inner.toString();
    if (v instanceof TavnitPlainTime) return v._inner.toString();
    if (v instanceof TavnitPlainDateTime) return v._inner.toString();
    if (v instanceof TavnitDuration) return v._inner.toString();
    // ZonedDateTime is transient — falls through to the error below
  }
  throw new EvaluationError(
    `str() cannot convert ${Array.isArray(v) ? "array" : "object"} — use json(v) to serialise`,
  );
}

function num(v: Value): Value {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new EvaluationError(`num() requires a finite number, got ${v}`);
    }
    return v;
  }
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isFinite(n) || v.trim() === "") {
      throw new EvaluationError(`num() cannot convert "${v}" to a number`);
    }
    return n;
  }
  throw new EvaluationError(
    `num() requires a number or numeric string, got ${typeName(v)}`,
  );
}

function bool(v: Value): Value {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
    throw new EvaluationError(`bool() requires "true" or "false", got "${v}"`);
  }
  throw new EvaluationError(
    `bool() requires a boolean or "true"/"false" string, got ${typeName(v)}`,
  );
}

function type(v: Value): Value {
  return typeName(v);
}

export const typeBuiltins: FilterRegistry = {
  str,
  num,
  bool,
  type,
  deepEquals,
};
