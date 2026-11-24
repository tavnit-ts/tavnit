import type { Value } from "./evaluator/types.js";
import { isAtomicValue } from "./evaluator/types.js";
import type { Diagnostic } from "./engine/types.js";
import { positionInSource, type TextTemplateExpression, type TextTemplateNode } from "./parser/text-template.js";
import { parseTextTemplate } from "./parser/text-template.js";
import type { ASTNode, BinaryOpNode } from "./parser/ast.js";
import { children, forEachNode } from "./parser/walk.js";
import { parseValueTemplate } from "./parser/value-template.js";

/** Stable codes for stylistic findings produced by Tavnit itself. */
export const TAVNIT_LINT_CODE = {
  complexInlineObject: "TAV001",
  longExpression: "TAV002",
  nestedTernary: "TAV003",
  manyLambdas: "TAV004",
  blankIdiom: "TAV005",
} as const;

const DISABLED_LINT_CODES: ReadonlySet<TavnitLintCode> = new Set([
  TAVNIT_LINT_CODE.complexInlineObject,
  TAVNIT_LINT_CODE.longExpression,
  TAVNIT_LINT_CODE.nestedTernary,
  TAVNIT_LINT_CODE.manyLambdas,
]);

export type TavnitLintCode = (typeof TAVNIT_LINT_CODE)[keyof typeof TAVNIT_LINT_CODE];

/** A non-fatal, source-positioned finding from a Tavnit lint rule. */
export interface LintDiagnostic extends Diagnostic {
  code: TavnitLintCode;
  severity: "warning";
}

export interface ValueTemplateLintOptions {
  /** Object literals with at most this many direct fields remain inline. Default: 2. */
  maxInlineObjectFields?: number;
  /** An expression longer than this many characters is reported (`TAV002`). Default: 300. */
  maxExpressionLength?: number;
  /** Ternaries nested deeper than this are reported (`TAV003`). Default: 2. */
  maxTernaryDepth?: number;
  /** An expression with more lambdas than this is reported (`TAV004`). Default: 2. */
  maxLambdas?: number;
  /** Report blank idioms (`TAV005`). The rule is off by default while the other style rules are suppressed. Default: false. */
  blankIdiom?: boolean;
}

/** A comparison of an optional string with `''` that `blank()` / `filled()` says shorter. */
export interface BlankIdiom {
  /** The whole comparison. */
  node: BinaryOpNode;
  /** The value being tested: `x` of `(x ?? '') == ''`. */
  operand: ASTNode;
  /** `true` for `!= ''` — the test reads `filled(x)`. */
  filled: boolean;
}

const isEmptyString = (node: ASTNode): boolean => node.kind === "literal" && node.value === "";

/** The `x` of `x ?? ''`, `trim(x ?? '')` or `x ?? '' | trim`. */
function stringOperand(node: ASTNode): ASTNode | undefined {
  if (node.kind === "binary" && node.op === "??" && isEmptyString(node.right)) return node.left;
  if (node.kind === "call" && node.callee === "trim" && node.args.length === 1) return stringOperand(node.args[0]);
  if (node.kind === "pipe" && node.callee === "trim" && node.args.length === 0) return stringOperand(node.left);
  return undefined;
}

/**
 * Every `(x ?? '') == ''` / `!= ''` comparison in an expression, also with
 * `trim()` around the left side or the sides swapped. A comparison inside another
 * one is not listed: rewrite, then look again.
 */
export function findBlankIdioms(root: ASTNode): BlankIdiom[] {
  const found: BlankIdiom[] = [];
  const visit = (node: ASTNode): void => {
    if (node.kind === "binary" && (node.op === "==" || node.op === "!=")) {
      const operand = isEmptyString(node.right) ? stringOperand(node.left)
        : isEmptyString(node.left) ? stringOperand(node.right) : undefined;
      if (operand !== undefined) {
        found.push({ node, operand, filled: node.op === "!=" });
        return;
      }
    }
    for (const child of children(node)) visit(child);
  };
  visit(root);
  return found;
}

function ternaryDepth(node: ASTNode): number {
  let deepest = 0;
  for (const child of children(node)) deepest = Math.max(deepest, ternaryDepth(child));
  return node.kind === "ternary" ? deepest + 1 : deepest;
}

