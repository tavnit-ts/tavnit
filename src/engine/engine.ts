import { failureCode, failureMessage } from "../evaluator/failure.js";
import { codedError, limitError, nearest } from "../evaluator/errors.js";
import type { BuiltinCategory, EngineDefaults } from "../builtins/category.js";
import { defaultSet } from "../defaults.js";
import { evaluate, evaluateAsync } from "../evaluator/evaluate.js";
import { evaluateTextTemplate, evaluateTextTemplateSync, type TextTemplateRuntime } from "../evaluator/text-template.js";
import { evaluateValueTemplate, evaluateValueTemplateSync } from "../evaluator/value-template.js";
import { RESTRICTED } from "../evaluator/restricted.js";
import { valueToString } from "../evaluator/stringify.js";
import {
  EvaluationError,
  Resolver,
  isSynchronousFilter,
  type ContextFilterFn,
  type DataContext,
  type ErrorDetails,
  type EvalContext,
  type LinearRegexEngine,
  newEvalContext,
  type RegexMode,
  type Semantics,
  type Value,
} from "../evaluator/types.js";
import {
  positionInSource,
  positionInTemplate,
  type TextTemplateExpression,
  type TextTemplateNode,
} from "../parser/text-template.js";
import type { ArrowNode, ASTNode } from "../parser/ast.js";
import { ParseError } from "../parser/parse.js";
import { ValueTemplate } from "../parser/value-template.js";
import { Cache } from "./cache.js";
import {
  type Analysis,
  type CheckOptions,
  type Diagnostic,
  type EvaluationOptions,
  type Engine,
  type EngineOptions,
  Expression,
  ExpressionError,
  type FilterFn,
  type SourceLocation,
  TextTemplate,
} from "./types.js";
import { expressionReferences, textReferences, toAnalysis, valueTemplateReferences, type References } from "./analyze.js";

import { MAX_REGEX_INPUT, MAX_STRING_LENGTH } from "../builtins/limits.js";

const DEFAULT_MAX_DEPTH = 50;
const DEFAULT_MAX_ITERATIONS = 1_000_000;
const DEFAULT_MAX_STEPS = 10_000_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MB

/** A limit that must be a positive finite integer; throws `RangeError` otherwise. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive finite integer, got ${String(value)}`);
  }
  return value;
}

// ── Internal config ───────────────────────────────────────────────────────────

interface ResolvedConfig {
  cache: Cache;
  /** Merged registry — user FilterFns and internal ContextFilterFns (collection builtins). */
  filters: Record<string, FilterFn | ContextFilterFn>;
  /** The built-in layer of `filters`: what the selected categories registered. */
  builtins: Record<string, FilterFn | ContextFilterFn>;
  /** The linear regex engine the entry point ships; `regex: "linear"` resolves to it. */
  defaultLinear: LinearRegexEngine | undefined;
  maxDepth: number;
  maxIterations: number;
  maxSteps: number;
  /** `Infinity` while the wall-clock guard is off. */
  timeoutMs: number;
  maxOutputBytes: number;
  strict: boolean;
  /** The explicit option; undefined follows `strict`. */
  divisionByZero: "error" | "infinity" | undefined;
  undefinedIsAbsent: boolean;
  semantics: Semantics;
  maxStringLength: number;
  maxRegexInput: number;
  secretRoots: string[];
  regex: RegexMode;
}

/** Per-template handles, so the same compiled template is the same `TextTemplate`. */
const textTemplates = new WeakMap<TextTemplateNode[], TextTemplate>();

/** The suffix of a message that offers the nearest known name. */
function didYouMean(suggestion: string | undefined): string {
  return suggestion === undefined ? "" : `; did you mean '${suggestion}'?`;
}

/**
 * A `TAV_ASYNC` error of a synchronous method becomes `TAV_ASYNC_REQUIRED`: the message keeps what met the
 * async work and names the method that can wait for it.
 */
