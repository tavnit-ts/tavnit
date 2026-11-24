import type { ContextFilterFn, FilterFn, LinearRegexEngine } from "../evaluator/types.js";

/**
 * A named group of built-in functions. `createEngine({ builtins: [...] })` registers the filters of each
 * category; the categories ship as `@tavnit-ts/tavnit/builtins/<name>` so that a bundle holds only the
 * ones it imports.
 */
export interface BuiltinCategory {
  readonly name: string;
  readonly filters: Readonly<Record<string, FilterFn | ContextFilterFn>>;
}

/** What an entry point supplies to `createEngineWith`: the categories registered by default and the engine behind `regex: "linear"`. */
export interface EngineDefaults {
  readonly builtins: readonly BuiltinCategory[];
  readonly linearRegex?: LinearRegexEngine;
  /** Runs before each engine is created; the root entry point installs the Temporal polyfill here. */
  readonly prepare?: () => void;
}
