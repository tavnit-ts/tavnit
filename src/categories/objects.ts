import type { BuiltinCategory } from "../builtins/category.js";
import { objectBuiltins } from "../builtins/objects.js";
import { serialiseBuiltins } from "../builtins/serialise.js";

/** The `objects` built-ins: pick, omit, keys, values, path and json. */
export const objects: BuiltinCategory = {
  name: "objects",
  filters: {
    ...objectBuiltins,
    ...serialiseBuiltins,
  },
};
