import type { FilterRegistry, Value } from "../evaluator/types.js";
import { EvaluationError, typeName } from "../evaluator/types.js";

function ensureNumber(v: Value, name: string): number {
  if (typeof v !== "number") {
    throw new EvaluationError(
      `${name}() requires a number, got ${typeName(v)}`,
    );
  }
  return v;
}

function toFixed(v: Value, digits: Value): Value {
  const num = ensureNumber(v, "toFixed");
  const d = ensureNumber(digits, "toFixed");
  if (!Number.isInteger(d) || d < 0) {
    throw new EvaluationError(
      `toFixed() requires a non-negative integer for digits, got ${digits}`,
    );
  }
  return num.toFixed(d);
}

/** Rounds half away from zero, so `round(-2.5)` is `-3`; the decimal shift goes through the exponent form to dodge `1.005 * 100`. */
function round(v: Value, digits: Value = null): Value {
  const num = ensureNumber(v, "round");
  let d = 0;
  if (digits !== null) {
    d = ensureNumber(digits, "round");
    if (!Number.isInteger(d) || d < 0 || d > 100) {
      throw new EvaluationError(
        `round() requires an integer from 0 to 100 for digits, got ${digits}`,
      );
    }
  }
  // Past 2^52 every double is an integer already.
  if (!Number.isFinite(num) || Math.abs(num) >= 2 ** 52) return num;
  const abs = Math.abs(num);
  const text = String(abs);
  let rounded: number;
  if (text.includes("e")) {
    // Exponent form (1e-7, 1e21) cannot take a second exponent: shift by multiplying.
    rounded = Math.floor(abs * 10 ** d + 0.5) / 10 ** d;
  } else {
    rounded = Number(`${Math.floor(Number(`${text}e${d}`) + 0.5)}e-${d}`);
  }
  return num < 0 && rounded !== 0 ? -rounded : rounded;
}

function floor(v: Value): Value {
  return Math.floor(ensureNumber(v, "floor"));
}

function ceil(v: Value): Value {
  return Math.ceil(ensureNumber(v, "ceil"));
}

function abs(v: Value): Value {
  return Math.abs(ensureNumber(v, "abs"));
}

export const mathBuiltins: FilterRegistry = {
  round,
  floor,
  ceil,
  abs,
  toFixed,
};
