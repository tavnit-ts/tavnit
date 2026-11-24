import { failureCode, failureMessage } from "./failure.js";
import { temporal } from "../temporal.js";
import { ExpressionError } from "../engine/types.js";
import type { SourcePosition } from "../lexer/token.js";
import type { ASTNode, LiteralNode } from "../parser/ast.js";
import {
  type DataContext,
  type Locals,
  type EvalContext,
  EvaluationError,
  FunctionValue,
  isContextFilter,
  isOpaque,
  newEvalContext,
  Resolver,
  TavnitDateBase,
  TavnitInstant,
  TavnitPlainDate,
  TavnitPlainDateTime,
  TavnitPlainTime,
  type Value,
  typeName,
} from "./types.js";
import { codedError, codedErrorAt, limitError, nearest } from "./errors.js";
import { valueToString } from "./stringify.js";
import {
  evaluateValueTemplate,
  evaluateValueTemplateSync,
  locate,
  type ValueTemplateLeaf,
} from "./value-template.js";

// Dummy AST node used as a placeholder body for native-filter FunctionValues.
// It is never evaluated — nativeFn takes priority in callFunctionValue.
const DUMMY_BODY: LiteralNode = {
  kind: "literal",
  value: null,
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Evaluate one leaf of a `_` body in the scope of its host expression. A body's
 * text has only literals and spans — block tags are rejected when it is compiled.
 */
function evaluateBodyLeaf(leaf: ValueTemplateLeaf, ctx: EvalContext, depth: number): Value {
  if (leaf.kind === "expression") return evaluate(leaf.node, ctx, depth);
  let text = "";
  for (const part of leaf.nodes) {
    if (part.kind === "literal") {
      text += part.text;
      continue;
    }
    /* v8 ignore next -- @preserve: block tags are rejected when a `_` body is compiled */
    if (part.kind !== "expression") continue;
    try {
      text += valueToString(evaluate(part.node, ctx, depth));
    } catch (error) {
      throw locate(error as Error, part.source);
    }
  }
  return text;
}

async function evaluateBodyLeafAsync(leaf: ValueTemplateLeaf, ctx: EvalContext, depth: number): Promise<Value> {
  if (leaf.kind === "expression") return evaluateAsync(leaf.node, ctx, depth);
  let text = "";
  for (const part of leaf.nodes) {
    if (part.kind === "literal") {
      text += part.text;
      continue;
    }
    /* v8 ignore next -- @preserve: block tags are rejected when a `_` body is compiled */
    if (part.kind !== "expression") continue;
    try {
      text += valueToString(await evaluateAsync(part.node, ctx, depth));
    } catch (error) {
      throw locate(error as Error, part.source);
    }
  }
  return text;
}

function isObject(v: Value): v is { [key: string]: Value } {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    !(v instanceof FunctionValue) &&
    !(v instanceof Resolver) &&
    !(v instanceof TavnitDateBase)
  );
}

/**
 * Compare two date/time values using the appropriate Temporal.*.compare().
 * Returns a number (-1, 0, 1) when both operands are the same date type,
 * or undefined when they are not comparable date types.
 */
function compareDateLike(left: Value, right: Value): number | undefined {
  if (left instanceof TavnitInstant && right instanceof TavnitInstant) {
    return temporal().Instant.compare(left._inner, right._inner);
  }
  if (left instanceof TavnitPlainDate && right instanceof TavnitPlainDate) {
    return temporal().PlainDate.compare(left._inner, right._inner);
  }
  if (left instanceof TavnitPlainTime && right instanceof TavnitPlainTime) {
    return temporal().PlainTime.compare(left._inner, right._inner);
  }
  if (left instanceof TavnitPlainDateTime && right instanceof TavnitPlainDateTime) {
    return temporal().PlainDateTime.compare(left._inner, right._inner);
  }
  return undefined;
}

/**
 * JS truthiness — the skill's language.md § Truthiness:
 * null, false, 0, NaN, "" are falsy; everything else (including [] and {}) is truthy.
 * The single truthiness rule for expressions, block tags and `$if` / `$unless`.
 */
export function isTruthy(v: Value): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v !== "";
  return true; // arrays, objects, and FunctionValues are truthy
}

function checkDepth(depth: number, limit: number): void {
  if (depth > limit) {
    throw limitError("depth", limit);
  }
}

/** Nodes the sync evaluator visits between two clock reads: `Date.now()` per node costs more than the node. */
const TIMEOUT_CHECK_INTERVAL = 256;

/**
 * `checkTimeout` on the sync path, which reads the clock at the first node and then every
 * {@link TIMEOUT_CHECK_INTERVAL} nodes. Nothing on that path waits, so a sampled check stops
 * an overrun at most that many nodes late. The async path samples the same way and also
 * checks the budget whenever an awaited filter or `Resolver` read returns (see
 * `awaitedWithinBudget`): that wait can take the whole budget at once, and nothing else on
 * the path waits.
 */
function checkTimeoutSampled(ctx: EvalContext): void {
  if (--ctx.timeoutCheck.remaining > 0) return;
  ctx.timeoutCheck.remaining = TIMEOUT_CHECK_INTERVAL;
  checkTimeout(ctx);
}

function checkTimeout(ctx: EvalContext): void {
  if (ctx.limits.timeoutMs !== Number.POSITIVE_INFINITY && Date.now() - ctx.startTime > ctx.limits.timeoutMs) {
    throw limitError("timeout", ctx.limits.timeoutMs);
  }
}

