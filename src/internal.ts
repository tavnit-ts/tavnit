// Tavnit internals: the evaluator, lexer, parser, AST and static-analysis helpers.
//
// UNSTABLE. This entry point (`@tavnit-ts/tavnit/internal`) is for tools built on Tavnit —
// linters, compilers to other languages, host runtimes. It is not covered by semver: a
// minor or patch release may rename or remove anything here. Application code uses
// `@tavnit-ts/tavnit` and never needs this file.

// ── Low-level evaluator ───────────────────────────────────────────────────────
export { evaluate, evaluateAsync } from "./evaluator/evaluate.js";
export { ERROR_CODES } from "./evaluator/errors.js";
export {
  type EvalContext,
  type Locals,
  contextFilter,
  EvaluationError,
  type FilterRegistry,
  FunctionValue,
  type RegexMode,
  type RuntimeLimits,
} from "./evaluator/types.js";

// ── Lexer ─────────────────────────────────────────────────────────────────────
export type { Span } from "./lexer/spans.js";
export { extractSpans, TemplateError } from "./lexer/spans.js";
export type { Token, TokenKind } from "./lexer/token.js";
export { TokenKind as TokenKindValues } from "./lexer/token.js";
export { LexError, tokenize } from "./lexer/tokenize.js";

// ── Parser ────────────────────────────────────────────────────────────────────
export type {
  ArrayLiteralNode,
  ArrowNode,
  ASTNode,
  BinaryOp,
  BinaryOpNode,
  CallNode,
  IdentifierNode,
  IndexAccessNode,
  LetInNode,
  LiteralNode,
  MemberAccessNode,
  ObjectLiteralNode,
  PipeNode,
  TernaryNode,
  UnaryOp,
  UnaryOpNode,
} from "./parser/ast.js";
export { ParseError, parse } from "./parser/parse.js";
export { parseValueTemplate } from "./parser/value-template.js";
export type { TextTemplateExpression, TextTemplateNode } from "./parser/text-template.js";
export { parseTextTemplate, textTemplateExpressions } from "./parser/text-template.js";
export { forEachNode } from "./parser/walk.js";

// ── Static linting and fixes ──────────────────────────────────────────────────
export {
  lintValueTemplate,
  TAVNIT_LINT_CODE,
  type LintDiagnostic,
  type TavnitLintCode,
  type ValueTemplateLintOptions,
} from "./lint.js";
export { fixBlankIdiom, fixInlineObject, fixRedundantCoalesce, type InlineObjectFix, redundantCoalesceRemovals } from "./fix.js";

// ── Static type checking ──────────────────────────────────────────────────────
export {
  checkExpression,
  checkExpressionSource,
  checkTemplate,
  TAVNIT_TYPE_CODE,
  type CoalesceFix,
  type ExpressionSpan,
  type HostFunctionType,
  type TavnitTypeCode,
  type TypeAssumption,
  type TypeEnvironment,
  type TypeFinding,
} from "./typecheck/check.js";
export {
  arrayOf,
  literalOf,
  asNonEmpty,
  BOOLEAN,
  formatType,
  includesNull,
  isNonEmptyArray,
  NULL,
  NUMBER,
  nullable,
  objectOf,
  type Presence,
  type TavProperty,
  STRING,
  type TavType,
  UNKNOWN,
  unionOf,
  withoutNull,
} from "./typecheck/types.js";
