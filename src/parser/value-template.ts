import { ExpressionError, type Diagnostic } from "../engine/types.js";
import { isAtomicValue, type Value } from "../evaluator/types.js";
import type { ASTNode } from "./ast.js";
import { parseTextTemplate, type TextTemplateNode } from "./text-template.js";
import { someNode } from "./walk.js";

export type ValueTemplateNode =
  | { kind: "literal"; value: Value }
  | { kind: "expression"; source: string; node: ASTNode }
  | { kind: "text"; source: string; nodes: TextTemplateNode[] }
  | { kind: "array"; items: ValueTemplateNode[] }
  | { kind: "object"; parts: ObjectTemplatePart[] }
  | { kind: "guard"; ifNode?: GuardTemplateNode; unlessNode?: GuardTemplateNode; body: ValueTemplateNode }
  /** `- ...: X` in an array: an array contributes its elements, null nothing. */
  | { kind: "spread"; body: ValueTemplateNode }
  /** An unguarded `$_` host in an array: an array contributes its elements, null nothing, anything else itself. */
  | { kind: "splice"; body: ValueTemplateNode };

type GuardTemplateNode = Extract<ValueTemplateNode, { kind: "literal" | "expression" }>;

/** A static key, or a text template rendered when the object is evaluated. */
export type ObjectTemplateKey = string | { source: string; nodes: TextTemplateNode[] };

export type ObjectTemplatePart =
  | { kind: "entry"; key: ObjectTemplateKey; value: ValueTemplateNode }
  /** `...: X` in a mapping: X must be a plain object or null. */
  | { kind: "spread"; body: ValueTemplateNode };

type TemplatePath = Array<string | number>;

/** Compiles the text of one string value or key. */
type TextCompiler = (template: string) => TextTemplateNode[];

interface Scope {
  parseText: TextCompiler;
  /** Inside a `_` body, whose text is evaluated inside its host expression. */
  insideHoleBody: boolean;
}

/**
 * Opaque compiled handle for a Tavnit value template.
 *
 * Unlike an expression, a value template preserves an object/array tree and
 * may carry structural directives such as `$if`, `$unless`, `...`, `_`, and
 * `$_`. Its compiled form is intentionally private to Tavnit.
 */
export class ValueTemplate {
  /** @internal */
  readonly _root: ValueTemplateNode;
  #static: boolean | undefined;

  constructor(root: ValueTemplateNode) {
    this._root = root;
  }

  /**
   * True when evaluation reads nothing from the context: the tree holds only literals in
   * arrays and in objects with static keys — no expression, text template, directive or
   * templated key. Such a template evaluates to the same value in any context, so a caller
   * may skip building one.
   */
  get isStatic(): boolean {
    this.#static ??= isStaticNode(this._root);
    return this.#static;
  }
}

function isStaticNode(node: ValueTemplateNode): boolean {
  switch (node.kind) {
    case "literal":
      return true;
    case "array":
      return node.items.every(isStaticNode);
    case "object":
      return node.parts.every((part) => part.kind === "entry" && typeof part.key === "string" && isStaticNode(part.value));
    default:
      return false;
  }
}

/**
 * Compile a YAML/JSON-compatible Tavnit value tree.
 *
 * Every expression, text template, object key and structural directive is
 * validated here, and every `_` body is compiled and substituted into its
 * hosts, so evaluation only walks the compiled tree.  A `_` body may still
 * refer to a lambda parameter that does not exist until its host executes.
 * Throws `ExpressionError` whose diagnostics carry the `path` of the failing node.
 */
export function parseValueTemplate(value: Value): ValueTemplate {
  return compileValueTemplate(value, parseTextTemplate);
}

/** `parseValueTemplate` with every string and key compiled by `parseText`. */
export function compileValueTemplate(value: Value, parseText: TextCompiler): ValueTemplate {
  return new ValueTemplate(compileAt(value, { parseText, insideHoleBody: false }, []));
}

/** Run `compile`, attributing an error without a path to `path`. */
function atPath<T>(path: TemplatePath, compile: () => T): T {
  try {
    return compile();
  } catch (error) {
    if (error instanceof ExpressionError && error.errors.every((diagnostic) => diagnostic.path)) throw error;
    const diagnostics: Diagnostic[] = error instanceof ExpressionError
      ? error.errors
      : [{ code: "TAV_SYNTAX", message: (error as Error).message }];
    throw new ExpressionError(diagnostics.map((diagnostic) => ({ ...diagnostic, path: diagnostic.path ?? path })));
  }
}