/**
 * Charge one step of the call's budget, deterministically: the same expression and data stop at the
 * same node on any machine. The wall-clock guard behind it reads the clock only when `timeoutMs` is set.
 */
function chargeStep(ctx: EvalContext): void {
  if (--ctx.steps.remaining < 0) throw limitError("steps", ctx.limits.maxSteps);
  if (ctx.limits.timeoutMs !== Number.POSITIVE_INFINITY) checkTimeoutSampled(ctx);
}

/**
 * The one place an `EvalContext` is derived from another: the same filters, limits, budgets and clock, with
 * the scope, the caller of function values and the mode replaced. Built field by field, in the order the engine
 * builds a fresh context, for two reasons measured on the corpus. `{ ...ctx }` copied all thirteen fields
 * through V8's generic clone on every lambda call, a tenth of a `map`, `filter` or `sort` over a list. And a
 * context derived by spread next to one built by a literal has another hidden class, so the reads of
 * `ctx.limits`, `ctx.locals` and the rest turn polymorphic: a `let` or `first()` inside a lambda ran 17% slower.
 * Every field of `EvalContext` is named: the type checker rejects a missing required one, `scoped copies every
 * field` in `evaluator.test.ts` a missing optional one.
 */
function derived(
  ctx: EvalContext,
  data: DataContext,
  locals: Locals | null,
  invokeFn: EvalContext["invokeFn"],
  asyncMode: boolean,
): EvalContext {
  return newEvalContext({
    data,
    locals,
    filters: ctx.filters,
    limits: ctx.limits,
    iterBudget: ctx.iterBudget,
    steps: ctx.steps,
    semantics: ctx.semantics,
    secretRoots: ctx.secretRoots,
    regex: ctx.regex,
    startTime: ctx.startTime,
    timeoutCheck: ctx.timeoutCheck,
    invokeFn,
    callHostFunction: ctx.callHostFunction,
    runtimeValues: ctx.runtimeValues,
    asyncMode,
  });
}

/** `ctx` reading a missing name or field as `null`, whatever the engine's mode: the left side of `??` names its default. */
function withLenientReads(ctx: EvalContext): EvalContext {
  return newEvalContext({ ...ctx, semantics: { strict: false, infiniteDivision: ctx.semantics.infiniteDivision, undefinedIsAbsent: ctx.semantics.undefinedIsAbsent } });
}

/**
 * The context an optional access (`a?.b`, `a?.[k]`) evaluates its receiver in. `?.` marks the receiver and the key
 * as optional: a name or field that is absent reads as `null` there even in strict mode, as `x?.key` does in
 * JavaScript. Only the receiver chain is lenient, never the rest of the expression.
 */
function receiverCtx(optional: boolean | undefined, object: ASTNode, ctx: EvalContext): EvalContext {
  return optional === true && ctx.semantics.strict && isLookup(object) ? withLenientReads(ctx) : ctx;
}

/**
 * True when an optional access finds nothing to read: a plain object without the key, or any other non-null value
 * (an array, a string, a number, a boolean, a date) that has no such property, reads as `null`, not as an error.
 * An index into an array stays an index: `items?.[5]` is decided by `evaluateIndex`.
 */
function optionalKeyAbsent(optional: boolean | undefined, ctx: EvalContext, obj: Value, key: Value): boolean {
  if (optional !== true || !ctx.semantics.strict) return false;
  if (obj === null || obj === undefined || Array.isArray(obj) && typeof key === "number") return false;
  if (!isObject(obj)) return key !== undefined;
  return (typeof key === "string" || typeof key === "number") && !Object.hasOwn(obj, String(key));
}

/** True for a node that reads a name or a field: `a`, `a.b`, `a[k]`. */
function isLookup(node: ASTNode): boolean {
  return node.kind === "identifier" || node.kind === "member" || node.kind === "index";
}

/** `ctx` under another scope: `data` and `locals` replaced, and the mode when given. */
export function scoped(
  ctx: EvalContext,
  data: DataContext,
  locals: Locals | null,
  asyncMode: boolean = ctx.asyncMode,
): EvalContext {
  return derived(ctx, data, locals, ctx.invokeFn, asyncMode);
}

/** `ctx` for a context-aware filter: the same scope, with `invokeFn` calling function values at the caller's depth. */
function withInvoke(ctx: EvalContext, invokeFn: EvalContext["invokeFn"], asyncMode: boolean = ctx.asyncMode): EvalContext {
  return derived(ctx, ctx.data, ctx.locals, invokeFn, asyncMode);
}

/** An arrow call's scope: its parameters bound to `args`, missing ones to null, over the arrow's closure. */
function bindParams(fn: FunctionValue, args: Value[]): Locals {
  const vars: Record<string, Value> = {};
  for (let i = 0; i < fn.params.length; i++) {
    vars[fn.params[i]] = args[i] ?? null;
  }
  return { vars, parent: fn.locals };
}

/**
 * Invoke a FunctionValue: bind params to args, evaluate body in closure scope.
 * When `fn.nativeFn` is set (a registered filter wrapped as a value), delegates
 * directly to that function instead of evaluating an AST body.
 */
