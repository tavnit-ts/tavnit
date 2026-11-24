import { EvaluationError, typeName } from "../evaluator/types.js";
import type { Value } from "../evaluator/types.js";

export function ensureString(v: Value, name: string): string {
  if (typeof v !== "string") {
    throw new EvaluationError(
      `${name}() requires a string, got ${typeName(v)}`,
    );
  }
  return v;
}

export function ensureStringArg(v: Value, name: string, argName: string): string {
  if (typeof v !== "string") {
    throw new EvaluationError(
      `${name}() argument "${argName}" requires a string, got ${typeName(v)}`,
    );
  }
  return v;
}
