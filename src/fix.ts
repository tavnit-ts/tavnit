import type { SourcePosition } from "./lexer/token.js";
import type { Value } from "./evaluator/types.js";
import type { ASTNode, ObjectLiteralNode } from "./parser/ast.js";
import { parseTextTemplate } from "./parser/text-template.js";
import { children, forEachNode, someNode } from "./parser/walk.js";
import { findBlankIdioms, type ValueTemplateLintOptions } from "./lint.js";
import type { CoalesceFix } from "./typecheck/check.js";

/** The `TAV001` rewrite of one expression: its record moved out into a `_` body. */
export interface InlineObjectFix {
  /**
   * The template that takes the record's place, with the record replaced by
   * `_` — the `$_` host. `undefined` when the record was the whole expression:
   * the body then replaces the value outright.
   */
  host: string | undefined;
  /**
   * The record as a value tree: one `${{ }}` leaf per field, nested records as
   * nested trees. An expression that is an array literal becomes a list.
   */
  body: Value;
}

/** Keys a value tree reads as directives, so a record carrying one cannot become a tree. */
const DIRECTIVE_KEYS = new Set(["_", "$_", "$if", "$unless", "..."]);

/**
 * Rewrite the first inline object literal that `lintValueTemplate` reports
 * (`TAV001`) in a single-span template: the record becomes a value tree and
 * the expression keeps only the walk around it, with `_` where the record was.
 *
 * The outermost reported record is chosen; the records nested in it become
 * nested trees. Returns `undefined` when there is nothing to rewrite or no
 * faithful rewrite exists: the template mixes text with the span, the
 * expression already uses `_`, or a key would read as a directive.
 */
export function fixInlineObject(template: string, options: ValueTemplateLintOptions = {}): InlineObjectFix | undefined {
  const maxFields = options.maxInlineObjectFields ?? 2;
  const nodes = parseTextTemplate(template);
  const spans = nodes.filter((node) => node.kind === "expression");
  if (spans.length !== 1) return undefined;
  if (nodes.some((node) => node.kind !== "expression" && (node.kind !== "literal" || node.text.trim() !== ""))) return undefined;
  const { source, node: root } = spans[0];
  if (someNode(root, (node) => node.kind === "valueTemplate" || (node.kind === "identifier" && node.name === "_"))) return undefined;

  // An array of records is a list in the tree: every element can move, not just one.
  if (root.kind === "array" && root.elements.some((element) => element.kind === "object" && element.entries.length > maxFields)) {
    const items = root.elements.map((element) => leafValue(source, element));
    return items.some((item) => item === undefined) ? undefined : { host: undefined, body: items as Value[] };
  }
  const target = bestOversized(root, maxFields);
  if (target === undefined) return undefined;
  const body = objectTree(source, target);
  if (body === undefined) return undefined;

  let start = offsetIn(source, target.start);
  let end = offsetIn(source, target.end);
  // `x => ({ … })` wraps the record only so the parser reads a record, not a
  // block; with `_` in its place the parentheses are noise. A call's own
  // parentheses (`f({ … })`) stay.
  const before = source.slice(0, start).trimEnd();
  const after = source.slice(end).trimStart();
  if (before.endsWith("(") && after.startsWith(")") && !/[\w)\]]$/.test(before.slice(0, -1).trimEnd())) {
    start = before.length - 1;
    end = source.length - after.length + 1;
  }
  const host = `${source.slice(0, start)}_${source.slice(end)}`;
  return { host: host.trim() === "_" ? undefined : `\${{ ${host.trim()} }}`, body };
}

/**
 * The record to move: only one `_` fits a host, so among the outermost
 * oversized records take the one that carries the most oversized records
 * with it — nested ones become nested trees — then the widest, then the first.
 */
function bestOversized(root: ASTNode, maxFields: number): ObjectLiteralNode | undefined {
  const oversized = (node: ASTNode): node is ObjectLiteralNode => node.kind === "object" && node.entries.length > maxFields;
  const outermost: ObjectLiteralNode[] = [];
  const collect = (node: ASTNode): void => {
    if (oversized(node)) outermost.push(node);
    else for (const child of children(node)) collect(child);
  };
  collect(root);
  const weight = (node: ObjectLiteralNode): number => {
    let count = 0;
    forEachNode(node, (child) => {
      if (oversized(child)) count++;
    });
    return count;
  };
  let best: ObjectLiteralNode | undefined;
  for (const candidate of outermost) {
    if (best === undefined || weight(candidate) > weight(best)
      || (weight(candidate) === weight(best) && candidate.entries.length > best.entries.length)) best = candidate;
  }
  return best;
}

