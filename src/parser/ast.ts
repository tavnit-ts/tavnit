import type { SourcePosition } from "../lexer/token.js";
import type { ValueTemplateNode } from "./value-template.js";

export interface LiteralNode {
  kind: "literal";
  value: string | number | boolean | null;
  start: SourcePosition;
  end: SourcePosition;
}

export interface IdentifierNode {
  kind: "identifier";
  name: string;
  start: SourcePosition;
  end: SourcePosition;
}

export interface ArrayLiteralNode {
  kind: "array";
  elements: ASTNode[];
  start: SourcePosition;
  end: SourcePosition;
}

export interface ObjectLiteralNode {
  kind: "object";
  /** Keys are always strings (object literals require quoted string keys). */
  entries: [string, ASTNode][];
  start: SourcePosition;
  end: SourcePosition;
}

/**
 * A compiled `_` body in place of the `_` it replaced in a host expression.
 *
 * **Never produced by the parser**: `parseValueTemplate` substitutes it for
 * every `_` of a host. The evaluator walks `template` with the same rules as
 * the rest of the value tree, in the scope of the surrounding expression, so a
 * body sees the lambda parameters of its host.
 */
export interface ValueTemplateRefNode {
  kind: "valueTemplate";
  template: ValueTemplateNode;
  /** Keys / indexes from the value template's root to this `_` body. */
  path: Array<string | number>;
  start: SourcePosition;
  end: SourcePosition;
}

export type UnaryOp = "!" | "not" | "-";

export interface UnaryOpNode {
  kind: "unary";
  op: UnaryOp;
  operand: ASTNode;
  start: SourcePosition;
  end: SourcePosition;
}

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "**"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "in"
  | "&&"
  | "||"
  | "??";

export interface BinaryOpNode {
  kind: "binary";
  op: BinaryOp;
  left: ASTNode;
  right: ASTNode;
  start: SourcePosition;
  end: SourcePosition;
}

export interface MemberAccessNode {
  kind: "member";
  object: ASTNode;
  property: string;
  optional: boolean;
  start: SourcePosition;
  end: SourcePosition;
}

export interface IndexAccessNode {
  kind: "index";
  object: ASTNode;
  key: ASTNode;
  optional: boolean;
  start: SourcePosition;
  end: SourcePosition;
}

export interface CallNode {
  kind: "call";
  /** Named function only — callee is always a plain identifier string. */
  callee: string;
  args: ASTNode[];
  start: SourcePosition;
  end: SourcePosition;
}

export interface TernaryNode {
  kind: "ternary";
  condition: ASTNode;
  consequent: ASTNode;
  alternate: ASTNode;
  start: SourcePosition;
  end: SourcePosition;
}

export interface PipeNode {
  kind: "pipe";
  left: ASTNode;
  /** Named filter only — kept as a distinct node at parse time. */
  callee: string;
  args: ASTNode[];
  /** Where the callee name starts: `callee(args)` spans `calleeStart` to `end`. */
  calleeStart: SourcePosition;
  start: SourcePosition;
  end: SourcePosition;
}

export interface ArrowNode {
  kind: "arrow";
  params: string[];
  body: ASTNode;
  start: SourcePosition;
  end: SourcePosition;
}

export interface LetInNode {
  kind: "let";
  /** Evaluated in sequence; each name is visible to subsequent bindings and the body. */
  bindings: [string, ASTNode][];
  body: ASTNode;
  start: SourcePosition;
  end: SourcePosition;
}

export type ASTNode =
  | LiteralNode
  | IdentifierNode
  | ArrayLiteralNode
  | ObjectLiteralNode
  | ValueTemplateRefNode
  | UnaryOpNode
  | BinaryOpNode
  | MemberAccessNode
  | IndexAccessNode
  | CallNode
  | TernaryNode
  | PipeNode
  | ArrowNode
  | LetInNode;
