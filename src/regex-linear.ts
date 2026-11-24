import { compileLinear } from "./builtins/linear-regex.js";
import type { LinearRegexEngine } from "./evaluator/types.js";

export type { LinearRegexEngine, LinearMatcher, LinearPattern } from "./evaluator/types.js";

/**
 * The linear-time regular-expression engine of Tavnit (re2js behind a JavaScript-meaning translation).
 * Importing this module is what bundles `re2js`; pass it as `createEngine({ regex: linearRegex })`.
 */
export const linearRegex: LinearRegexEngine = { compile: compileLinear };
