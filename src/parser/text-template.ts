import { ExpressionError, type SourceLocation } from "../engine/types.js";
import { parseTemplate, TemplateError, type TemplateNode } from "../lexer/spans.js";
import type { SourcePosition } from "../lexer/token.js";
import type { ASTNode } from "./ast.js";
import { ParseError, parse } from "./parse.js";

/** One compiled expression of a text template. */
export interface TextTemplateExpression {
  source: string;
  /** Where `source` starts in the template. */
  offset: number;
  node: ASTNode;
}

/** A compiled text template: literal text, `${{ }}` spans and `${% if/for %}` blocks. */
export type TextTemplateNode =
  | { kind: "literal"; text: string }
  | ({ kind: "expression" } & TextTemplateExpression)
  | {
      kind: "if";
      branches: Array<{ condition: TextTemplateExpression; body: TextTemplateNode[] }>;
      alternate: TextTemplateNode[] | null;
    }
  | { kind: "for"; variable: string; iterable: TextTemplateExpression; body: TextTemplateNode[] };

/**
 * Parse a text template and compile every expression in it, including the
 * conditions and iterables of `${% if/for %}` block tags.  Throws
 * `ExpressionError` located in the template.
 */
export function parseTextTemplate(template: string): TextTemplateNode[] {
  return compileTextTemplate(template, parse);
}

/** `parseTextTemplate` with each expression source compiled by `parseExpression`, which throws `ParseError`. */
export function compileTextTemplate(template: string, parseExpression: (source: string) => ASTNode): TextTemplateNode[] {
  let nodes: TemplateNode[];
  try {
    nodes = parseTemplate(template);
  } catch (error) {
    /* v8 ignore next -- @preserve: parseTemplate() only throws TemplateError */
    if (!(error instanceof TemplateError)) throw error;
    const start = positionInTemplate(template, error.offset);
    throw new ExpressionError([{ code: "TAV_SYNTAX", message: error.message, location: { source: template, start } }]);
  }
  const compileExpression = (source: string, offset: number): TextTemplateExpression => {
    try {
      return { source, offset, node: parseExpression(source) };
    } catch (error) {
      /* v8 ignore next -- @preserve: parse() only throws ParseError */
      if (!(error instanceof ParseError)) throw error;
      const location: SourceLocation = {
        source: template,
        start: positionInSource(template, offset, error.start),
        ...(error.end && { end: positionInSource(template, offset, error.end) }),
      };
      throw new ExpressionError([{ code: "TAV_SYNTAX", message: error.message, location }]);
    }
  };
  const compileNodes = (list: TemplateNode[]): TextTemplateNode[] => list.map(compileNode);
  const compileNode = (node: TemplateNode): TextTemplateNode => {
    switch (node.kind) {
      case "literal": return node;
      case "expression": return { kind: "expression", ...compileExpression(node.source, node.offset + SPAN_OPEN.length) };
      case "if": return {
        kind: "if",
        branches: [
          { condition: compileExpression(node.condition, node.conditionOffset), body: compileNodes(node.consequent) },
          ...node.elseifs.map((branch) => ({
            condition: compileExpression(branch.condition, branch.conditionOffset),
            body: compileNodes(branch.body),
          })),
        ],
        alternate: node.alternate && compileNodes(node.alternate),
      };
      case "for": return {
        kind: "for",
        variable: node.variable,
        iterable: compileExpression(node.iterable, node.iterableOffset),
        body: compileNodes(node.body),
      };
    }
  };
  return compileNodes(nodes);
}

/** Every expression AST in a compiled text template, in source order. */
export function textTemplateExpressions(nodes: TextTemplateNode[]): ASTNode[] {
  const found: ASTNode[] = [];
  const collect = (list: TextTemplateNode[]) => {
    for (const node of list) {
      if (node.kind === "expression") found.push(node.node);
      else if (node.kind === "if") {
        for (const branch of node.branches) {
          found.push(branch.condition.node);
          collect(branch.body);
        }
        if (node.alternate) collect(node.alternate);
      } else if (node.kind === "for") {
        found.push(node.iterable.node);
        collect(node.body);
      }
    }
  };
  collect(nodes);
  return found;
}

const SPAN_OPEN = "${{";

/**
 * The template position of `position`, a 1-based line/column inside the
 * expression source that starts at `offset` in `template`.
 */
export function positionInSource(template: string, offset: number, position: SourcePosition): SourcePosition {
  const lines = template.slice(offset).split("\n");
  let index = offset + position.column - 1;
  for (let line = 0; line < position.line - 1; line++) index += lines[line].length + 1;
  return positionInTemplate(template, index);
}

/** Return the 1-based line/column of `offset` within `template`. */
export function positionInTemplate(template: string, offset: number): SourcePosition {
  const lines = template.slice(0, offset).split("\n");
  /* v8 ignore next -- @preserve: split() always yields at least one line */
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}
