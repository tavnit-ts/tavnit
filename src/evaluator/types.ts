import type { ASTNode } from "../parser/ast.js";
import type { SourcePosition } from "../lexer/token.js";

// ── Date/time opaque wrappers ─────────────────────────────────────────────────

/**
 * Base class for all Tavnit date/time wrapper types.
 * Used in evaluate.ts to exclude them from plain-object property access.
 */
export abstract class TavnitDateBase {
  readonly __tavnit_date__ = true as const;
  abstract readonly __tavnit_type__: string;
}

/** Opaque Instant wrapper — a fixed UTC point in time (millisecond resolution). */
export class TavnitInstant extends TavnitDateBase {
  readonly __tavnit_type__ = "instant" as const;
  constructor(readonly _inner: import("@js-temporal/polyfill").Temporal.Instant) { super(); }
}

/** Opaque PlainDate wrapper — a calendar date (year, month, day) with no time. */
export class TavnitPlainDate extends TavnitDateBase {
  readonly __tavnit_type__ = "plaindate" as const;
  constructor(readonly _inner: import("@js-temporal/polyfill").Temporal.PlainDate) { super(); }
}

/** Opaque PlainTime wrapper — a time-of-day without a date. */
export class TavnitPlainTime extends TavnitDateBase {
  readonly __tavnit_type__ = "plaintime" as const;
  constructor(readonly _inner: import("@js-temporal/polyfill").Temporal.PlainTime) { super(); }
}

/** Opaque PlainDateTime wrapper — calendar date + time, no timezone. */
export class TavnitPlainDateTime extends TavnitDateBase {
  readonly __tavnit_type__ = "plaindatetime" as const;
  constructor(readonly _inner: import("@js-temporal/polyfill").Temporal.PlainDateTime) { super(); }
}

/** Opaque Duration wrapper. */
export class TavnitDuration extends TavnitDateBase {
  readonly __tavnit_type__ = "duration" as const;
  constructor(readonly _inner: import("@js-temporal/polyfill").Temporal.Duration) { super(); }
}

/**
 * Transient ZonedDateTime wrapper — produced by toZonedDateTime(), valid only
 * as input to format(). Cannot be compared or stored.
 */
export class TavnitZonedDateTime extends TavnitDateBase {
  readonly __tavnit_type__ = "zoneddatetime" as const;
  constructor(readonly _inner: import("@js-temporal/polyfill").Temporal.ZonedDateTime) { super(); }
}

// ── FunctionValue ─────────────────────────────────────────────────────────────

/**
 * A first-class function value produced by an arrow expression.
 * Closes over the data context at the point of creation.
 * Not serialisable — cannot appear at the top level of a ${{ }} span
 * or as an element of an array/object literal.
 *
 * When `nativeFn` is set this is a thin wrapper around a registered
 * FilterFn / ContextFilterFn so that filter names can be passed as
 * values to higher-order built-ins (e.g. `items | filter(eligible)`).
 * The `body`, `closure` and `locals` are unused in that case.
 */
export class FunctionValue {
  readonly __tavnit_fn__ = true as const;
  constructor(
    readonly params: string[],
    readonly body: ASTNode,
    /** The data context the arrow was created in. */
    readonly closure: DataContext,
    /** The names bound around the arrow when it was created. */
    readonly locals: Locals | null = null,
    /** Internal: set when this FunctionValue wraps a registered native filter. */
    readonly nativeFn?: FilterFn | ContextFilterFn,
  ) {}
}

/**
 * Names bound inside an expression — one arrow call's parameters, or one `let`
 * binding — over the names bound around them. A name is looked up along the chain
 * before the data context, so entering an arrow or a `let` adds one link instead of
 * copying every name in scope.
 */
export interface Locals {
  readonly vars: Readonly<Record<string, Value>>;
  readonly parent: Locals | null;
}

// ── Resolver (lazy async context root) ───────────────────────────────────────

const RESOLVER_BRAND: unique symbol = Symbol("tavnit.resolver");

/**
 * An opaque lazy-resolution root placed in `DataContext`.
 * When the evaluator encounters a member or index access on a Resolver,
 * it calls `fn(key)` and awaits the result instead of doing a plain
 * property lookup.
 *
 * Cannot be stored inside array/object literals or used as a filter argument.
 *
 * Create via `resolve(fn)`.
 */
export class Resolver {
  readonly [RESOLVER_BRAND] = true as const;
  constructor(readonly fn: (key: string) => Promise<Value>, readonly staticValues?: Readonly<Record<string, Value>>) {}
}

/**
 * Create a lazy async context root.
 *
 * @example
 * engine.evaluate(expr, { state: resolve(async (key) => kvStore.get(key)) });
 */
export function resolve(fn: (key: string) => Promise<Value>, staticValues?: Readonly<Record<string, Value>>): Resolver {
  return new Resolver(fn, staticValues);
}

// ── Value type ────────────────────────────────────────────────────────────────

/**
 * The name of a value's type, as `type()` returns it and error messages print
 * it: `null`, `array`, `function`, `resolver`, a date type such as `instant`,
 * or the `typeof` of a primitive or plain object.
 */