function compileAt(value: Value, scope: Scope, path: TemplatePath): ValueTemplateNode {
  return atPath(path, () => compileNode(value, scope, path));
}

function compileNode(value: Value, scope: Scope, path: TemplatePath): ValueTemplateNode {
  if (typeof value === "string") return compileString(value, scope);
  if (value === null || typeof value !== "object") return { kind: "literal", value };
  // An already-evaluated value (a date wrapper, an arrow, a resolver) is a leaf, not an
  // object template: a value tree is re-evaluated on its host's terms, and walking such an
  // instance by its properties would rebuild it as a plain object and lose it.
  if (isAtomicValue(value)) return { kind: "literal", value };
  if (Array.isArray(value)) {
    return { kind: "array", items: value.map((item, index) => compileArrayItem(item, scope, [...path, index])) };
  }
  let ifNode: GuardTemplateNode | undefined;
  let unlessNode: GuardTemplateNode | undefined;
  const entries: Array<[string, ValueTemplateNode]> = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "$if") ifNode = atPath([...path, key], () => compileGuard(child, scope));
    else if (key === "$unless") unlessNode = atPath([...path, key], () => compileGuard(child, scope));
    else {
      const childScope = key === "_" ? { ...scope, insideHoleBody: true } : scope;
      entries.push([key, compileAt(child, childScope, [...path, key])]);
    }
  }
  const hole = entries.find(([key]) => key === "_")?.[1];
  const unwrap = entries.find(([key]) => key === "$_")?.[1];
  // `$_` is an unwrapping directive even without a subtree hole.  This keeps
  // a computed scalar or an ordinary YAML tree in the same value position.
  if (!hole && unwrap) {
    const extra = entries.map(([key]) => key).filter((key) => key !== "$_");
    if (extra.length > 0) {
      throw new Error(`\`$_\` must be the only key in its mapping, got: ${extra.join(", ")}`);
    }
    return unwrap;
  }
  const body: ValueTemplateNode = hole
    ? compileHole(hole, entries, scope, path)
    : { kind: "object", parts: entries.map(([key, child]) => objectPart(key, child, scope, path)) };
  return ifNode || unlessNode ? { kind: "guard", ifNode, unlessNode, body } : body;
}

function compileString(value: string, scope: Scope): ValueTemplateNode {
  const nodes = compileText(value, scope);
  if (nodes.length === 1 && nodes[0].kind === "expression") return { kind: "expression", source: nodes[0].source, node: nodes[0].node };
  const text = literalText(nodes);
  return text === null ? { kind: "text", source: value, nodes } : { kind: "literal", value: text };
}

/** A `_` body is evaluated inside its host expression, which has no text-template executor for block tags. */
function compileText(value: string, scope: Scope): TextTemplateNode[] {
  const nodes = scope.parseText(value);
  if (scope.insideHoleBody && nodes.some((node) => node.kind === "if" || node.kind === "for")) {
    throw new Error("block tags are not supported inside a `_` body");
  }
  return nodes;
}

/** The unescaped text of a template without spans or block tags, else null. */
function literalText(nodes: TextTemplateNode[]): string | null {
  let text = "";
  for (const node of nodes) {
    if (node.kind !== "literal") return null;
    text += node.text;
  }
  return text;
}

function objectPart(key: string, value: ValueTemplateNode, scope: Scope, path: TemplatePath): ObjectTemplatePart {
  if (key === "...") return { kind: "spread", body: value };
  const nodes = atPath([...path, key], () => compileText(key, scope));
  return { kind: "entry", key: literalText(nodes) ?? { source: key, nodes }, value };
}

/** An array element is spliced into its array by `- ...: X` and by an unguarded `$_` host. */
function compileArrayItem(value: Value, scope: Scope, path: TemplatePath): ValueTemplateNode {
  if (isRawSpread(value)) return { kind: "spread", body: compileAt(value["..."], scope, [...path, "..."]) };
  const compiled = compileAt(value, scope, path);
  return isRawObject(value) && "$_" in value && compiled.kind === "expression"
    ? { kind: "splice", body: compiled }
    : compiled;
}

