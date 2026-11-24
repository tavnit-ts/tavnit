import type { BuiltinCategory } from "../builtins/category.js";
import { encodingBuiltins } from "../builtins/encoding.js";

/** The `encoding` built-ins: base64 and URL encoding. */
export const encoding: BuiltinCategory = {
  name: "encoding",
  filters: {
    ...encodingBuiltins,
  },
};
