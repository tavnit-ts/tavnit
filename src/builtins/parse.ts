import type { FilterRegistry, Value } from "../evaluator/types.js";
import { EvaluationError, typeName } from "../evaluator/types.js";

function parseBool(v: Value): Value {
  if (typeof v === "boolean") return v;
  if (v === null) return false;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new EvaluationError(
        `parseBool() requires a finite number, got ${v}`,
      );
    }
    return v !== 0;
  }
  if (typeof v === "string") {
    const lower = v.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "1") return true;
    if (lower === "false" || lower === "no" || lower === "0") return false;
    throw new EvaluationError(
      `parseBool() cannot parse "${v}" — accepted strings: "true", "false", "yes", "no", "1", "0"`,
    );
  }
  throw new EvaluationError(
    `parseBool() requires a boolean, number, string, or null, got ${typeName(v)}`,
  );
}

function parseInteger(v: Value): Value {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new EvaluationError(
        `parseInteger() requires a finite number, got ${v}`,
      );
    }
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "" || trimmed.includes(".") || trimmed.includes("e") || trimmed.includes("E")) {
      throw new EvaluationError(
        `parseInteger() cannot parse "${v}" — value has a decimal component; use parseFloat() instead`,
      );
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      throw new EvaluationError(`parseInteger() cannot parse "${v}" as an integer`);
    }
    return Math.trunc(n);
  }
  throw new EvaluationError(
    `parseInteger() requires a number or numeric string, got ${typeName(v)}`,
  );
}

function parseFloatFn(v: Value): Value {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new EvaluationError(
        `parseFloat() requires a finite number, got ${v}`,
      );
    }
    return v;
  }
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || v.trim() === "") {
      throw new EvaluationError(
        `parseFloat() cannot convert "${v}" to a number`,
      );
    }
    return n;
  }
  throw new EvaluationError(
    `parseFloat() requires a number or numeric string, got ${typeName(v)}`,
  );
}

export const parseBuiltins: FilterRegistry = {
  parseBool,
  parseInteger,
  parseFloat: parseFloatFn,
};