export function typeName(value: Value): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof FunctionValue) return "function";
  if (value instanceof Resolver) return "resolver";
  if (value instanceof TavnitDateBase) return value.__tavnit_type__;
  return typeof value;
}

/**
 * True for a value that is a leaf to a value-tree walk: a date/time wrapper,
 * an arrow function or a lazy resolver.
 *
 * Such an instance is a *value*, not an object template. Walking its own
 * properties would rebuild it as a plain object — and a `Temporal.Instant`
 * has no enumerable ones, so the wrapper's `_inner` would collapse to `{}`
 * and the date would be silently lost.
 */
export function isAtomicValue(value: Value): value is Extract<Value, FunctionValue | Resolver | TavnitDateBase> {
  return value instanceof FunctionValue || value instanceof Resolver || value instanceof TavnitDateBase;
}

/** The runtime value union — all types an expression can produce. */
export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value }
  | FunctionValue
  | Resolver
  | TavnitInstant
  | TavnitPlainDate
  | TavnitPlainTime
  | TavnitPlainDateTime
  | TavnitDuration
  | TavnitZonedDateTime;

/** The host-supplied data context — top-level names visible in expressions. */
export type DataContext = Record<string, Value>;

/**
 * A filter function — may be synchronous or asynchronous.
 * The low-level `evaluate()` function is synchronous; the engine's
 * `evaluate()` method handles async filters by wrapping the result.
 */
export type FilterFn = (value: Value, ...args: Value[]) => Value | Promise<Value>;

/** Named filter registry — built-ins and custom filters (public user-facing type). */
export type FilterRegistry = Record<string, FilterFn>;

// ── Runtime limits ────────────────────────────────────────────────────────────

/** One match attempt of a linear-time engine: the part of the `re2js` `Matcher` that `capture` and `captures` read. */
export interface LinearMatcher {
  find(): boolean;
  groupCount(): number;
  group(index: number): string | null;
}

/** A compiled pattern of a linear-time engine. */
export interface LinearPattern {
  test(subject: string): boolean;
  matcher(subject: string): LinearMatcher;
}

/**
 * A regular-expression engine that never backtracks. `@tavnit-ts/tavnit/regex-linear` exports the one
 * Tavnit ships (re2js); `compile` throws `EvaluationError` for a pattern the engine refuses, naming `name`.
 */
export interface LinearRegexEngine {
  compile(pattern: string, name: string): LinearPattern;
}

/**
 * `linear` never backtracks (RE2 syntax) and needs an engine; `native` is the JavaScript RegExp behind
 * static guards; an engine object is `linear` with that engine.
 */
export type RegexMode = "linear" | "native" | LinearRegexEngine;

export interface RuntimeLimits {
  maxDepth: number;
  maxIterations: number;
  /** The step budget of one engine call: the nodes the evaluator may visit. */
  maxSteps: number;
  /** The wall-clock guard in milliseconds; `Infinity` when it is off (the default). */
  timeoutMs: number;
  /** The longest string a built-in may produce, in UTF-16 units. */
  maxStringLength: number;
  /** The longest subject a `native` regular-expression built-in accepts, in UTF-16 units. */
  maxRegexInput: number;
}

// ── Context-aware filter support (internal) ───────────────────────────────────

/**
 * A filter that receives the `EvalContext` as its first argument, so it can charge the iteration budget
 * and invoke a `FunctionValue`. Made by `contextFilter`; the engine hosts and the collection built-ins use it.
 * Not part of the public `FilterFn` API.
 */
export type ContextFilterFn = (ctx: EvalContext, value: Value, ...args: Value[]) => Value | Promise<Value>;

/**
 * The filters made by `contextFilter`. They are recorded here and not marked with a property, because a
 * property added to a function changes its hidden class: `evaluateCall` probes every filter it calls, and
 * the many shapes of marked functions made that probe megamorphic, slowing every call in the process by
 * about 14%.
 */
const contextFilters = new WeakSet<object>();
const synchronousFilters = new WeakSet<object>();

/** Mark a filter as needing the evaluation context. Intended for engine hosts. */
export function contextFilter(fn: ContextFilterFn): ContextFilterFn {
  contextFilters.add(fn);
  return fn;
}

/** Mark a filter whose synchronous attempt has no effects and can be retried asynchronously. */
export function synchronousFilter<T extends ContextFilterFn>(fn: T): T {
  synchronousFilters.add(fn);
  return fn;
}

/** True when an expression may safely retry this filter on the async path. */
export function isSynchronousFilter(fn: FilterFn | ContextFilterFn): boolean {
  return synchronousFilters.has(fn);
}

/** True for a function that `contextFilter` made. */
export function isContextFilter(fn: FilterFn | ContextFilterFn): fn is ContextFilterFn {
  return contextFilters.has(fn);
}

// ── Opaque host handles ───────────────────────────────────────────────────────

/** The objects a host marked with `opaque()`. A `WeakSet`, so the object keeps its shape. */
const opaqueValues = new WeakSet<object>();

/**
 * Mark a host object (a stream, a request-scoped handle) as an opaque value. The context check passes it
 * through even in strict mode; templates carry it from one place to another and filters receive it, and the
 * engine does not walk its fields. Returns the same object.
 */