export function callFunctionValue(
  fn: FunctionValue,
  args: Value[],
  ctx: EvalContext,
  depth: number,
): Value {
  if (fn.nativeFn !== undefined) {
    const [first = null, ...rest] = args;
    /* v8 ignore start -- @preserve */
    const invokeFnForNative = (fv: FunctionValue, fnArgs: Value[]) =>
      callFunctionValue(fv, fnArgs, ctx, depth);
    /* v8 ignore stop -- @preserve */
    const result = isContextFilter(fn.nativeFn)
      ? fn.nativeFn(withInvoke(ctx, invokeFnForNative), first, ...rest)
      : fn.nativeFn(first, ...rest);
    if (result instanceof Promise) {
      throw codedError("TAV_ASYNC", "Async filter used as a function value — use engine.evaluate() for async support");
    }
    return result;
  }
  const fnCtx = scoped(ctx, fn.closure, bindParams(fn, args));
  return evaluate(fn.body, fnCtx, depth + 1);
}

// ── Core evaluator ────────────────────────────────────────────────────────────

/**
 * Attribute an error raised while evaluating `node` to the node's span, unless
 * a deeper node already did or it belongs to another expression (a `_` body's).
 * A host filter's plain `Error` becomes an `EvaluationError` at its call.
 */
function atNode(error: unknown, node: ASTNode): unknown {
  return atSpan(error, node.start, node.end);
}

function atSpan(error: unknown, start: SourcePosition, end: SourcePosition): unknown {
  if (error instanceof EvaluationError) {
    if (error.position || error.source) return error;
    return new EvaluationError(error.message, start, { path: error.path, end }, error.details);
  }
  if (error instanceof Error && !(error instanceof ExpressionError)) {
    return new EvaluationError(failureMessage(error), start, { end }, { code: failureCode(error) });
  }
  return error;
}

/** A pipe's call fails at `callee(args)`, not at the whole `left | callee(args)`. */
function atPipeCall(error: unknown, node: Extract<ASTNode, { kind: "pipe" }>): unknown {
  return atSpan(error, node.calleeStart, node.end);
}

/**
 * Evaluate an ASTNode against an EvalContext.
 * `depth` is the current call-stack depth; callers start at 1.
 */
export function evaluate(node: ASTNode, ctx: EvalContext, depth = 1): Value {
  try {
    // An `undefined` from the host — a context value, a filter result — is Tavnit's `null`.
    return evaluateNode(node, ctx, depth) ?? null;
  } catch (error) {
    throw atNode(error, node);
  }
}

function evaluateNode(
  node: ASTNode,
  ctx: EvalContext,
  depth: number,
): Value {
  checkDepth(depth, ctx.limits.maxDepth);
  chargeStep(ctx);

  switch (node.kind) {
    case "literal":
      return node.value;

    case "identifier":
      return checkRead(evaluateIdentifier(node.name, ctx), node, ctx);

    case "array": {
      const elements = node.elements.map((el) => evaluate(el, ctx, depth + 1));
      for (const el of elements) {
        if (el instanceof FunctionValue) {
          throw codedError("TAV_TYPE", "Function values cannot be stored inside array literals");
        }
        if (el instanceof Resolver) {
          throw codedError("TAV_TYPE", "Resolver values cannot be stored inside array literals");
        }
      }
      return elements;
    }

    case "object": {
      const entries = node.entries.map(
        ([key, val]) => [key, evaluate(val, ctx, depth + 1)] as [string, Value],
      );
      for (const [, val] of entries) {
        if (val instanceof FunctionValue) {
          throw codedError("TAV_TYPE", "Function values cannot be stored inside object literals");
        }
        if (val instanceof Resolver) {
          throw codedError("TAV_TYPE", "Resolver values cannot be stored inside object literals");
        }
      }
      return Object.fromEntries(entries);
    }

    case "valueTemplate":
      return evaluateValueTemplateSync(node.template, (leaf) => evaluateBodyLeaf(leaf, ctx, depth + 1), node.path);

    case "unary":
      return evaluateUnary(node.op, evaluate(node.operand, ctx, depth + 1));

    case "binary":
      return evaluateBinary(node, ctx, depth);

    case "member": {
      const obj = evaluate(node.object, receiverCtx(node.optional, node.object, ctx), depth + 1);
      if ((obj === null || obj === undefined) && !node.optional) {
        throw nullAccess(node.object, `read \`${node.property}\``);
      }
      if (optionalKeyAbsent(node.optional, ctx, obj, node.property)) return null;
      return checkRead(evaluateMember(obj, node.property, ctx, node.object), node, ctx);
    }

    case "index": {
      const obj = evaluate(node.object, receiverCtx(node.optional, node.object, ctx), depth + 1);
      const key = evaluate(node.key, ctx, depth + 1);
      if ((obj === null || obj === undefined) && !node.optional) {
        throw nullAccess(node.object, "read an index");
      }
      if (optionalKeyAbsent(node.optional, ctx, obj, key)) return null;
      return checkRead(evaluateIndex(obj, key, ctx, node.object), node, ctx);
    }

    case "call":
      return evaluateCall(
        node.callee,
        node.args.map((a) => evaluate(a, ctx, depth + 1)),
        ctx,
        depth,
      );

    case "ternary": {
      const cond = evaluate(node.condition, ctx, depth + 1);
      return isTruthy(cond)
        ? evaluate(node.consequent, ctx, depth + 1)
        : evaluate(node.alternate, ctx, depth + 1);
    }

    case "pipe": {
      // Normalise pipe: left | callee(args)  →  callee(left, ...args)
      const args = [evaluate(node.left, ctx, depth + 1), ...node.args.map((a) => evaluate(a, ctx, depth + 1))];
      try {
        return evaluateCall(node.callee, args, ctx, depth);
      } catch (error) {
        throw atPipeCall(error, node);
      }
    }

    case "arrow":
      // Capture the current scope as the closure
      return new FunctionValue(node.params, node.body, ctx.data, ctx.locals);

    case "let": {
      // Evaluate bindings sequentially; each result is added to the scope
      // for subsequent bindings and the body. A name is NOT in scope during
      // its own binding expression (no self-reference). One link per binding:
      // an arrow in a binding must not see the bindings after it.
      let locals = ctx.locals;
      for (const [name, expr] of node.bindings) {
        checkDepth(depth + 1, ctx.limits.maxDepth);
        locals = { vars: { [name]: evaluate(expr, scoped(ctx, ctx.data, locals), depth + 1) }, parent: locals };
      }
      return evaluate(node.body, scoped(ctx, ctx.data, locals), depth + 1);
    }
  }
}

