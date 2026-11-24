// The public API of @tavnit-ts/tavnit. Anything else — the evaluator, lexer, parser, AST and
// lint — lives in `./internal.ts` (`@tavnit-ts/tavnit/internal`), which is not covered by semver.
// `index.test.ts` pins this list: adding an export here is a deliberate, documented act.

// ── Built-in registry (names only) ────────────────────────────────────────────
export { builtinFilterNames } from "./builtins/names.js";

// ── Engine API ────────────────────────────────────────────────────────────────
export { Cache, createCache, type CacheMetric, type CacheMetrics } from "./engine/cache.js";
export { createEngine } from "./engine/engine.js";
export { Temporal } from "./temporal-polyfill.js";
export type { BuiltinCategory } from "./builtins/category.js";
export type { LinearRegexEngine } from "./evaluator/types.js";
export { type FormatOptions, formatDiagnostic } from "./engine/format.js";
export {
  type Analysis,
  type AnalysisCall,
  type CheckOptions,
  type DataContext,
  type Diagnostic,
  type Engine,
  type EngineOptions,
  Expression,
  ExpressionError,
  type FilterFn,
  type SourceLocation,
  type SourcePosition,
  TextTemplate,
  type Value,
} from "./engine/types.js";

// ── Lazy values and date/time wrappers ────────────────────────────────────────
export {
  TavnitDuration as Duration,
  TavnitInstant as Instant,
  TavnitPlainDate as PlainDate,
  TavnitPlainDateTime as PlainDateTime,
  TavnitPlainTime as PlainTime,
} from "./evaluator/types.js";

// ── Persistence codec ─────────────────────────────────────────────────────────
export { deserialiseValue } from "./defaults.js";
export { serialiseValue } from "./serialisation.js";

// ── Compiled value trees ──────────────────────────────────────────────────────
export { ValueTemplate } from "./parser/value-template.js";
