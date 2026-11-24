import type { ASTNode } from "./ast.js";
import { textTemplateExpressions } from "./text-template.js";
import type { ValueTemplateNode } from "./value-template.js";

/** The direct sub-expressions of an AST node, in source order. */
export function children(node: ASTNode): ASTNode[] {
  switch (node.kind) {
    case "literal":
    case "identifier": return [];
    case "array": return node.elements;
    case "object": return node.entries.map(([, value]) => value);
    case "valueTemplate": return valueTemplateExpressions(node.template);
    case "unary": return [node.operand];
    case "binary": return [node.left, node.right];
    case "member": return [node.object];
    case "index": return [node.object, node.key];
    case "call": return node.args;
    case "ternary": return [node.condition, node.consequent, node.alternate];
    case "pipe": return [node.left, ...node.args];
    case "arrow": return [node.body];
    case "let": return [...node.bindings.map(([, value]) => value), node.body];
  }
}

/** The top-level expressions of a compiled value tree, in source order. */
function valueTemplateExpressions(node: ValueTemplateNode): ASTNode[] {
  switch (node.kind) {
    case "literal": return [];
    case "expression": return [node.node];
    case "text": return textTemplateExpressions(node.nodes);
    case "array": return node.items.flatMap(valueTemplateExpressions);
    case "object": return node.parts.flatMap((part) => part.kind === "spread"
      ? valueTemplateExpressions(part.body)
      : [...(typeof part.key === "string" ? [] : textTemplateExpressions(part.key.nodes)), ...valueTemplateExpressions(part.value)]);
    case "guard": return [
      ...[node.ifNode, node.unlessNode].flatMap((guard) => guard ? valueTemplateExpressions(guard) : []),
      ...valueTemplateExpressions(node.body),
    ];
    case "spread":
    case "splice": return valueTemplateExpressions(node.body);
  }
}

/** Visit `node` and every sub-expression, parents before children; a `_` body's expressions count as children. */
export function forEachNode(node: ASTNode, visit: (node: ASTNode) => void): void {
  visit(node);
  for (const child of children(node)) forEachNode(child, visit);
}

/** True when `node` or any sub-expression satisfies `predicate`. */
export function someNode(node: ASTNode, predicate: (node: ASTNode) => boolean): boolean {
  return predicate(node) || children(node).some((child) => someNode(child, predicate));
}

/** Every identifier and called filter name in `node` and its sub-expressions, bound names included. */
export function referencedNames(node: ASTNode): Set<string> {
  const names = new Set<string>();
  forEachNode(node, (n) => {
    if (n.kind === "identifier") names.add(n.name);
    else if (n.kind === "call" || n.kind === "pipe") names.add(n.callee);
  });
  return names;
}