// ── Node-kind helpers ─────────────────────────────────────────────────────────

/** The access path of a node that reads a name, a field or an index: `a`, `a.b`, `a[0]`, `a["k"]`; undefined for anything else. */
function accessPath(node: ASTNode): string | undefined {
  switch (node.kind) {
    case "identifier":
      return node.name;
    case "member": {
      const object = accessPath(node.object);
      return object === undefined ? undefined : `${object}.${node.property}`;
    }
    case "index": {
      const object = accessPath(node.object);
      if (object === undefined) return undefined;
      return node.key.kind === "literal" ? `${object}[${JSON.stringify(node.key.value)}]` : `${object}[…]`;
    }
    default:
      return undefined;
  }
}

// ── Reads of host data ────────────────────────────────────────────────────────

/** A JavaScript container or handle that is never data: a collection, a promise, a pattern, an error, a binary buffer. */
function isBuiltinContainer(value: object): boolean {
  return value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet
    || value instanceof Promise || value instanceof RegExp || value instanceof Error
    || value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

/** A class instance that is not data: what the host should pass instead. */
function instanceProblem(name: string): string {
  switch (name) {
    case "Map":
      return "is a Map; convert it with Object.fromEntries()";
    case "Set":
      return "is a Set; convert it with Array.from()";
    case "Promise":
      return "is a Promise; await it before the call, or pass a resolve() root";
    default:
      return `is an instance of ${name}; pass a plain object, array, string, number, boolean, null or Date`;
  }
}

/** A value the host put in the context and Tavnit cannot read: the message names the path of the read. */
function refusedRead(node: ASTNode, problem: string): EvaluationError {
  const path = accessPath(node);
  const subject = path === undefined ? "(the context itself)" : `\`${path}\``;
  return codedErrorAt("TAV_CONTEXT", node.end, `Context value ${subject} ${problem}`, path === undefined ? {} : { access: path });
}

/**
 * The check of a value as the evaluator reads it by name, field or index, in place of a walk over the whole context
 * before the call: only what an expression reaches is looked at, and a plain value costs a type test. A function, a
 * `BigInt`, a symbol, a `Map`, a `Set`, a `Promise`, a `RegExp`, an `Error`, a binary buffer and an invalid `Date` raise
 * `TAV_CONTEXT`; so does an instance of any other named class in strict mode. A valid `Date` becomes an instant. The
 * members of a container are checked when they are read in turn. An `undefined` from the host is `null`.
 *
 * Only the identifier, member and index cases of `evaluateNode` and `evaluateNodeAsync` call it. Called from
 * `evaluate()`, which wraps every node, it made a comparator `sort` over 200 rows 20% slower (460 µs against 380).
 */
function checkRead(value: Value | undefined, node: ASTNode, ctx: EvalContext): Value {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object": {
      if (value === null || Array.isArray(value)) return value;
      const prototype = Object.getPrototypeOf(value);
      if (prototype === Object.prototype || prototype === null) return value;
      return checkInstance(value as object & Value, prototype, node, ctx);
    }
    case "undefined":
      return null;
    default:
      throw refusedPrimitive(typeof value, node);
  }
}

/** A host can put any JavaScript value in the context; the type says it cannot. */
function refusedPrimitive(type: string, node: ASTNode): EvaluationError {
  if (type === "function") return refusedRead(node, "is a function; Tavnit does not call functions from data (register a filter instead)");
  if (type === "bigint") return refusedRead(node, "is a BigInt; convert it to a number or a string");
  return refusedRead(node, `is a ${type}`);
}

function checkInstance(value: object & Value, prototype: { constructor?: { name?: string } }, node: ASTNode, ctx: EvalContext): Value {
  if (value instanceof FunctionValue || value instanceof Resolver || value instanceof TavnitDateBase || isOpaque(value)) return value;
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) throw refusedRead(node, "is an invalid Date");
    return new TavnitInstant(temporal().Instant.fromEpochMilliseconds(time));
  }
  // Data is a plain object or an instance of an anonymous class, such as `process.env`. A named class is not data.
  // A built-in container never reads right, so it is always refused; an instance of the host's own class is an
  // opaque handle a host filter may take, and only strict mode refuses it.
  const name: string = prototype.constructor?.name ?? "";
  if (name !== "" && name !== "Object") {
    if (ctx.semantics.strict || isBuiltinContainer(value)) throw refusedRead(node, instanceProblem(name));
  }
  return value;
}

/** A read of `what` on a null `objectNode`: the message names the path that is null. */
function nullAccess(objectNode: ASTNode, what: string): EvaluationError {
  const path = accessPath(objectNode);
  const message = path === undefined ? `Value is null, cannot ${what}` : `\`${path}\` is null, cannot ${what}`;
  return codedErrorAt("TAV_NULL_ACCESS", objectNode.end, message, path === undefined ? {} : { access: path });
}