export function opaque<T extends object>(value: T): T {
  opaqueValues.add(value);
  return value;
}

/** True for an object that `opaque` marked. */
export function isOpaque(value: object): boolean {
  return opaqueValues.has(value);
}

// ── Evaluation context ────────────────────────────────────────────────────────

/** The language modes of an engine: what a name or a field that is not there, and a division by zero, do. */
export interface Semantics {
  /** A name or a field that is not there is an error; when false it reads as `null`. */
  strict: boolean;
  /** A division or a modulo by zero yields `Infinity` or `NaN`; when false it is an error. */
  infiniteDivision: boolean;
  /** A context key set to `undefined` is no name (unknown in strict mode, `null` otherwise); when false it is a name that reads as `null`. */
  undefinedIsAbsent: boolean;
}

export interface EvalContext {
  data: DataContext;
  /** Arrow parameters and `let` bindings in scope; they shadow `data`. */
  locals: Locals | null;
  /** Merged filter registry — user filters (FilterFn) and built-in context-aware filters (ContextFilterFn). */
  filters: Record<string, FilterFn | ContextFilterFn>;
  limits: RuntimeLimits;
  /** Mutable iteration budget shared across all collection operations and loops of one engine call. */
  iterBudget: { remaining: number };
  /** Mutable step budget: the nodes left to visit in one engine call. */
  steps: { remaining: number };
  semantics: Semantics;
  /** Top-level data-context keys whose runtime values are redacted in errors. */
  secretRoots: string[];
  /** The regular-expression engine of `matches`, `capture` and `captures`; `linear` when absent. */
  regex?: RegexMode;
  /** Unix-ms timestamp recorded when evaluation started; used for timeoutMs. */
  startTime: number;
  /** Mutable count of nodes the sync evaluator visits before it next reads the clock; start it at 1. */
  timeoutCheck: { remaining: number };
  /**
   * Invoke a FunctionValue with positional arguments.
   * Set by evaluate.ts before calling any ContextFilterFn so collection
   * builtins can dispatch arrow functions without importing evaluate.ts.
   * Returns `Promise<Value>` when `asyncMode` is true (Resolver-aware path).
   */
  invokeFn: (fn: FunctionValue, args: Value[]) => Value | Promise<Value>;
  /** Optional host dispatcher for a statically registered runtime function. */
  callHostFunction?: (name: string, args: Value[], asyncMode: boolean) => Value | Promise<Value>;
  /** Dynamic values consumed by context-aware host filters. */
  runtimeValues?: Readonly<Record<string, Value>>;
  /**
   * True when evaluation is running through the Resolver-aware async path
   * (`evaluateCallAsync`). Collection builtins use this to switch to async
   * iteration so they can `await` Resolver-backed values inside arrow bodies.
   */
  asyncMode: boolean;
}

/**
 * The one literal that builds an `EvalContext`: the engine's fresh context and every derived one come from
 * it, so all of them share one hidden class and the evaluator's reads of `ctx.*` stay monomorphic.
 */
export function newEvalContext(f: EvalContext): EvalContext {
  return {
    data: f.data,
    locals: f.locals,
    filters: f.filters,
    limits: f.limits,
    iterBudget: f.iterBudget,
    steps: f.steps,
    semantics: f.semantics,
    secretRoots: f.secretRoots,
    regex: f.regex,
    startTime: f.startTime,
    timeoutCheck: f.timeoutCheck,
    invokeFn: f.invokeFn,
    callHostFunction: f.callHostFunction,
    runtimeValues: f.runtimeValues,
    asyncMode: f.asyncMode,
  };
}

// ── Evaluation error ──────────────────────────────────────────────────────────

/** The structured part of an error: its stable code and, for a limit, the limit, its value and the option that raises it. */
export interface ErrorDetails {
  code?: string;
  /** The limit that was exceeded: `iterations`, `steps`, `timeout`, `output`, `depth`, `string`. */
  limit?: string;
  /** The value of that limit. */
  value?: number;
  /** The engine option that raises the limit. */
  option?: string;
  /** The access path of a null access or an unknown field, such as `a.b`. */
  access?: string;
}

export class EvaluationError extends Error {
  /** Stable code and structured fields. */
  readonly details: ErrorDetails;
  /** Position within the expression where the error occurred (1-based line/col). */
  readonly position?: SourcePosition;
  /** End of the failing node, when the error was attributed to one. */
  readonly end?: SourcePosition;
  /** The expression `position` belongs to, when it is not the one being evaluated — a `_` body's. */
  readonly source?: string;
  /** Keys / indexes from a value template's root to the node that failed. */
  readonly path?: Array<string | number>;

  constructor(
    message: string,
    position?: SourcePosition,
    origin?: { source?: string; path?: Array<string | number>; end?: SourcePosition },
    details: ErrorDetails = {},
  ) {
    super(message);
    this.details = details;
    this.name = "EvaluationError";
    this.position = position;
    this.end = origin?.end;
    this.source = origin?.source;
    this.path = origin?.path;
  }
}
