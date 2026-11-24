import type { FilterRegistry, Value } from "../evaluator/types.js";

function json(v: Value): Value {
  return JSON.stringify(v);
}

export const serialiseBuiltins: FilterRegistry = {
  json,
};
