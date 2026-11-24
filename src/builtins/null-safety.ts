import type { FilterRegistry, Value } from "../evaluator/types.js";
import { FunctionValue, isAtomicValue } from "../evaluator/types.js";

/** True for `null`, `""`, `[]` and `{}`; a date, a function and any scalar are never empty. */
export function isEmptyValue(v: Value): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object" && !isAtomicValue(v) && !(v instanceof FunctionValue)) return Object.keys(v).length === 0;
  return false;
}

/** `isEmptyValue`, and a string of only whitespace counts as empty. */
export function isBlankValue(v: Value): boolean {
  return typeof v === "string" ? v.trim() === "" : isEmptyValue(v);
}

function defaultFn(v: Value, fallback: Value = null): Value {
  return v ?? fallback;
}

function coalesce(v: Value, ...args: Value[]): Value {
  if (v !== null && v !== undefined) return v;
  for (const arg of args) {
    if (arg !== null && arg !== undefined) return arg;
  }
  return null;
}

function blank(v: Value): Value {
  return isBlankValue(v);
}

function filled(v: Value): Value {
  return !isBlankValue(v);
}

function isEmpty(v: Value): Value {
  return isEmptyValue(v);
}

function firstFilled(v: Value, ...args: Value[]): Value {
  if (!isBlankValue(v)) return v;
  for (const arg of args) {
    if (!isBlankValue(arg)) return arg;
  }
  return null;
}

export const nullSafetyBuiltins: FilterRegistry = {
  blank,
  filled,
  isEmpty,
  firstFilled,
  default: defaultFn,
  coalesce,
};
