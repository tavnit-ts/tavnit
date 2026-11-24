import type { BuiltinCategory } from "../builtins/category.js";
import { collectionBuiltins } from "../builtins/collections.js";

/** The `collections` built-ins: the collection built-ins. */
export const collections: BuiltinCategory = {
  name: "collections",
  filters: {
    ...collectionBuiltins,
  },
};
