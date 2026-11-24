import { ExpressionError } from "../engine/types.js";
import type { ASTNode } from "../parser/ast.js";
import type { TextTemplateNode } from "../parser/text-template.js";
import type { ObjectTemplatePart, ValueTemplateNode } from "../parser/value-template.js";
import { isTruthy } from "./evaluate.js";
import {
  EvaluationError,
  isAtomicValue,
  type Value,
  typeName,
} from "./types.js";

const DROP: unique symbol = Symbol("tavnit.template.drop");

type Path = Array<string | number>;

/** A leaf the tree walk needs evaluated: an expression, or a text template rendered to a string. */
export type ValueTemplateLeaf =
  | { kind: "expression"; node: ASTNode; source: string }
  | { kind: "text"; nodes: TextTemplateNode[]; source: string };

/** A node's position below the walk's root, built into a `Path` only when an error needs it. */
interface PathLink {
  readonly parent: PathLink | null;
  readonly key: string | number;
}

interface LeafRequest {
  leaf: ValueTemplateLeaf;
  at: PathLink | null;
}

/** The tree walk yields each leaf to its driver, which evaluates it sync or async and sends the value back. */
type Walk<T> = Generator<LeafRequest, T, Value>;

/**
 * Evaluate a compiled value tree, awaiting only asynchronous leaves. `base` is the path of
 * `root` in its value template; errors carry the path of the failing node.
 */
export async function evaluateValueTemplate(
  root: ValueTemplateNode,
  evaluateLeaf: (leaf: ValueTemplateLeaf) => Value | Promise<Value>,
  base: Path = [],
): Promise<Value> {
  const walk = renderNode(root, null, base);
  let step = walk.next();
  while (!step.done) {
    const { leaf, at } = step.value;
    let value: Value;
    try {
      const pending = evaluateLeaf(leaf);
      value = pending instanceof Promise ? await pending : pending;
    } catch (error) {
      throw locate(error as Error, leaf.source, toPath(at, base));
    }
    step = walk.next(value);
  }
  return step.value === DROP ? null : step.value;
}

/**
 * `evaluateValueTemplate` for a `_` body evaluated inside a synchronous expression. Plain recursion: a body
 * is walked once per row, and a generator frame per node costs more than the leaves it visits.
 */
export function evaluateValueTemplateSync(
  root: ValueTemplateNode,
  evaluateLeaf: (leaf: ValueTemplateLeaf) => Value,
  base: Path,
): Value {
  const value = walkSync(root, null, base, evaluateLeaf);
  return value === DROP ? null : value;
}

/**
 * Point an evaluation error at `source` — the expression its position belongs
 * to — and at `path`, unless a nested `_` body already did.
 */
export function locate(error: Error, source: string, path?: Path): Error {
  if (error instanceof ExpressionError) {
    return path ? new ExpressionError(error.errors.map((diagnostic) => ({ ...diagnostic, path: diagnostic.path ?? path }))) : error;
  }
  if (error instanceof EvaluationError && error.path) return error;
  /* v8 ignore start -- @preserve: evaluate() turns every other error into an EvaluationError */
  const position = error instanceof EvaluationError ? error.position : undefined;
  const origin = error instanceof EvaluationError ? error.source : undefined;
  const details = error instanceof EvaluationError ? error.details : {};
  /* v8 ignore stop -- @preserve */
  return new EvaluationError(error.message, position, { source: origin ?? source, path }, details);
}

function link(parent: PathLink | null, key: string | number): PathLink {
  return { parent, key };
}

function toPath(at: PathLink | null, base: Path): Path {
  const keys: Path = [];
  for (let node = at; node; node = node.parent) keys.unshift(node.key);
  return [...base, ...keys];
}

