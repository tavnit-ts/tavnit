import type { BuiltinCategory } from "../builtins/category.js";
import { collections } from "./collections.js";
import { crypto } from "./crypto.js";
import { datetime } from "./datetime.js";
import { encoding } from "./encoding.js";
import { objects } from "./objects.js";
import { regex } from "./regex.js";
import { strings } from "./strings.js";
import { types } from "./types.js";
import { yaml } from "./yaml.js";

export type { BuiltinCategory } from "../builtins/category.js";
export { collections, crypto, datetime, encoding, objects, regex, strings, types, yaml };

/** The categories most hosts use: no `Temporal`, no hashes, no YAML and no regex engine in the bundle. */
export const commonBuiltins: readonly BuiltinCategory[] = [types, strings, collections, objects, encoding];

/** Every category: what the root entry point registers when `builtins` is absent. */
export const defaultBuiltins: readonly BuiltinCategory[] = [
  types, strings, regex, collections, objects, yaml, encoding, crypto, datetime,
];
