import type { BuiltinCategory } from "../builtins/category.js";
import { regexBuiltins } from "../builtins/regex.js";

/** The `regex` built-ins: matches, capture and captures; the linear mode needs the engine passed as `regex`. */
export const regex: BuiltinCategory = {
  name: "regex",
  filters: {
    ...regexBuiltins,
  },
};
