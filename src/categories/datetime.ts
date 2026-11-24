import type { BuiltinCategory } from "../builtins/category.js";
import { datetimeBuiltins } from "../builtins/datetime.js";

/** The `datetime` built-ins: dates and times; needs a Temporal, native or from the polyfill subpath. */
export const datetime: BuiltinCategory = {
  name: "datetime",
  filters: {
    ...datetimeBuiltins,
  },
};
