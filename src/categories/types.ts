import type { BuiltinCategory } from "../builtins/category.js";
import { typeBuiltins } from "../builtins/type.js";
import { parseBuiltins } from "../builtins/parse.js";
import { nullSafetyBuiltins } from "../builtins/null-safety.js";
import { mathBuiltins } from "../builtins/math.js";

/** The `types` built-ins: type, num, str, bool, parse*, default, coalesce and the pipe-friendly arithmetic. */
export const types: BuiltinCategory = {
  name: "types",
  filters: {
    ...typeBuiltins,
    ...parseBuiltins,
    ...nullSafetyBuiltins,
    ...mathBuiltins,
  },
};
