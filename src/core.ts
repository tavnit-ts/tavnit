// The lean entry point, @tavnit-ts/tavnit/core: the public API without the default set. Its `createEngine`
// registers no built-in, supplies no regex engine and installs no Temporal polyfill, so a bundle holds only
// what the host imports from `@tavnit-ts/tavnit/builtins/*`, `/regex-linear` and `/temporal-polyfill`.
// `index.test.ts` pins this list against `index.ts`.

// ── Built-in registry (names only) ────────────────────────────────────────────
export { builtinFilterNames } from "./builtins/names.js";

// ── Engine API ────────────────────────────────────────────────────────────────
export { Cache, createCache, type CacheMetric, type CacheMetrics } from "./engine/cache.js";
export { createEngine } from "./core-engine.js";
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
export { deserialiseValue, serialiseValue } from "./serialisation.js";

// ── Compiled value trees ──────────────────────────────────────────────────────
export { ValueTemplate } from "./parser/value-template.js";