/** A record as a value tree, or `undefined` when a key would read as a directive. */
function objectTree(source: string, node: ObjectLiteralNode): { [key: string]: Value } | undefined {
  const tree: { [key: string]: Value } = {};
  for (const [key, value] of node.entries) {
    if (DIRECTIVE_KEYS.has(key)) return undefined;
    const leaf = leafValue(source, value);
    if (leaf === undefined) return undefined;
    tree[key] = leaf;
  }
  return tree;
}

function leafValue(source: string, node: ASTNode): Value | undefined {
  if (node.kind === "object") return objectTree(source, node);
  // A literal stays a literal unless it would read as a template itself.
  if (node.kind === "literal" && !(typeof node.value === "string" && /\$\{[{%]/.test(node.value))) return node.value;
  const [start, end] = balanced(source, offsetIn(source, node.start), offsetIn(source, node.end));
  return `\${{ ${collapseWhitespace(source.slice(start, end))} }}`;
}

/**
 * Widen `[start, end)` over the grouping parentheses the AST drops: a binary
 * node starts at its left operand, so `(a ?? b) == c` spans `a ?? b) == c`.
 */
function balanced(source: string, start: number, end: number): [number, number] {
  let depth = parenDepth(source.slice(start, end));
  while (depth.open < 0) {
    const before = source.slice(0, start).trimEnd();
    /* v8 ignore next -- @preserve: a valid parsed expression can only have an unmatched closing paren when it starts with its matching opening paren. */
    if (!before.endsWith("(")) break;
    start = before.length - 1;
    depth = parenDepth(source.slice(start, end));
  }
  while (depth.close > 0) {
    const after = source.slice(end);
    const skip = after.length - after.trimStart().length;
    /* v8 ignore next -- @preserve: a valid parsed expression can only have an unmatched opening paren when its matching close follows. */
    if (after[skip] !== ")") break;
    end += skip + 1;
    depth = parenDepth(source.slice(start, end));
  }
  return [start, end];
}

/**
 * Unbalanced parentheses of `text` outside string literals: `open` goes
 * negative for a `)` with no `(` before it, `close` counts `(` never closed.
 */
function parenDepth(text: string): { open: number; close: number } {
  let depth = 0;
  let lowest = 0;
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === "\\") index++;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      lowest = Math.min(lowest, depth);
    }
  }
  return { open: lowest, close: depth - lowest };
}

/** Offset of a 1-based line/column inside `source`. */
function offsetIn(source: string, position: SourcePosition): number {
  let offset = 0;
  for (let line = 1; line < position.line; line++) offset = source.indexOf("\n", offset) + 1;
  return offset + position.column - 1;
}

/** Fold line breaks outside string literals: a field moves to its own one-line leaf. */
function collapseWhitespace(text: string): string {
  let out = "";
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote !== undefined) {
      out += char;
      /* v8 ignore next -- @preserve: a valid Tavnit string cannot end with a dangling escape. */
      if (char === "\\") out += text[++index] ?? "";
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    if (/\s/.test(char)) {
      /* v8 ignore next -- @preserve: AST spans end before trailing whitespace, so the next character is always present while this loop runs. */
      while (/\s/.test(text[index + 1] ?? "")) index++;
      out += " ";
      continue;
    }
    out += char;
  }
  return out.trim();
}

/**
 * Rewrite every `TAV005` blank idiom of a template: `(x ?? '') == ''` and
 * `trim(x ?? '') == ''` become `blank(x)`, the `!= ''` forms `filled(x)`.
 * Returns the new template, or `undefined` when nothing matched.
 *
 * A string of only whitespace is blank too, so the untrimmed forms get slightly
 * broader. Nested idioms are rewritten on later passes.
 */
export function fixBlankIdiom(template: string): string | undefined {
  let current = template;
  for (let pass = 0; pass < 8; pass++) {
    const next = rewriteBlankIdioms(current);
    if (next === undefined) break;
    current = next;
  }
  return current === template ? undefined : current;
}

