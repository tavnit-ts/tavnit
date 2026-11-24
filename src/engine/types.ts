import type { BuiltinCategory } from "../builtins/category.js";
import type { ContextFilterFn, DataContext, FilterFn, LinearRegexEngine, Value } from "../evaluator/types.js";
import type { SourcePosition } from "../lexer/token.js";
import type { ASTNode } from "../parser/ast.js";
import type { Cache } from "./cache.js";
import { type FormatOptions, formatDiagnostic } from "./format.js";
import type { TextTemplateNode } from "../parser/text-template.js";
import type { ValueTemplate } from "../parser/value-template.js";

export type { ContextFilterFn, DataContext, FilterFn, SourcePosition, Value };

// ── Diagnostics ───────────────────────────────────────────────────────────────

export interface SourceLocation {
  /** Raw expression or template string in which the error occurred. */
  source: string;
  /** Present for parse errors and positioned runtime errors; absent otherwise. */
  start?: SourcePosition;
  /** Present for parse errors (token span); absent for runtime errors. */
  end?: SourcePosition;
}

export interface Diagnostic {
  /**
   * Stable code such as `TAV_LIMIT_ITERATIONS`; every error Tavnit raises has one (the list is in the skill's
   * `errors.md`). A lint diagnostic carries its own rule code.
   */
  code?: string;
  /** Absent diagnostics are errors for backwards compatibility. */
  severity?: "error" | "warning";
  message: string;
  location?: SourceLocation;
  /** Keys / indexes from a value template's root to the node that failed to compile. */
  path?: Array<string | number>;
  /** A limit error: the limit that was exceeded (`iterations`, `steps`, `timeout`, `output`, `depth`, `string`). */
  limit?: string;
  /** A limit error: the value of the limit. */
  value?: number;
  /** A limit error: the `EngineOptions` field that raises the limit. */
  option?: string;
  /** A null access, an unknown name or an unknown field: the access path, such as `a.b`. */
  access?: string;
}

export class ExpressionError extends Error {
  readonly errors: Diagnostic[];

  constructor(errors: Diagnostic[]) {
    /* v8 ignore else -- @preserve */
    super(errors[0]?.message ?? "Expression error");
    this.name = "ExpressionError";
    this.errors = errors;
  }

  /** Every diagnostic as text, for a log or a terminal — see `formatDiagnostic`. */
  format(options?: FormatOptions): string {
    return this.errors.map((diagnostic) => formatDiagnostic(diagnostic, options)).join("\n\n");
  }
}

// ── Opaque handles ────────────────────────────────────────────────────────────

/** Opaque parsed-expression handle returned by `engine.parse()`. */
export class Expression {
  /** @internal */
  readonly _node: ASTNode;
  /** @internal */
  readonly _source: string;

  constructor(node: ASTNode, source: string) {
    this._node = node;
    this._source = source;
  }
}

/**
 * Opaque compiled text template returned by `engine.parseTextTemplate()`. Its content is not part of
 * the public API; tools that walk it import `textTemplateExpressions` from `@tavnit-ts/tavnit/internal`.
 */
export class TextTemplate {
  /** @internal */
  readonly nodes: TextTemplateNode[];
  /** @internal */
  readonly source: string;

  constructor(nodes: TextTemplateNode[], source: string) {
    this.nodes = nodes;
    this.source = source;
  }
}

// ── Static analysis ───────────────────────────────────────────────────────────

/** A call of a named function or filter, with the span of the call in the analysed source. */
export interface AnalysisCall {
  name: string;
  start: SourcePosition;
  end: SourcePosition;
}

/** What `engine.analyze()` reports about a source. */
export interface Analysis {
  /** Free variables — names read from the data context, not bound by an arrow, `let` or `for` — in source order, once each. */
  variables: string[];
  /** Names of the functions and filters called, in source order, once each. */
  functions: string[];
  /** Every call with its position; a position in a text template is a line and column of the template. */
  calls: AnalysisCall[];
}

/** What `engine.check()` accepts. A list left out is not checked. */
export interface CheckOptions {
  /** How to read a string source: an `"expression"` (default) or a `"text"` template. */
  kind?: "expression" | "text";
  /** The data-context names that exist. Without it, no variable is reported. */
  variables?: readonly string[];
  /**
   * The function names that exist, on top of the built-ins and the engine's own filters. Without it, the
   * built-ins and the engine's filters alone are the known functions.
   */
  filters?: readonly string[];
}

// ── Engine interface and options ──────────────────────────────────────────────