function* renderNode(node: ValueTemplateNode, at: PathLink | null, base: Path): Walk<Value | typeof DROP> {
  switch (node.kind) {
    case "literal": return node.value;
    case "expression": return yield { leaf: { kind: "expression", node: node.node, source: node.source }, at };
    case "text": return yield { leaf: { kind: "text", nodes: node.nodes, source: node.source }, at };
    case "guard": return (yield* guardPasses(node, at)) ? yield* renderNode(node.body, at, base) : DROP;
    case "object": return yield* renderObject(node.parts, at, base);
    case "array": return yield* renderArray(node.items, at, base);
    // A spread or splice is only ever an array item; renderArray unwraps it.
    /* v8 ignore start -- @preserve */
    case "spread":
    case "splice": return yield* renderNode(node.body, at, base);
    /* v8 ignore stop -- @preserve */
  }
}

function* renderArray(items: ValueTemplateNode[], at: PathLink | null, base: Path): Walk<Value> {
  const result: Value[] = [];
  for (const [index, item] of items.entries()) {
    const itemAt = link(at, index);
    if (item.kind !== "spread" && item.kind !== "splice") {
      const value = yield* renderNode(item, itemAt, base);
      if (value !== DROP) result.push(value);
      continue;
    }
    const bodyAt = item.kind === "spread" ? link(itemAt, "...") : itemAt;
    appendItem(result, item.kind, yield* renderNode(item.body, bodyAt, base), bodyAt, base);
  }
  return result;
}

/** Entries in key order; a spread merges a plain object, a null entry is kept only when written as null. */
function* renderObject(parts: ObjectTemplatePart[], at: PathLink | null, base: Path): Walk<Value> {
  const result: { [key: string]: Value } = {};
  for (const part of parts) {
    if (part.kind === "spread") {
      const spreadAt = link(at, "...");
      mergeSpread(result, yield* renderNode(part.body, spreadAt, base), spreadAt, base);
      continue;
    }
    const { key } = part;
    const entryAt = link(at, typeof key === "string" ? key : key.source);
    const value = yield* renderNode(part.value, entryAt, base);
    if (value === DROP || (value === null && !isLiteralNull(part.value))) continue;
    const name = typeof key === "string" ? key : String(yield { leaf: { kind: "text", nodes: key.nodes, source: key.source }, at: entryAt });
    result[name] = value;
  }
  return result;
}

type GuardNode = Extract<ValueTemplateNode, { kind: "guard" }>;
type GuardValueNode = NonNullable<GuardNode["ifNode"]>;

function* guardPasses(node: GuardNode, at: PathLink | null): Walk<boolean> {
  if (node.ifNode && !isTruthy(yield* guardValue(node.ifNode, link(at, "$if")))) return false;
  return !(node.unlessNode && isTruthy(yield* guardValue(node.unlessNode, link(at, "$unless"))));
}

function* guardValue(node: GuardValueNode, at: PathLink): Walk<Value> {
  if (node.kind === "literal") return node.value;
  return yield { leaf: { kind: "expression", node: node.node, source: node.source }, at };
}

function walkSync(
  node: ValueTemplateNode,
  at: PathLink | null,
  base: Path,
  evaluateLeaf: (leaf: ValueTemplateLeaf) => Value,
): Value | typeof DROP {
  switch (node.kind) {
    case "literal": return node.value;
    case "expression": return leafSync({ kind: "expression", node: node.node, source: node.source }, at, base, evaluateLeaf);
    case "text": return leafSync({ kind: "text", nodes: node.nodes, source: node.source }, at, base, evaluateLeaf);
    case "guard": return guardPassesSync(node, at, base, evaluateLeaf) ? walkSync(node.body, at, base, evaluateLeaf) : DROP;
    case "object": return walkObjectSync(node.parts, at, base, evaluateLeaf);
    case "array": return walkArraySync(node.items, at, base, evaluateLeaf);
    /* v8 ignore start -- @preserve */
    case "spread":
    case "splice": return walkSync(node.body, at, base, evaluateLeaf);
    /* v8 ignore stop -- @preserve */
  }
}

