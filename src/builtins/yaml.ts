import { stringify as yamlStringify } from "yaml";
import type { FilterRegistry, Value } from "../evaluator/types.js";

function yaml(v: Value): Value {
  return yamlStringify(v);
}

export const yamlBuiltins: FilterRegistry = {
  yaml,
};