function asyncRequired(e: unknown, method: string, asyncMethod: string): unknown {
  /* v8 ignore next -- @preserve: every error of the engine's own methods is an ExpressionError; a safety net */
  if (!(e instanceof ExpressionError)) return e;
  const [first, ...rest] = e.errors;
  if (first?.code !== "TAV_ASYNC") return e;
  const message = `${first.message.split(" — ")[0]}; ${method}() cannot wait for it, use ${asyncMethod}()`;
  return new ExpressionError([{ ...first, code: "TAV_ASYNC_REQUIRED", message }, ...rest]);
}

/** The state of one engine call: its budgets are shared by every span, loop and leaf the call evaluates. */
interface CallBudget {
  iterBudget: { remaining: number };
  steps: { remaining: number };
  timeoutCheck: { remaining: number };
  startTime: number;
}

function newBudget(cfg: ResolvedConfig): CallBudget {
  return {
    iterBudget: { remaining: cfg.maxIterations },
    steps: { remaining: cfg.maxSteps },
    timeoutCheck: { remaining: 1 },
    startTime: cfg.timeoutMs === Number.POSITIVE_INFINITY ? 0 : Date.now(),
  };
}

function resolveSemantics(strict: boolean, divisionByZero: "error" | "infinity" | undefined, undefinedIsAbsent: boolean): Semantics {
  return { strict, infiniteDivision: (divisionByZero ?? (strict ? "error" : "infinity")) === "infinity", undefinedIsAbsent };
}

// ── Engine implementation ─────────────────────────────────────────────────────

class EngineImpl implements Engine {
  readonly #cfg: ResolvedConfig;
  /** Registered filters that are not the built-in of their name — the only ones that may be async. */
  readonly #customFilters: ReadonlySet<string>;
  /** Whether an expression names a custom filter: a property of the node and of this engine's filters alone. */
  readonly #namesCustomFilter = new WeakMap<ASTNode, boolean>();
  /** Nodes that raised `TAV_ASYNC` on the sync path: they take the async path from then on. */
  readonly #asyncNodes = new WeakSet<ASTNode>();