function leafSync(leaf: ValueTemplateLeaf, at: PathLink | null, base: Path, evaluateLeaf: (leaf: ValueTemplateLeaf) => Value): Value {
  try {
    return evaluateLeaf(leaf);
  } catch (error) {
    throw locate(error as Error, leaf.source, toPath(at, base));
  }
}

function guardPassesSync(node: GuardNode, at: PathLink | null, base: Path, evaluateLeaf: (leaf: ValueTemplateLeaf) => Value): boolean {
  if (node.ifNode && !isTruthy(guardValueSync(node.ifNode, link(at, "$if"), base, evaluateLeaf))) return false;
  return !(node.unlessNode && isTruthy(guardValueSync(node.unlessNode, link(at, "$unless"), base, evaluateLeaf)));
}

function guardValueSync(node: GuardValueNode, at: PathLink, base: Path, evaluateLeaf: (leaf: ValueTemplateLeaf) => Value): Value {
  if (node.kind === "literal") return node.value;
  return leafSync({ kind: "expression", node: node.node, source: node.source }, at, base, evaluateLeaf);
}

function walkArraySync(items: ValueTemplateNode[], at: PathLink | null, base: Path, evaluateLeaf: (leaf: ValueTemplateLeaf) => Value): Value {
  const result: Value[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index] as ValueTemplateNode;
    const itemAt = link(at, index);
    if (item.kind !== "spread" && item.kind !== "splice") {
      const value = walkSync(item, itemAt, base, evaluateLeaf);
      if (value !== DROP) result.push(value);
      continue;
    }
    const bodyAt = item.kind === "spread" ? link(itemAt, "...") : itemAt;
    appendItem(result, item.kind, walkSync(item.body, bodyAt, base, evaluateLeaf), bodyAt, base);
  }
  return result;
}

function walkObjectSync(parts: ObjectTemplatePart[], at: PathLink | null, base: Path, evaluateLeaf: (leaf: ValueTemplateLeaf) => Value): Value {
  const result: { [key: string]: Value } = {};
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index] as ObjectTemplatePart;
    if (part.kind === "spread") {
      const spreadAt = link(at, "...");
      mergeSpread(result, walkSync(part.body, spreadAt, base, evaluateLeaf), spreadAt, base);
      continue;
    }
    const { key } = part;
    const entryAt = link(at, typeof key === "string" ? key : key.source);
    const value = walkSync(part.value, entryAt, base, evaluateLeaf);
    if (value === DROP || (value === null && !isLiteralNull(part.value))) continue;
    const name = typeof key === "string" ? key : String(leafSync({ kind: "text", nodes: key.nodes, source: key.source }, entryAt, base, evaluateLeaf));
    result[name] = value;
  }
  return result;
}

/** An array spread or splice item: a spread needs an array, a splice also takes one value. */
function appendItem(result: Value[], kind: "spread" | "splice", value: Value | typeof DROP, bodyAt: PathLink, base: Path): void {
  if (value === DROP || value === null) return;
  if (Array.isArray(value)) result.push(...value);
  else if (kind === "splice") result.push(value);
  else throw new EvaluationError(`Array spread requires an array, got ${typeName(value)}`, undefined, { path: toPath(bodyAt, base) }, { code: "TAV_TYPE" });
}

function mergeSpread(result: { [key: string]: Value }, value: Value | typeof DROP, spreadAt: PathLink, base: Path): void {
  if (value === DROP || value === null) return;
  if (!isPlainObject(value)) {
    throw new EvaluationError(`Object spread requires a plain object, got ${typeName(value)}`, undefined, { path: toPath(spreadAt, base) }, { code: "TAV_TYPE" });
  }
  Object.assign(result, value);
}

function isLiteralNull(node: ValueTemplateNode): boolean { return node.kind === "literal" && node.value === null; }

function isPlainObject(value: Value): value is { [key: string]: Value } {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isAtomicValue(value);
}

/** Value category named in a spread error. */