function isRawObject(value: Value): value is { [key: string]: Value } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRawSpread(value: Value): value is { "...": Value } {
  return isRawObject(value) && Object.keys(value).length === 1 && "..." in value;
}

/** True when the expression uses the `_` placeholder. */
function usesHole(node: ASTNode): boolean {
  return someNode(node, (child) => child.kind === "identifier" && child.name === "_");
}

/**
 * Validate a `_` / `$_` host mapping and substitute the compiled `_` body for
 * every `_` of each host expression.  A `$_` host becomes that expression;
 * otherwise the mapping stays an object whose host entries are the substituted
 * expressions.
 */
function compileHole(
  body: ValueTemplateNode,
  entries: Array<[string, ValueTemplateNode]>,
  scope: Scope,
  path: TemplatePath,
): ValueTemplateNode {
  const bodyPath = [...path, "_"];
  const unwrap = entries.find(([key]) => key === "$_")?.[1];
  if (unwrap) {
    const extra = entries.map(([key]) => key).filter((key) => key !== "_" && key !== "$_");
    if (extra.length > 0) {
      throw new Error(`\`$_\` must be the only sibling of its \`_\` body, got: ${extra.join(", ")}`);
    }
    if (unwrap.kind !== "expression" || !usesHole(unwrap.node)) {
      throw new Error("`$_` must be a single expression span that references `_`");
    }
    return { ...unwrap, node: substituteHole(unwrap.node, body, bodyPath) };
  }
  const parts: ObjectTemplatePart[] = [];
  let hosts = 0;
  for (const [key, child] of entries) {
    if (key === "_") continue;
    if (child.kind === "expression" && usesHole(child.node)) {
      if (key === "...") {
        throw new Error('a "..." host with a `_` body is not supported — use `$_`');
      }
      hosts++;
      parts.push(objectPart(key, { ...child, node: substituteHole(child.node, body, bodyPath) }, scope, path));
    } else parts.push(objectPart(key, child, scope, path));
  }
  if (hosts === 0) {
    const qualifier = scope.insideHoleBody ? "nested `_` body" : "`_` body";
    throw new Error(`${qualifier} has no sibling expression span that references \`_\``);
  }
  return { kind: "object", parts };
}

function compileGuard(value: Value, scope: Scope): GuardTemplateNode {
  if (typeof value === "boolean") return { kind: "literal", value };
  if (typeof value === "string") {
    const nodes = scope.parseText(value);
    if (nodes.length === 1 && nodes[0].kind === "expression") return { kind: "expression", source: nodes[0].source, node: nodes[0].node };
  }
  throw new Error("$if / $unless must be a boolean literal or a single expression span");
}

/** Replace every `_` in a host expression with the compiled body; ASTs are immutable, so the body is shared. */
function substituteHole(node: ASTNode, template: ValueTemplateNode, path: TemplatePath): ASTNode {
  const sub = (child: ASTNode) => substituteHole(child, template, path);
  switch (node.kind) {
    case "identifier": return node.name === "_" ? { kind: "valueTemplate", template, path, start: node.start, end: node.end } : node;
    case "array": return { ...node, elements: node.elements.map(sub) };
    case "object": return { ...node, entries: node.entries.map(([key, value]) => [key, sub(value)] as [string, ASTNode]) };
    case "unary": return { ...node, operand: sub(node.operand) };
    case "binary": return { ...node, left: sub(node.left), right: sub(node.right) };
    case "member": return { ...node, object: sub(node.object) };
    case "index": return { ...node, object: sub(node.object), key: sub(node.key) };
    case "call": return { ...node, args: node.args.map(sub) };
    case "ternary": return { ...node, condition: sub(node.condition), consequent: sub(node.consequent), alternate: sub(node.alternate) };
    case "pipe": return { ...node, left: sub(node.left), args: node.args.map(sub) };
    case "arrow": return { ...node, body: sub(node.body) };
    case "let": return { ...node, bindings: node.bindings.map(([key, value]) => [key, sub(value)] as [string, ASTNode]), body: sub(node.body) };
    // A host holds no compiled body before its own substitution.
    case "literal":
    case "valueTemplate": return node;
  }
}