function rewriteBlankIdioms(template: string): string | undefined {
  let result = "";
  let cursor = 0;
  let changed = false;
  for (const node of parseTextTemplate(template)) {
    if (node.kind !== "expression") continue;
    const edits = findBlankIdioms(node.node).map((idiom) => {
      const [start, end] = balanced(node.source, offsetIn(node.source, idiom.node.start), offsetIn(node.source, idiom.node.end));
      const [from, to] = balanced(node.source, offsetIn(node.source, idiom.operand.start), offsetIn(node.source, idiom.operand.end));
      return { start, end, text: `${idiom.filled ? "filled" : "blank"}(${collapseWhitespace(node.source.slice(from, to))})` };
    });
    if (edits.length === 0) continue;
    changed = true;
    let rewritten = "";
    let at = 0;
    for (const edit of edits.sort((a, b) => a.start - b.start)) {
      rewritten += node.source.slice(at, edit.start) + edit.text;
      at = edit.end;
    }
    rewritten += node.source.slice(at);
    result += template.slice(cursor, node.offset) + rewritten;
    cursor = node.offset + node.source.length;
  }
  return changed ? result + template.slice(cursor) : undefined;
}

/**
 * Remove the fallback of each `a ?? b` the type checker proved redundant (`TAV201`): `args.x ?? ''` becomes
 * `args.x`. `fixes` locate the operands by the index of the `${{ }}` span in `template` and the spans the checker
 * reported; `template` may be the parsed value or the raw source of the scalar, as long as the spans hold the same
 * expressions in the same order. A fix that sits inside another's removed text is dropped: the next pass finds
 * what is left. Returns `undefined` when nothing changed.
 */
export function fixRedundantCoalesce(template: string, fixes: readonly CoalesceFix[]): string | undefined {
  const removals = redundantCoalesceRemovals(template, fixes);
  if (removals.length === 0) return undefined;
  let result = "";
  let cursor = 0;
  for (const removal of removals) {
    result += template.slice(cursor, removal.start);
    cursor = removal.end;
  }
  return result + template.slice(cursor);
}

/**
 * The ranges of `template` (offsets in its text) that `fixRedundantCoalesce` removes, in order. The caller of a
 * template whose written form differs from its value (a folded block scalar) maps them onto the written text.
 */
export function redundantCoalesceRemovals(template: string, fixes: readonly CoalesceFix[]): Array<{ start: number; end: number }> {
  const expressions = parseTextTemplate(template).flatMap((node) => (node.kind === "expression" ? [node] : []));
  const removals: Array<{ start: number; end: number }> = [];
  expressions.forEach((node, index) => {
    const edits = fixes.flatMap((fix) => (fix.expression === index ? coalesceRange(node.source, fix) : []))
      .sort((a, b) => a.start - b.start || b.end - a.end);
    let at = 0;
    let touched = false;
    for (const edit of edits) {
      if (touched && edit.start < at) continue;
      removals.push({ start: node.offset + edit.start, end: node.offset + edit.end });
      at = edit.end;
      touched = true;
    }
  });
  return removals;
}

/**
 * The text of one `a ?? b` from the end of `a` to the end of `b`, parentheses of either operand included:
 * `(a) ?? (b)` gives `) ?? (b)`'s span from the `)` closing `a`'s own parenthesis, so the left keeps its parentheses.
 */
function coalesceRange(source: string, fix: CoalesceFix): Array<{ start: number; end: number }> {
  const leftEnd = offsetIn(source, fix.left.end);
  let operator = leftEnd;
  while (operator < source.length && (source[operator] === ")" || /\s/.test(source[operator]))) operator++;
  if (!source.startsWith("??", operator)) return [];
  // The left operand keeps its own closing parentheses, so the removal starts after them.
  let start = operator;
  while (start > leftEnd && /\s/.test(source[start - 1])) start--;
  // Parentheses opened between the operator and the right operand close after it.
  const rightStart = offsetIn(source, fix.right.start);
  let open = 0;
  for (let at = operator + 2; at < rightStart; at++) if (source[at] === "(") open++;
  let end = offsetIn(source, fix.right.end);
  for (; open > 0; open--) {
    while (end < source.length && /\s/.test(source[end])) end++;
    if (source[end] !== ")") return [];
    end++;
  }
  return [{ start, end }];
}
