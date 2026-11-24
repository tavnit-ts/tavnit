import type { BuiltinCategory } from "../builtins/category.js";
import { stringBuiltins } from "../builtins/strings.js";

/** The `strings` built-ins: string manipulation. */
export const strings: BuiltinCategory = {
  name: "strings",
  filters: {
    ...stringBuiltins,
  },
};