function divisionByZero(operation: "Division" | "Modulo"): EvaluationError {
  return codedError("TAV_DIVISION_BY_ZERO", `${operation} by zero; set divisionByZero to "infinity" to allow it`);
}

/** The suffix of a message that offers the nearest known name. */
function didYouMean(suggestion: string | undefined): string {
  return suggestion === undefined ? "" : `; did you mean '${suggestion}'?`;
}

/** Strict mode: a name that is not in scope, with the nearest name that is. */
function unknownName(name: string, ctx: EvalContext): EvaluationError {
  const known = new Set<string>(Object.keys(ctx.data).filter((key) => ctx.data[key] !== undefined || !ctx.semantics.undefinedIsAbsent));
  for (let locals = ctx.locals; locals !== null; locals = locals.parent) {
    for (const local of Object.keys(locals.vars)) known.add(local);
  }
  const hint = didYouMean(nearest(name, known));
  return codedError("TAV_UNKNOWN_NAME", `Unknown name '${name}'${hint}`, { access: name });
}

/** Strict mode: a property or key that the value does not have, with the nearest one it has. */
function missingProperty(obj: Value, property: string, objectNode: ASTNode): EvaluationError {
  const path = accessPath(objectNode);
  const type = typeName(obj);
  const subject = path === undefined ? `A value of type ${type}` : `\`${path}\``;
  let hint = "";
  if (isObject(obj)) {
    hint = didYouMean(nearest(property, Object.keys(obj)));
  } else if ((type === "array" || type === "string") && (property === "length" || property === "len" || property === "count")) {
    hint = `; use size(${path ?? "value"}) to count`;
  }
  return codedError("TAV_UNKNOWN_PROPERTY", `${subject} has no property '${property}'${hint}`, { access: path === undefined ? property : `${path}.${property}` });
}

/** The function that is not registered, with the nearest name that is. */
function unknownFunction(callee: string, ctx: EvalContext): EvaluationError {
  const hint = didYouMean(nearest(callee, Object.keys(ctx.filters)));
  return codedError("TAV_UNKNOWN_FUNCTION", `Unknown function '${callee}'${hint}`);
}

/** The filter registered as `name`; an `Object.prototype` member such as `toString` is not one. */
function lookupFilter(ctx: EvalContext, name: string): EvalContext["filters"][string] | undefined {
  return Object.hasOwn(ctx.filters, name) ? ctx.filters[name] : undefined;
}

function evaluateIdentifier(name: string, ctx: EvalContext): Value {
  for (let locals = ctx.locals; locals !== null; locals = locals.parent) {
    if (Object.hasOwn(locals.vars, name)) return locals.vars[name];
  }
  if (Object.hasOwn(ctx.data, name)) {
    const value = ctx.data[name];
    // `undefinedIsAbsent`: a key the host set to `undefined` is no name (an unknown name in strict mode, `null` otherwise).
    if (value !== undefined || !ctx.semantics.undefinedIsAbsent) return value;
  }
  // A registered filter used as a value (e.g. `items | filter(eligible)` where
  // `eligible` is a named filter, not a data-context key). Wrap it so that
  // higher-order built-ins can invoke it via callFunctionValue.
  const nativeFn = lookupFilter(ctx, name);
  if (nativeFn !== undefined) {
    return new FunctionValue([], DUMMY_BODY, {}, null, nativeFn);
  }
  if (ctx.semantics.strict) throw unknownName(name, ctx);
  return null;
}

function evaluateUnary(op: string, operand: Value): Value {
  switch (op) {
    case "!":
    case "not":
      return !isTruthy(operand);
    case "-":
      if (typeof operand !== "number") {
        throw codedError("TAV_TYPE", `Unary minus requires a number, got ${typeName(operand)}`);
      }
      return -operand;
    /* v8 ignore start -- @preserve */
    default:
      throw new EvaluationError(`Unknown unary operator: ${op}`);
    /* v8 ignore stop -- @preserve */
  }
}

function evaluateBinary(
  node: Extract<ASTNode, { kind: "binary" }>,
  ctx: EvalContext,
  depth: number,
): Value {
  const { op } = node;

  // Short-circuit operators — evaluate right only when needed
  if (op === "&&") {
    const left = evaluate(node.left, ctx, depth + 1);
    return isTruthy(left) ? evaluate(node.right, ctx, depth + 1) : left;
  }
  if (op === "||") {
    const left = evaluate(node.left, ctx, depth + 1);
    return isTruthy(left) ? left : evaluate(node.right, ctx, depth + 1);
  }
  if (op === "??") {
    const left = evaluate(node.left, ctx.semantics.strict && isLookup(node.left) ? withLenientReads(ctx) : ctx, depth + 1);
    return left ?? evaluate(node.right, ctx, depth + 1);
  }

  const left = evaluate(node.left, ctx, depth + 1);
  const right = evaluate(node.right, ctx, depth + 1);
  return evaluateBinaryValues(op, left, right, ctx);
}

