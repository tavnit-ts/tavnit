import type { BuiltinCategory } from "../builtins/category.js";
import { cryptoBuiltins } from "../builtins/crypto.js";

/** The `crypto` built-ins: hashes, uuid, random strings. */
export const crypto: BuiltinCategory = {
  name: "crypto",
  filters: {
    ...cryptoBuiltins,
  },
};