  constructor(cfg: ResolvedConfig) {
    this.#cfg = cfg;
    this.#customFilters = new Set(Object.keys(cfg.filters).filter((name) =>
      !Object.hasOwn(cfg.builtins, name) || cfg.filters[name] !== cfg.builtins[name]));
  }

  parse(source: string): Expression;
  parse(value: Value): ValueTemplate;
  parse(source: string | Value): Expression | ValueTemplate {
    if (typeof source !== "string") return this.#cfg.cache.valueTemplate(source, false);
    try {
      return new Expression(this.#cfg.cache.expression(source), source);
    } catch (e) {
      throw toExpressionError(e, source);
    }
  }

  evaluate(source: Expression | string, context?: DataContext, options?: EvaluationOptions): Promise<Value>;
  async evaluate(source: Expression | string, context: DataContext = {}, options?: EvaluationOptions): Promise<Value> {
    return this.#run(source, context, options, newBudget(this.#cfg));
  }

  /** `evaluate` on a checked context, spending `budget`: the span, loop and leaf evaluations of one call share it. */
  async #run(
    source: Expression | ValueTemplate | string,
    context: DataContext,
    options: EvaluationOptions | undefined,
    budget: CallBudget,
  ): Promise<Value> {
    if (source instanceof ValueTemplate) {
      try {
        return await this.#evaluateValueTemplate(source, context, options, budget);
      } catch (e) {
        throw toExpressionError(e, "", context, this.#cfg.secretRoots);
      }
    }
    let node: ASTNode;
    let src: string;

    if (source instanceof Expression) {
      node = source._node;
      src = source._source;
    } else {
      src = source;
      // parse() populates the cache; throws ExpressionError on syntax errors
      const expr = this.parse(src);
      node = expr._node;
    }

    try {
      return await this.#evaluateNode(node, context, options, budget);
    } catch (e) {
      throw toExpressionError(e, src, context, this.#cfg.secretRoots);
    }
  }

  /**
   * Evaluate a compiled node on the cheapest path that can finish it. The async path costs a promise per node, so it
   * is taken only for a node that has to await a `Resolver` (or an async filter). The node decides: it is evaluated
   * synchronously, and the identifier or member node that reaches a `Resolver` raises `TAV_ASYNC`; the node is then
   * remembered as async and evaluated again on the async path with the budgets as they were. Nothing is scanned
   * before the call. A node that names a custom filter does not take the trial: a filter is the host's code and may
   * have effects, so it runs once, on the path chosen before it (see `#namesCustomFilter`).
   */
  #evaluateNode(node: ASTNode, context: DataContext, options: EvaluationOptions | undefined, budget: CallBudget): Value | Promise<Value> {
    if (this.#asyncNodes.has(node) || this.#customFilterNeedsAsync(node, context)) {
      return evaluateAsync(node, evalContext(this.#cfg, context, options, budget));
    }
    if (this.#namesCustomFilter.get(node) === true) return evaluate(node, evalContext(this.#cfg, context, options, budget));
    const { steps, iterBudget, timeoutCheck } = budget;
    const before = [steps.remaining, iterBudget.remaining, timeoutCheck.remaining] as const;
    try {
      return evaluate(node, evalContext(this.#cfg, context, options, budget));
    } catch (e) {
      if (!(e instanceof EvaluationError) || e.details.code !== "TAV_ASYNC") throw e;
      // A marked host filter can require async execution for one call only
      // (for example when middleware governs that call). Keep later calls eligible.
      const hasSynchronousHost = [...this.#cfg.cache.names(node)].some((name) =>
        this.#customFilters.has(name) && isSynchronousFilter(this.#cfg.filters[name]));
      // A Resolver read is stable for this node, even when it also names a marked host filter.
      // A Promise from a host filter can depend on the call, so only that case stays retryable.
      if (!hasSynchronousHost || e.message.startsWith("Resolver")) this.#asyncNodes.add(node);
      [steps.remaining, iterBudget.remaining, timeoutCheck.remaining] = before;
      return evaluateAsync(node, evalContext(this.#cfg, context, options, budget));
    }
  }

  /**
   * A node that names a custom filter cannot be tried on the sync path (the filter would run twice), so it takes the
   * async path when the context holds a `Resolver`, or names one: without one an async filter throws, as it always has.
   */
  #customFilterNeedsAsync(node: ASTNode, context: DataContext): boolean {
    let customFilter = this.#namesCustomFilter.get(node);
    if (customFilter === undefined) {
      customFilter = false;
      for (const name of this.#cfg.cache.names(node)) {
        if (this.#customFilters.has(name) && !isSynchronousFilter(this.#cfg.filters[name])) customFilter = true;
      }
      this.#namesCustomFilter.set(node, customFilter);
    }
    if (!customFilter) return false;
    for (const name of this.#cfg.cache.names(node)) {
      if (Object.hasOwn(context, name) && context[name] instanceof Resolver) return true;
    }
    return hasResolver(context);
  }

  async renderObject(value: Value | ValueTemplate, context: DataContext = {}, options?: EvaluationOptions): Promise<Value> {
    return this.#run(this.#treeOf(value), context, options, newBudget(this.#cfg));
  }

  #treeOf(value: Value | ValueTemplate): ValueTemplate {
    return value instanceof ValueTemplate ? value : this.#cfg.cache.valueTemplate(value, false);
  }

  evaluateSync(source: Expression | string, context: DataContext = {}, options?: EvaluationOptions): Value {
    try {
      return this.#runSync(source, context, options, newBudget(this.#cfg));
    } catch (e) {
      throw asyncRequired(e, "evaluateSync", "evaluate");
    }
  }

  renderSync(template: string, context: DataContext = {}): string {
    try {
      return this.#renderNodesSync(this.#cfg.cache.textTemplate(template), template, context, undefined, newBudget(this.#cfg));
    } catch (e) {
      throw asyncRequired(e, "renderSync", "render");
    }
  }

  renderObjectSync(value: Value | ValueTemplate, context: DataContext = {}, options?: EvaluationOptions): Value {
    try {
      return this.#valueTemplateSync(this.#treeOf(value), context, options, newBudget(this.#cfg));
    } catch (e) {
      throw asyncRequired(e, "renderObjectSync", "renderObject");
    }
  }

  /** `#run` for an expression with nothing to await; the caller turns a `TAV_ASYNC` error into `TAV_ASYNC_REQUIRED`. */
  #runSync(source: Expression | string, context: DataContext, options: EvaluationOptions | undefined, budget: CallBudget): Value {
    const expression = source instanceof Expression ? source : this.parse(source);
    const { _node: node, _source: src } = expression;
    try {
      // A Resolver is refused when something reads it (the evaluator throws `TAV_ASYNC`), not for being named:
      // `false && state.x` and a `staticValues` read need nothing awaited. A Resolver as the whole result is refused here.
      const result = evaluate(node, evalContext(this.#cfg, context, options, budget));
      if (result instanceof Resolver) throw codedError("TAV_ASYNC", "Resolver requires async evaluation — use engine.evaluate()");
      return result;
    } catch (e) {
      throw toExpressionError(e, src, context, this.#cfg.secretRoots);
    }
  }

  #valueTemplateSync(template: ValueTemplate, context: DataContext, options: EvaluationOptions | undefined, budget: CallBudget): Value {
    try {
      return evaluateValueTemplateSync(template._root, (leaf) => {
        if (leaf.kind === "text") return this.#renderNodesSync(leaf.nodes, leaf.source, context, options, budget);
        return this.#runSync(new Expression(leaf.node, leaf.source), context, options, budget);
      }, []);
    } catch (e) {
      throw toExpressionError(e, "", context, this.#cfg.secretRoots);
    }
  }

  #renderNodesSync(
    nodes: TextTemplateNode[],
    template: string,
    context: DataContext,
    options: EvaluationOptions | undefined,
    budget: CallBudget,
  ): string {
    return evaluateTextTemplateSync(nodes, context, {
      ...this.#textRuntime(template),
      evaluate: (expression, data) => {
        try {
          return this.#runSync(new Expression(expression.node, expression.source), data, options, budget);
        } catch (error) {
          throw enrichError(error, template, expression.source, expression.offset);
        }
      },
    }, budget.iterBudget);
  }

  async #evaluateValueTemplate(template: ValueTemplate, context: DataContext, options: EvaluationOptions | undefined, budget: CallBudget): Promise<Value> {
    return evaluateValueTemplate(template._root, (leaf) => {
      if (leaf.kind === "text") return this.#evaluateTextNodes(leaf.nodes, leaf.source, context, options, budget);
      try {
        return this.#evaluateNode(leaf.node, context, options, budget);
      } catch (error) {
        throw toExpressionError(error, leaf.source, context, this.#cfg.secretRoots);
      }
    });
  }

  async #evaluateTextNodes(
    nodes: TextTemplateNode[],
    template: string,
    context: DataContext,
    options: EvaluationOptions | undefined,
    budget: CallBudget,
  ): Promise<string> {
    return evaluateTextTemplate(nodes, context, {
      ...this.#textRuntime(template),
      evaluate: async (expression, data) => {
        try {
          return await this.#run(new Expression(expression.node, expression.source), data, options, budget);
        } catch (error) {
          throw enrichError(error, template, expression.source, expression.offset);
        }
      },
    }, budget.iterBudget);
  }

  /** The hooks of a text-template run that do not depend on how its expressions are evaluated. */
  #textRuntime(template: string): Omit<TextTemplateRuntime, "evaluate"> {
    return {
      stringify: (value, expression) => {
        try {
          return valueToString(value);
        } catch (error) {
          throw new ExpressionError([{ ...diagnosticOf(error, "TAV_RUNTIME"), location: locate(template, expression) }]);
        }
      },
      outputLimit: (bytes) => this.#checkOutputLimit(bytes),
      invalidIterable: (iterable) => new ExpressionError([{
        code: "TAV_TYPE",
        message: "The 'for' iterable must be an array",
        location: locate(template, iterable),
      }]),
      iterationLimit: (iterable) => new ExpressionError([{
        ...diagnosticOf(limitError("iterations", this.#cfg.maxIterations), "TAV_LIMIT_ITERATIONS"),
        location: locate(template, iterable),
      }]),
    };
  }

  async render(template: string, context: DataContext = {}): Promise<string> {
    return this.#renderText(template, context);
  }

  async #renderText(template: string, context: DataContext): Promise<string> {
    return this.#evaluateTextNodes(this.#cfg.cache.textTemplate(template), template, context, undefined, newBudget(this.#cfg));
  }

  #checkOutputLimit(bytes: number): void {
    if (bytes > this.#cfg.maxOutputBytes) {
      throw new ExpressionError([diagnosticOf(limitError("output", this.#cfg.maxOutputBytes), "TAV_LIMIT_OUTPUT")]);
    }
  }

  parseTextTemplate(template: string): TextTemplate {
    const nodes = this.#cfg.cache.textTemplate(template);
    let handle = textTemplates.get(nodes);
    if (!handle) {
      handle = new TextTemplate(nodes, template);
      textTemplates.set(nodes, handle);
    }
    return handle;
  }

  analyze(source: string | Expression | TextTemplate | ValueTemplate, kind: "expression" | "text" = "expression"): Analysis {
    return toAnalysis(this.#references(source, kind));
  }

  check(source: string | Expression | TextTemplate | ValueTemplate, options: CheckOptions = {}): Diagnostic[] {
    const { variables, calls } = this.#references(source, options.kind ?? "expression");
    const knownVariables = options.variables === undefined ? undefined : new Set(options.variables);
    const knownFunctions = new Set([...Object.keys(this.#cfg.filters), ...(options.filters ?? [])]);
    const found: Array<{ reference: References["calls"][number]; diagnostic: Omit<Diagnostic, "location"> }> = [];
    for (const reference of variables) {
      if (knownVariables === undefined || knownVariables.has(reference.name)) continue;
      const message = `Unknown name '${reference.name}'${didYouMean(nearest(reference.name, knownVariables))}`;
      found.push({ reference, diagnostic: { code: "TAV_UNKNOWN_NAME", severity: "error", message, access: reference.name } });
    }
    for (const reference of calls) {
      if (knownFunctions.has(reference.name)) continue;
      const message = `Unknown function '${reference.name}'${didYouMean(nearest(reference.name, knownFunctions))}`;
      found.push({ reference, diagnostic: { code: "TAV_UNKNOWN_FUNCTION", severity: "error", message } });
    }
    found.sort((a, b) => a.reference.start.line - b.reference.start.line || a.reference.start.column - b.reference.start.column);
    return found.map(({ reference, diagnostic }) => ({
      ...diagnostic,
      location: { source: reference.source, start: reference.start, end: reference.end },
    }));
  }

  #references(source: string | Expression | TextTemplate | ValueTemplate, kind: "expression" | "text"): References {
    if (source instanceof ValueTemplate) return valueTemplateReferences(source._root);
    if (source instanceof TextTemplate) return textReferences(source.nodes, source.source);
    if (source instanceof Expression) return expressionReferences(source._node, source._source);
    if (kind === "text") return textReferences(this.#cfg.cache.textTemplate(source), source);
    return expressionReferences(this.parse(source)._node, source);
  }

  parseValueTemplate(value: Value): ValueTemplate {
    return this.#cfg.cache.valueTemplate(value, true);
  }

  compile(source: string): FilterFn {
    let node: ASTNode;
    try {
      node = this.#cfg.cache.expression(source);
    } catch (e) {
      throw toExpressionError(e, source);
    }

    if (node.kind !== "arrow") {
      throw new ExpressionError([
        {
          code: "TAV_USAGE",
          message:
            "compile() requires an arrow expression at the top level (e.g. 'x => x.active')",
        },
      ]);
    }

    const arrowNode: ArrowNode = node;
    const cfg = this.#cfg;

    return (value: Value, ...args: Value[]): Value | Promise<Value> => {
      // Bind positional call arguments to arrow params; extra args are ignored, missing → null
      const allArgs = [value, ...args];
      const scope: Record<string, Value> = {};
      for (let i = 0; i < arrowNode.params.length; i++) {
        scope[arrowNode.params[i]] = allArgs[i] ?? null;
      }

      try {
        return evaluate(arrowNode.body, evalContext(cfg, scope, undefined, newBudget(cfg)));
      } catch (e) {
        throw toExpressionError(e, source);
      }
    };
  }

  derive(options?: Partial<EngineOptions>): Engine {
    validateFilterNames(options?.filters);

    const {
      cache,
      filters: parent,
      maxDepth,
      maxIterations,
      maxSteps,
      timeoutMs,
      maxOutputBytes,
      maxStringLength,
      maxRegexInput,
      secretRoots,
      regex,
      defaultLinear,
      strict,
      divisionByZero,
      undefinedIsAbsent,
    } = this.#cfg;
    const nextStrict = options?.strict ?? strict;
    const nextDivision = options?.divisionByZero ?? divisionByZero;
    const nextAbsent = options?.undefinedIsAbsent ?? undefinedIsAbsent;

    // Child filters shadow parent filters of the same name; spreading undefined is a no-op
    const added = categoryFilters(options?.builtins);
    const merged: Record<string, FilterFn | ContextFilterFn> = { ...parent, ...added, ...options?.filters };

    return new EngineImpl({
      cache: options?.cache ?? cache,
      filters: merged,
      builtins: { ...this.#cfg.builtins, ...added },
      defaultLinear,
      maxDepth: options?.maxDepth ?? maxDepth,
      maxIterations: options?.maxIterations ?? maxIterations,
      maxSteps: options?.maxSteps === undefined ? maxSteps : positiveLimit("maxSteps", options.maxSteps),
      timeoutMs: options?.timeoutMs ?? timeoutMs,
      maxOutputBytes: options?.maxOutputBytes ?? maxOutputBytes,
      strict: nextStrict,
      divisionByZero: nextDivision,
      undefinedIsAbsent: nextAbsent,
      semantics: resolveSemantics(nextStrict, nextDivision, nextAbsent),
      maxStringLength: options?.maxStringLength === undefined ? maxStringLength : positiveLimit("maxStringLength", options.maxStringLength),
      maxRegexInput: options?.maxRegexInput === undefined ? maxRegexInput : positiveLimit("maxRegexInput", options.maxRegexInput),
      secretRoots: options?.secretRoots ?? secretRoots,
      regex: options?.regex === undefined ? regex : resolveRegex(options.regex, defaultLinear),
    });
  }
}

/** A fresh evaluation of `data` under the engine's filters and limits. */
function evalContext(cfg: ResolvedConfig, data: DataContext, options: EvaluationOptions | undefined, budget: CallBudget): EvalContext {
  return newEvalContext({
    data,
    locals: null,
    filters: cfg.filters,
    limits: { maxDepth: cfg.maxDepth, maxIterations: cfg.maxIterations, maxSteps: cfg.maxSteps, timeoutMs: cfg.timeoutMs, maxStringLength: cfg.maxStringLength, maxRegexInput: cfg.maxRegexInput },
    iterBudget: budget.iterBudget,
    steps: budget.steps,
    semantics: cfg.semantics,
    secretRoots: cfg.secretRoots,
    regex: cfg.regex,
    startTime: budget.startTime,
    timeoutCheck: budget.timeoutCheck,
    // Populated by evaluateCall before dispatching to ContextFilterFns
    /* v8 ignore next -- @preserve */
    invokeFn: () => { throw new EvaluationError("invokeFn not initialised"); },
    callHostFunction: options?.callHostFunction,
    runtimeValues: options?.runtimeValues,
    asyncMode: false,
  });
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function toExpressionError(
  e: unknown,
  source: string,
  data?: DataContext,
  secretRoots: string[] = [],
): ExpressionError {
  if (e instanceof ExpressionError) return e;

  if (e instanceof ParseError) {
    const loc: SourceLocation = { source, start: e.start, end: e.end };
    return new ExpressionError([{ code: "TAV_SYNTAX", message: e.message, location: loc }]);
  }

  const msg = failureMessage(e);
  const redacted =
    data && secretRoots.length > 0
      ? redactSecrets(msg, data, secretRoots)
      : msg;

  // A `_` body's error carries the body expression its position belongs to, and its path.
  const evaluation = e instanceof EvaluationError ? e : undefined;
  const position = evaluation?.position;
  const locatedIn = evaluation?.source ?? source;
  const end = evaluation?.end;
  const location = locatedIn
    ? { source: locatedIn, ...(position && { start: position }), ...(end && { end }) }
    : undefined;
  const path = evaluation?.path;

  const details = evaluation?.details ?? {};
  const code = details.code ?? (evaluation ? "TAV_RUNTIME" : failureCode(e));
  return new ExpressionError([{ code, message: redacted, ...detailFields(details), ...(location && { location }), ...(path && { path }) }]);
}

/** The structured fields of an error's details that are set. */
function detailFields(details: ErrorDetails): Pick<Diagnostic, "limit" | "value" | "option" | "access"> {
  return {
    ...(details.limit !== undefined && { limit: details.limit }),
    ...(details.value !== undefined && { value: details.value }),
    ...(details.option !== undefined && { option: details.option }),
    ...(details.access !== undefined && { access: details.access }),
  };
}

/** The diagnostic of an evaluator error, without a location; `fallback` is its code when the error has none. */
function diagnosticOf(error: unknown, fallback: string): Diagnostic {
  const details = error instanceof EvaluationError ? error.details : {};
  /* v8 ignore next -- @preserve: every EvaluationError raised here is coded; the fallback is a safety net */
  return { code: details.code ?? (error instanceof EvaluationError ? fallback : failureCode(error)), message: failureMessage(error), ...detailFields(details) };
}

/** The span of the whole `expression` in `template`. */
function locate(template: string, expression: TextTemplateExpression): SourceLocation {
  const { node, offset } = expression;
  return {
    source: template,
    start: positionInSource(template, offset, node.start),
    end: positionInSource(template, offset, node.end),
  };
}

/**
 * Re-wrap an ExpressionError raised by the expression `source`, which starts at
 * `offset` in `template`, so its location is in template coordinates.
 * Non-ExpressionError exceptions are wrapped into ExpressionError.
 * (engine.evaluate() always throws ExpressionError, so the fallback path is
 * structurally unreachable in practice.)
 */
function enrichError(
  e: unknown,
  template: string,
  source: string,
  offset: number,
): ExpressionError {
  // engine.evaluate() always throws ExpressionError, so the guard below is a
  // safety net — structurally unreachable in practice.
  /* v8 ignore next -- @preserve */
  if (!(e instanceof ExpressionError)) return toExpressionError(e, template);
  const enriched: Diagnostic[] = e.errors.map((diag) => {
    // A position inside this expression maps into the template; any other stays at the expression.
    const { start, end } = diag.location?.source === source ? diag.location : {};
    return {
      ...diag,
      location: {
        source: template,
        start: start ? positionInSource(template, offset, start) : positionInTemplate(template, offset),
        ...(end && { end: positionInSource(template, offset, end) }),
      } satisfies SourceLocation,
    };
  });
  return new ExpressionError(enriched);
}

/**
 * Replace any string values of secret-root context keys that appear literally
 * in `message` with `[redacted]`.
 */
function redactSecrets(
  message: string,
  data: DataContext,
  secretRoots: string[],
): string {
  let result = message;
  for (const root of secretRoots) {
    const val = data[root];
    if (typeof val === "string" && val.length > 0) {
      result = result.replaceAll(val, "[redacted]");
    }
  }
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Factory ───────────────────────────────────────────────────────────────────

/** Throw immediately if any key in `customFilters` is a reserved prototype name. */
function validateFilterNames(customFilters: Record<string, FilterFn | ContextFilterFn> | undefined): void {
  if (!customFilters) return;
  for (const name of Object.keys(customFilters)) {
    if (RESTRICTED.has(name)) {
      throw new ExpressionError([
        { code: "TAV_USAGE", message: `Cannot register filter with reserved name '${name}'` },
      ]);
    }
  }
}

/** Returns true if any top-level DataContext value is a Resolver, triggering the async evaluation path. */
function hasResolver(context: DataContext): boolean {
  for (const key in context) {
    if (Object.hasOwn(context, key) && context[key] instanceof Resolver) return true;
  }
  return false;
}

/** The merged filters of `categories`, later categories shadowing earlier ones; none when absent. */
function categoryFilters(categories: readonly BuiltinCategory[] | undefined): Record<string, FilterFn | ContextFilterFn> {
  const out: Record<string, FilterFn | ContextFilterFn> = {};
  for (const category of categories ?? []) Object.assign(out, category.filters);
  return out;
}

/** An engine object is the linear engine; `"linear"` is the engine the entry point ships, when it ships one. */
function resolveRegex(setting: EngineOptions["regex"], defaultLinear: LinearRegexEngine | undefined): RegexMode {
  if (setting === undefined || setting === "linear") return defaultLinear ?? (setting === "linear" ? "linear" : "native");
  return setting;
}

/**
 * Create an engine from the defaults of an entry point: the built-in categories registered when
 * `options.builtins` is absent, the linear regex engine behind `regex: "linear"`, and a `prepare` step.
 * The root entry point passes the full set; `@tavnit-ts/tavnit/core` passes an empty one.
 */
export function createEngineWith(defaults: EngineDefaults, options?: EngineOptions): Engine {
  validateFilterNames(options?.filters);
  defaults.prepare?.();
  const builtins = categoryFilters(options?.builtins ?? defaults.builtins);
  // built-ins are the base layer; custom filters spread on top to allow shadowing
  const filters: Record<string, FilterFn | ContextFilterFn> = { ...builtins, ...options?.filters };

  return new EngineImpl({
    cache: options?.cache ?? new Cache(),
    filters,
    builtins,
    defaultLinear: defaults.linearRegex,
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxIterations: options?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    maxSteps: positiveLimit("maxSteps", options?.maxSteps ?? DEFAULT_MAX_STEPS),
    timeoutMs: options?.timeoutMs ?? Number.POSITIVE_INFINITY,
    maxOutputBytes: options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    strict: options?.strict ?? true,
    divisionByZero: options?.divisionByZero,
    undefinedIsAbsent: options?.undefinedIsAbsent ?? false,
    semantics: resolveSemantics(options?.strict ?? true, options?.divisionByZero, options?.undefinedIsAbsent ?? false),
    maxStringLength: positiveLimit("maxStringLength", options?.maxStringLength ?? MAX_STRING_LENGTH),
    maxRegexInput: positiveLimit("maxRegexInput", options?.maxRegexInput ?? MAX_REGEX_INPUT),
    secretRoots: options?.secretRoots ?? [],
    regex: resolveRegex(options?.regex, defaults.linearRegex),
  });
}

/** The engine of the root entry point: every built-in category, the linear regex engine and the Temporal polyfill. */
export function createEngine(options?: EngineOptions): Engine {
  return createEngineWith(defaultSet, options);
}