/** Shared operator logic for already-evaluated operands. Used by both sync and async paths. */
function evaluateBinaryValues(op: string, left: Value, right: Value, ctx: EvalContext): Value {
  switch (op) {
    case "+":
      if (typeof left === "number" && typeof right === "number") {
        return left + right;
      }
      if (typeof left === "string" || typeof right === "string") {
        // JavaScript semantics: when either operand is a string, coerce the other primitive to string.
        // Arrays, objects, functions, and date types are not coerced — they still throw.
        const isPrimitive = (v: Value): v is string | number | boolean | null =>
          v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
        if (isPrimitive(left) && isPrimitive(right)) {
          return String(left) + String(right);
        }
      }
      throw codedError("TAV_TYPE", `Operator '+' requires two numbers or two strings, got ${typeName(left)} and ${typeName(right)}`);

    case "-":
      ensureNumbers(left, right, "-");
      return (left as number) - (right as number);

    case "*":
      ensureNumbers(left, right, "*");
      return (left as number) * (right as number);

    case "**":
      ensureNumbers(left, right, "**");
      return (left as number) ** (right as number);

    case "/":
      ensureNumbers(left, right, "/");
      if (right === 0 && !ctx.semantics.infiniteDivision) throw divisionByZero("Division");
      return (left as number) / (right as number);

    case "%":
      ensureNumbers(left, right, "%");
      if (right === 0 && !ctx.semantics.infiniteDivision) throw divisionByZero("Modulo");
      return (left as number) % (right as number);

    case "==": {
      const cmpEq = compareDateLike(left, right);
      if (cmpEq !== undefined) return cmpEq === 0;
      return left === right;
    }

    case "!=": {
      const cmpNe = compareDateLike(left, right);
      if (cmpNe !== undefined) return cmpNe !== 0;
      return left !== right;
    }

    case "<": {
      const cmpLt = compareDateLike(left, right);
      if (cmpLt !== undefined) return cmpLt < 0;
      ensureOrdered(left, right, "<");
      return (left as number | string) < (right as number | string);
    }

    case ">": {
      const cmpGt = compareDateLike(left, right);
      if (cmpGt !== undefined) return cmpGt > 0;
      ensureOrdered(left, right, ">");
      return (left as number | string) > (right as number | string);
    }

    case "<=": {
      const cmpLe = compareDateLike(left, right);
      if (cmpLe !== undefined) return cmpLe <= 0;
      ensureOrdered(left, right, "<=");
      return (left as number | string) <= (right as number | string);
    }

    case ">=": {
      const cmpGe = compareDateLike(left, right);
      if (cmpGe !== undefined) return cmpGe >= 0;
      ensureOrdered(left, right, ">=");
      return (left as number | string) >= (right as number | string);
    }

    case "in":
      return evaluateIn(left, right);

    /* v8 ignore start -- @preserve */
    default:
      throw new EvaluationError(`Unknown binary operator: ${op}`);
    /* v8 ignore stop -- @preserve */
  }
}

function ensureNumbers(left: Value, right: Value, op: string): void {
  if (typeof left !== "number" || typeof right !== "number") {
    throw codedError("TAV_TYPE", `Operator '${op}' requires numbers, got ${typeName(left)} and ${typeName(right)}`);
  }
}


/** `<`, `>`, `<=`, `>=` take two numbers or two strings (code-point order); a mixed pair is a type error. */
function ensureOrdered(left: Value, right: Value, op: string): void {
  if (typeof left === "string" && typeof right === "string") return;
  const dateTypes = ["instant", "plaindate", "plaintime", "plaindatetime"];
  const l = typeName(left);
  const r = typeName(right);
  if (dateTypes.includes(l) && dateTypes.includes(r)) {
    throw codedError(
      "TAV_TYPE",
      `Operator '${op}' cannot compare ${l} and ${r}; convert one to the other's type (toInstant, toPlainDate)`,
    );
  }
  if (typeof left === "number" && typeof right === "number") return;
  throw codedError("TAV_TYPE", `Operator '${op}' requires two numbers or two strings, got ${l} and ${r}`);
}

function evaluateIn(needle: Value, haystack: Value): Value {
  if (Array.isArray(haystack)) {
    return haystack.includes(needle);
  }
  if (typeof haystack === "string") {
    if (typeof needle !== "string") {
      throw codedError("TAV_TYPE", `'in' with a string right-hand side requires a string left-hand side, got ${typeName(needle)}`);
    }
    return haystack.includes(needle);
  }
  throw codedError("TAV_TYPE", `'in' right-hand side must be an array or string, got ${typeName(haystack)}`);
}

/** A read of a `Resolver` that has nothing static to answer it; a root name is carried into the message. */
function asyncResolver(objectNode: ASTNode): EvaluationError {
  const name = objectNode.kind === "identifier" ? ` '${objectNode.name}'` : "";
  return codedError("TAV_ASYNC", `Resolver${name} requires async evaluation — use engine.evaluate()`);
}

function evaluateMember(obj: Value, property: string, ctx: EvalContext, objectNode: ASTNode): Value {
  // The callers reject a non-optional access on null; an optional one yields null.
  if (obj === null || obj === undefined) return null;
  if (obj instanceof Resolver) {
    if (obj.staticValues && Object.hasOwn(obj.staticValues, property)) return obj.staticValues[property];
    throw asyncResolver(objectNode);
  }
  if (isObject(obj)) {
    if (Object.hasOwn(obj, property)) return obj[property];
    if (ctx.semantics.strict) throw missingProperty(obj, property, objectNode);
    return null;
  }
  // Arrays only support index access via bracket notation; primitives, dates and function values have no
  // properties. A lenient engine reads any of them as null.
  if (ctx.semantics.strict) throw missingProperty(obj, property, objectNode);
  return null;
}