export interface EngineOptions {
  maxDepth?: number;
  /**
   * The items and loop iterations one engine call may process across all its collection built-ins and
   * `${% for %}` loops: one budget per `evaluate`, `render` or `renderObject` call. A positive integer;
   * default 1 000 000.
   */
  maxIterations?: number;
  /**
   * The expression nodes one engine call may visit: a deterministic bound on CPU work that does not depend on
   * the machine's speed. A positive integer; default 10 000 000.
   */
  maxSteps?: number;
  /**
   * An opt-in wall-clock guard in milliseconds for one engine call, a host safeguard against a filter that
   * stalls; it makes a result depend on the machine's load. Default: off.
   */
  timeoutMs?: number;
  /**
   * Strict mode: an unknown name, a field the value does not have and a property of a type that has none
   * (such as `a.length` on an array) are errors, with a suggestion of the nearest known name. A division
   * by zero is an error too, unless `divisionByZero` says otherwise. Default: true; `false` is the lenient reading, where all of them read as `null`.
   */
  strict?: boolean;
  /**
   * What a division or a modulo by zero does: `"error"` raises, `"infinity"` yields `Infinity` or `NaN`.
   * Default: `"error"` in strict mode (the default), `"infinity"` when `strict` is false.
   */
  divisionByZero?: "error" | "infinity";
  /**
   * A context key set to `undefined` is no name: an unknown name in strict mode, `null` otherwise, as if the key
   * were not there. Default: false, where such a key is a name that reads as `null`. A host that builds its
   * context from optional values (an environment, a record with absent fields) sets this instead of copying the
   * context to drop the `undefined` entries.
   */
  undefinedIsAbsent?: boolean;
  /** Maximum total output size in bytes for a single `render()` call. Default: 1 MB. */
  maxOutputBytes?: number;
  /**
   * The longest string a built-in may produce (`padStart`, `padEnd`, `replace`, `replaceAll`, `append`,
   * `indent`, `join`, `joinFilled`), in UTF-16 units. A positive integer; default 10 000 000.
   */
  maxStringLength?: number;
  /**
   * The longest subject the `native` regex engine accepts in `matches()`, `capture()` and `captures()`,
   * in UTF-16 units. A positive integer; default 100 000. The `linear` engine has no such cap.
   */
  maxRegexInput?: number;
  /** Cache of compiled expressions and templates, shareable between engines; omit for a private one. */
  cache?: Cache;
  /** Top-level data-context keys whose values are redacted in error messages. */
  secretRoots?: string[];
  /**
   * The engine behind `matches()`, `capture()` and `captures()`. `linear` (default) runs RE2 syntax in
   * linear time, so no pattern can run away. `native` is the JavaScript `RegExp`: lookaround and
   * backreferences work, patterns that can backtrack badly are refused, and a subject over
   * 100 000 characters is refused. An engine object (`linearRegex` from `@tavnit-ts/tavnit/regex-linear`) is
   * `linear` with that engine. The root entry point supplies the linear engine and defaults to it;
   * `@tavnit-ts/tavnit/core` supplies none, so it defaults to `native`, and `"linear"` without an engine
   * raises `TAV_USAGE` when a regex built-in runs.
   */
  regex?: "linear" | "native" | LinearRegexEngine;
  /**
   * The built-in categories to register (`@tavnit-ts/tavnit/builtins/<name>`). Absent: the root entry point
   * registers every category, `@tavnit-ts/tavnit/core` none. A list replaces that default.
   */
  builtins?: readonly BuiltinCategory[];
  filters?: Record<string, FilterFn | ContextFilterFn>;
}

/** Dynamic hooks supplied for one evaluation without deriving a new engine. */
export interface EvaluationOptions {
  /** Dispatches a statically registered host function in the current execution frame. */
  callHostFunction?: (name: string, args: Value[], asyncMode: boolean) => Value | Promise<Value>;
  /** Values supplied to context-aware host filters for this evaluation. */
  runtimeValues?: Readonly<Record<string, Value>>;
}

export interface Engine {
  /** Evaluate an expression. A text template is `render`, a value tree is `renderObject`. */
  evaluate(source: Expression | string, context?: DataContext, options?: EvaluationOptions): Promise<Value>;
  /**
   * `evaluate` without a promise, for an expression with no async filter and no `Resolver`. Throws
   * `ExpressionError` with code `TAV_ASYNC_REQUIRED` when it meets one.
   */
  evaluateSync(source: Expression | string, context?: DataContext, options?: EvaluationOptions): Value;
  /** Render a text template: literal text with `${{ }}` spans and `${% %}` block tags. */
  render(template: string, context?: DataContext): Promise<string>;
  /** `render` without a promise; throws `ExpressionError` with code `TAV_ASYNC_REQUIRED` as `evaluateSync` does. */
  renderSync(template: string, context?: DataContext): string;
  /** Render a value tree (or a compiled `ValueTemplate`): a string is a text template or a single expression. */
  renderObject(value: Value | ValueTemplate, context?: DataContext, options?: EvaluationOptions): Promise<Value>;
  /** `renderObject` without a promise; throws `ExpressionError` with code `TAV_ASYNC_REQUIRED` as `evaluateSync` does. */
  renderObjectSync(value: Value | ValueTemplate, context?: DataContext, options?: EvaluationOptions): Value;
  parse(source: string): Expression;
  parse(value: Value): ValueTemplate;
  /** Compile a text template, memoised on the string. Throws `ExpressionError`. */
  parseTextTemplate(template: string): TextTemplate;
  /**
   * Compile a value tree — a string is a text template or a single expression —
   * memoised on the string or on the tree's identity: do not mutate a tree after
   * passing it here. Throws `ExpressionError` with the failing node's `path`.
   */
  parseValueTemplate(value: Value): ValueTemplate;
  /**
   * The free variables and the calls of a source, without running it. A string is an expression unless
   * `kind` is `"text"`; a compiled `Expression`, `TextTemplate` or `ValueTemplate` needs no `kind`.
   * Throws `ExpressionError` on a syntax error.
   */
  analyze(source: string | Expression | TextTemplate | ValueTemplate, kind?: "expression" | "text"): Analysis;
  /**
   * Check a source against the names a host provides, before a run. Returns one diagnostic per unknown
   * variable (`TAV_UNKNOWN_NAME`) and unknown function (`TAV_UNKNOWN_FUNCTION`), each with the nearest
   * known name, its `location` and its `access`; an empty array means the names resolve. Arity is not
   * checked: the registry records none. Throws `ExpressionError` on a syntax error.
   */
  check(source: string | Expression | TextTemplate | ValueTemplate, options?: CheckOptions): Diagnostic[];
  compile(source: string): FilterFn;
  derive(options?: Partial<EngineOptions>): Engine;
}