function ensureLimit(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

type TemplatePath = Array<string | number>;

/**
 * Find value trees that are hard to read inside an expression but can be kept
 * as YAML/JSON through Tavnit's `_` / `$_` value-template directives.
 *
 * This deliberately returns diagnostics rather than throwing: the template is
 * valid, and callers decide whether a warning should be shown or promoted.
 */
export function lintValueTemplate(value: Value, options: ValueTemplateLintOptions = {}): LintDiagnostic[] {
  const maxInlineObjectFields = ensureLimit(options.maxInlineObjectFields ?? 2, "maxInlineObjectFields");
  const maxExpressionLength = ensureLimit(options.maxExpressionLength ?? 300, "maxExpressionLength");
  const maxTernaryDepth = ensureLimit(options.maxTernaryDepth ?? 2, "maxTernaryDepth");
  const maxLambdas = ensureLimit(options.maxLambdas ?? 2, "maxLambdas");
  // Keep linting aligned with value-template syntax, including `_` / `$_`
  // validation, before looking at the source expressions.
  parseValueTemplate(value);

  const diagnostics: LintDiagnostic[] = [];
  const visitText = (template: string, path: TemplatePath): void => {
    const visitExpression = (expression: TextTemplateExpression): void => {
      const report = (code: TavnitLintCode, message: string, from: ASTNode | undefined): void => {
        diagnostics.push({
          code,
          severity: "warning",
          message,
          path,
          location: {
            source: template,
            start: positionInSource(template, expression.offset, from?.start ?? expression.node.start),
            end: positionInSource(template, expression.offset, from?.end ?? expression.node.end),
          },
        });
      };
      const length = expression.source.trim().length;
      if (length > maxExpressionLength) {
        report(TAVNIT_LINT_CODE.longExpression, `Expression is ${length} characters long (limit ${maxExpressionLength}); split it into steps, a value tree or a lookup table.`, undefined);
      }
      const findDeep = (node: ASTNode): void => {
        if (node.kind === "ternary" && ternaryDepth(node) > maxTernaryDepth) {
          report(TAVNIT_LINT_CODE.nestedTernary, `Ternaries nested ${ternaryDepth(node)} deep; use firstFilled(), a lookup object or a '$if' guard.`, node);
          return;
        }
        for (const child of children(node)) findDeep(child);
      };
      findDeep(expression.node);
      let lambdas = 0;
      forEachNode(expression.node, (node) => {
        if (node.kind === "arrow") lambdas++;
      });
      if (lambdas > maxLambdas) {
        report(TAVNIT_LINT_CODE.manyLambdas, `Expression has ${lambdas} lambdas (limit ${maxLambdas}); split it into steps or move the work to a named action.`, undefined);
      }
      if (options.blankIdiom === true) {
        for (const idiom of findBlankIdioms(expression.node)) {
          report(TAVNIT_LINT_CODE.blankIdiom, `Blank check; write ${idiom.filled ? "filled" : "blank"}(x) instead of comparing with ''.`, idiom.node);
        }
      }
      forEachNode(expression.node, (node) => {
        if (node.kind !== "object" || node.entries.length <= maxInlineObjectFields) return;
        diagnostics.push({
          code: TAVNIT_LINT_CODE.complexInlineObject,
          severity: "warning",
          message: `Inline object literal has ${node.entries.length} fields; move the value tree to a '_' / '$_' subtree.`,
          path,
          location: {
            source: template,
            start: positionInSource(template, expression.offset, node.start),
            end: positionInSource(template, expression.offset, node.end),
          },
        });
      });
    };
    const visitNodes = (nodes: TextTemplateNode[]): void => {
      for (const node of nodes) {
        if (node.kind === "expression") visitExpression(node);
        else if (node.kind === "if") {
          for (const branch of node.branches) {
            visitExpression(branch.condition);
            visitNodes(branch.body);
          }
          if (node.alternate) visitNodes(node.alternate);
        } else if (node.kind === "for") {
          visitExpression(node.iterable);
          visitNodes(node.body);
        }
      }
    };
    visitNodes(parseTextTemplate(template));
  };
  const visitValue = (node: Value, path: TemplatePath): void => {
    if (typeof node === "string") {
      visitText(node, path);
      return;
    }
    if (node === null || typeof node !== "object" || isAtomicValue(node)) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => { visitValue(item, [...path, index]); });
      return;
    }
    for (const [key, child] of Object.entries(node)) visitValue(child, [...path, key]);
  };
  visitValue(value, []);
  return diagnostics.filter((diagnostic) => !DISABLED_LINT_CODES.has(diagnostic.code));
}