function evaluateIndex(obj: Value, key: Value, ctx: EvalContext, objectNode: ASTNode): Value {
  // The callers reject a non-optional access on null; an optional one yields null.
  if (obj === null || obj === undefined) return null;
  if (obj instanceof Resolver) {
    if (obj.staticValues && Object.hasOwn(obj.staticValues, String(key))) return obj.staticValues[String(key)];
    throw asyncResolver(objectNode);
  }
  if (Array.isArray(obj)) {
    if (typeof key !== "number") {
      throw codedError("TAV_TYPE", `Array index must be a number, got ${typeName(key)}`);
    }
    const idx = Math.trunc(key);
    if (idx < 0 || idx >= obj.length) return null;
    return obj[idx];
  }
  if (isObject(obj)) {
    if (typeof key !== "string" && typeof key !== "number") {
      throw codedError("TAV_TYPE", `Object key must be a string or number, got ${typeName(key)}`);
    }
    const k = String(key);
    if (Object.hasOwn(obj, k)) return obj[k];
    if (ctx.semantics.strict) throw missingProperty(obj, k, objectNode);
    return null;
  }
  throw codedError("TAV_TYPE", `Cannot index into ${typeName(obj)}`);
}

// ── Async evaluator (Resolver-aware) ─────────────────────────────────────────

/**
 * Async mirror of `callFunctionValue()` that uses `evaluateAsync` for the
 * arrow body, enabling Resolver access inside arrow function bodies.
 * Used exclusively by `evaluateCallAsync`.
 */
async function callFunctionValueAsync(
  fn: FunctionValue,
  args: Value[],
  ctx: EvalContext,
  depth: number,
): Promise<Value> {
  if (fn.nativeFn !== undefined) {
    const [first = null, ...rest] = args;
    /* v8 ignore start -- @preserve */
    const invokeFnForNative = (fv: FunctionValue, fnArgs: Value[]) =>
      callFunctionValueAsync(fv, fnArgs, ctx, depth);
    /* v8 ignore stop -- @preserve */
    const result = isContextFilter(fn.nativeFn)
      ? fn.nativeFn(withInvoke(ctx, invokeFnForNative, true), first, ...rest)
      : fn.nativeFn(first, ...rest);
    return result instanceof Promise ? await result : result;
  }
  const fnCtx = scoped(ctx, fn.closure, bindParams(fn, args), true);
  return evaluateAsync(fn.body, fnCtx, depth + 1);
}

/**
 * Async mirror of `evaluateCall()` that injects an async-aware `invokeFn` and
 * sets `asyncMode: true` on the context forwarded to `ContextFilterFn`s.
 * Collection builtins detect `asyncMode` and switch to async iteration, enabling
 * Resolver access inside arrow function bodies (e.g. `filter(x => state.x > 0)`).
 */
async function evaluateCallAsync(
  callee: string,
  args: Value[],
  ctx: EvalContext,
  depth: number,
): Promise<Value> {
  const fn = lookupFilter(ctx, callee);
  if (fn === undefined) {
    throw unknownFunction(callee, ctx);
  }
  const [first = null, ...rest] = args;

  if (isContextFilter(fn)) {
    const ctxForFilter = withInvoke(
      ctx,
      (fv: FunctionValue, fnArgs: Value[]) => callFunctionValueAsync(fv, fnArgs, ctx, depth),
      true,
    );
    return awaitedWithinBudget(fn(ctxForFilter, first, ...rest), ctx);
  }

  return awaitedWithinBudget(fn(first, ...rest), ctx);
}

/** A filter's or `Resolver`'s result: when it is a promise, wait for it, then check the budget. */
async function awaitedWithinBudget(result: Value | Promise<Value>, ctx: EvalContext): Promise<Value> {
  if (!(result instanceof Promise)) return result;
  const value = await result;
  checkTimeout(ctx);
  return value;
}

/**
 * Async mirror of `evaluate()` that handles `Resolver` values in member/index
 * access by calling and awaiting `resolver.fn(key)`.
 *
 * The engine calls this instead of `evaluate()` when `DataContext` contains at
 * least one `Resolver` root. All recursive calls use `evaluateAsync` so that
 * Resolvers can flow through `let` bindings and ternaries. Arrow function bodies
 * are also evaluated asynchronously via `callFunctionValueAsync`, so Resolvers
 * are accessible inside arrows passed to collection builtins.
 */
export async function evaluateAsync(node: ASTNode, ctx: EvalContext, depth = 1): Promise<Value> {
  try {
    return (await evaluateNodeAsync(node, ctx, depth)) ?? null;
  } catch (error) {
    throw atNode(error, node);
  }
}

async function evaluateNodeAsync(
  node: ASTNode,
  ctx: EvalContext,
  depth: number,
): Promise<Value> {
  checkDepth(depth, ctx.limits.maxDepth);
  chargeStep(ctx);

  switch (node.kind) {
    case "literal":
      return node.value;

    case "identifier":
      return checkRead(evaluateIdentifier(node.name, ctx), node, ctx);

    case "array": {
      const elements: Value[] = [];
      for (const el of node.elements) {
        const v = await evaluateAsync(el, ctx, depth + 1);
        if (v instanceof FunctionValue) {
          throw codedError("TAV_TYPE", "Function values cannot be stored inside array literals");
        }
        if (v instanceof Resolver) {
          throw codedError("TAV_TYPE", "Resolver values cannot be stored inside array literals");
        }
        elements.push(v);
      }
      return elements;
    }

    case "object": {
      const entries: [string, Value][] = [];
      for (const [key, val] of node.entries) {
        const v = await evaluateAsync(val, ctx, depth + 1);
        if (v instanceof FunctionValue) {
          throw codedError("TAV_TYPE", "Function values cannot be stored inside object literals");
        }
        if (v instanceof Resolver) {
          throw codedError("TAV_TYPE", "Resolver values cannot be stored inside object literals");
        }
        entries.push([key, v]);
      }
      return Object.fromEntries(entries);
    }

    case "valueTemplate":
      return evaluateValueTemplate(node.template, (leaf) => evaluateBodyLeafAsync(leaf, ctx, depth + 1), node.path);

    case "unary":
      return evaluateUnary(node.op, await evaluateAsync(node.operand, ctx, depth + 1));

    case "binary":
      return evaluateBinaryAsync(node, ctx, depth);

    case "member": {
      const obj = await evaluateAsync(node.object, receiverCtx(node.optional, node.object, ctx), depth + 1);
      if (obj instanceof Resolver) {
        return checkRead(await awaitedWithinBudget(obj.fn(node.property), ctx), node, ctx);
      }
      if ((obj === null || obj === undefined) && !node.optional) {
        throw nullAccess(node.object, `read \`${node.property}\``);
      }
      if (optionalKeyAbsent(node.optional, ctx, obj, node.property)) return null;
      return checkRead(evaluateMember(obj, node.property, ctx, node.object), node, ctx);
    }

    case "index": {
      const obj = await evaluateAsync(node.object, receiverCtx(node.optional, node.object, ctx), depth + 1);
      const key = await evaluateAsync(node.key, ctx, depth + 1);
      if (obj instanceof Resolver) {
        if (typeof key !== "string" && typeof key !== "number") {
          throw codedError("TAV_TYPE", `Resolver key must be a string or number, got ${typeName(key)}`);
        }
        return checkRead(await awaitedWithinBudget(obj.fn(String(key)), ctx), node, ctx);
      }
      if ((obj === null || obj === undefined) && !node.optional) {
        throw nullAccess(node.object, "read an index");
      }
      if (optionalKeyAbsent(node.optional, ctx, obj, key)) return null;
      return checkRead(evaluateIndex(obj, key, ctx, node.object), node, ctx);
    }

    case "call":
      return evaluateCallAsync(
        node.callee,
        await Promise.all(node.args.map((a) => evaluateAsync(a, ctx, depth + 1))),
        ctx,
        depth,
      );

    case "ternary": {
      const cond = await evaluateAsync(node.condition, ctx, depth + 1);
      return isTruthy(cond)
        ? evaluateAsync(node.consequent, ctx, depth + 1)
        : evaluateAsync(node.alternate, ctx, depth + 1);
    }

    case "pipe": {
      const args = [
        await evaluateAsync(node.left, ctx, depth + 1),
        ...await Promise.all(node.args.map((a) => evaluateAsync(a, ctx, depth + 1))),
      ];
      try {
        return await evaluateCallAsync(node.callee, args, ctx, depth);
      } catch (error) {
        throw atPipeCall(error, node);
      }
    }

    case "arrow":
      return new FunctionValue(node.params, node.body, ctx.data, ctx.locals);

    case "let": {
      let locals = ctx.locals;
      for (const [name, expr] of node.bindings) {
        checkDepth(depth + 1, ctx.limits.maxDepth);
        locals = { vars: { [name]: await evaluateAsync(expr, scoped(ctx, ctx.data, locals), depth + 1) }, parent: locals };
      }
      return evaluateAsync(node.body, scoped(ctx, ctx.data, locals), depth + 1);
    }
  }
}

async function evaluateBinaryAsync(
  node: Extract<ASTNode, { kind: "binary" }>,
  ctx: EvalContext,
  depth: number,
): Promise<Value> {
  const { op } = node;

  // Short-circuit operators — evaluate right only when needed
  if (op === "&&") {
    const left = await evaluateAsync(node.left, ctx, depth + 1);
    return isTruthy(left) ? evaluateAsync(node.right, ctx, depth + 1) : left;
  }
  if (op === "||") {
    const left = await evaluateAsync(node.left, ctx, depth + 1);
    return isTruthy(left) ? left : evaluateAsync(node.right, ctx, depth + 1);
  }
  if (op === "??") {
    const left = await evaluateAsync(node.left, ctx.semantics.strict && isLookup(node.left) ? withLenientReads(ctx) : ctx, depth + 1);
    return left ?? evaluateAsync(node.right, ctx, depth + 1);
  }

  const left = await evaluateAsync(node.left, ctx, depth + 1);
  const right = await evaluateAsync(node.right, ctx, depth + 1);
  return evaluateBinaryValues(op, left, right, ctx);
}

function evaluateCall(
  callee: string,
  args: Value[],
  ctx: EvalContext,
  depth: number,
): Value {
  const fn = lookupFilter(ctx, callee);
  if (fn === undefined) {
    throw unknownFunction(callee, ctx);
  }
  // zero-arg built-ins (e.g. uuid()) receive null as their first arg and ignore it.
  const [first = null, ...rest] = args;

  if (isContextFilter(fn)) {
    // Inject invokeFn capturing the current depth before dispatching to context filters
    const ctxForFilter = withInvoke(ctx, (fv: FunctionValue, fnArgs: Value[]) => callFunctionValue(fv, fnArgs, ctx, depth));
    const result = fn(ctxForFilter, first, ...rest);
    if (result instanceof Promise) {
      throw codedError("TAV_ASYNC", `Filter '${callee}' is async — use engine.evaluate() for async filter support`);
    }
    return result;
  }

  const result = fn(first, ...rest);
  if (result instanceof Promise) {
    throw codedError("TAV_ASYNC", `Filter '${callee}' is async — use engine.evaluate() for async filter support`);
  }
  return result;
}
