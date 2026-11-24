import type { SourcePosition } from "../lexer/token.js";
import type { ASTNode } from "../parser/ast.js";
import { positionInSource, type TextTemplateNode } from "../parser/text-template.js";
import type { ValueTemplateNode } from "../parser/value-template.js";
import { children } from "../parser/walk.js";
import type { Analysis } from "./types.js";

/** A reference to a name in the analysed source: a free variable or a called function. */
export interface NameReference {
  name: string;
  /** The text in which `start` and `end` are positions: an expression, or a whole text template. */
  source: string;
  start: SourcePosition;
  end: SourcePosition;
}

/** The raw result of a walk: every reference in source order, repeats included. */
export interface References {
  variables: NameReference[];
  calls: NameReference[];
}

type Bound = ReadonlySet<string>;

/** Walks compiled sources and collects the free variables and the calls, tracking what arrows, `let` and `for` bind. */
class Collector implements References {
  readonly variables: NameReference[] = [];
  readonly calls: NameReference[] = [];

  /** `position` maps a position in the expression into the text `source` reports. */
  expression(node: ASTNode, source: string, position: (at: SourcePosition) => SourcePosition, bound: Bound): void {
    const refer = (name: string, start: SourcePosition, end: SourcePosition): NameReference =>
      ({ name, source, start: position(start), end: position(end) });
    const visit = (current: ASTNode, scope: Bound): void => {
      switch (current.kind) {
        case "identifier":
          if (!scope.has(current.name)) this.variables.push(refer(current.name, current.start, current.end));
          return;
        case "call":
          this.calls.push(refer(current.callee, current.start, current.end));
          for (const arg of current.args) visit(arg, scope);
          return;
        case "pipe":
          visit(current.left, scope);
          this.calls.push(refer(current.callee, current.calleeStart, current.end));
          for (const arg of current.args) visit(arg, scope);
          return;
        case "arrow":
          visit(current.body, new Set([...scope, ...current.params]));
          return;
        case "let": {
          const inner = new Set(scope);
          for (const [name, value] of current.bindings) {
            visit(value, inner);
            inner.add(name);
          }
          visit(current.body, inner);
          return;
        }
        case "valueTemplate":
          this.valueTemplate(current.template, scope);
          return;
        default:
          for (const child of children(current)) visit(child, scope);
      }
    };
    visit(node, bound);
  }

  /** The nodes of a text template; positions are those of `template`. */
  text(nodes: TextTemplateNode[], template: string, bound: Bound): void {
    for (const node of nodes) {
      if (node.kind === "expression") this.span(node, template, bound);
      else if (node.kind === "if") {
        for (const branch of node.branches) {
          this.span(branch.condition, template, bound);
          this.text(branch.body, template, bound);
        }
        if (node.alternate) this.text(node.alternate, template, bound);
      } else if (node.kind === "for") {
        this.span(node.iterable, template, bound);
        this.text(node.body, template, new Set([...bound, node.variable, "forloop"]));
      }
    }
  }

  private span(span: { node: ASTNode; offset: number }, template: string, bound: Bound): void {
    this.expression(span.node, template, (at) => positionInSource(template, span.offset, at), bound);
  }

  /** A value tree: positions are those of the expression or text template (a string value) that holds the name. */
  valueTemplate(node: ValueTemplateNode, bound: Bound): void {
    switch (node.kind) {
      case "literal": return;
      case "expression":
        this.expression(node.node, node.source, (at) => at, bound);
        return;
      case "text":
        this.text(node.nodes, node.source, bound);
        return;
      case "array":
        for (const item of node.items) this.valueTemplate(item, bound);
        return;
      case "object":
        for (const part of node.parts) {
          if (part.kind === "spread") {
            this.valueTemplate(part.body, bound);
            continue;
          }
          if (typeof part.key !== "string") this.text(part.key.nodes, part.key.source, bound);
          this.valueTemplate(part.value, bound);
        }
        return;
      case "guard":
        if (node.ifNode) this.valueTemplate(node.ifNode, bound);
        if (node.unlessNode) this.valueTemplate(node.unlessNode, bound);
        this.valueTemplate(node.body, bound);
        return;
      case "spread":
      case "splice":
        this.valueTemplate(node.body, bound);
        return;
    }
  }
}

/** The references of an expression. */
export function expressionReferences(node: ASTNode, source: string): References {
  const collector = new Collector();
  collector.expression(node, source, (at) => at, new Set());
  return collector;
}

/** The references of a compiled text template; positions are in `template`. */
export function textReferences(nodes: TextTemplateNode[], template: string): References {
  const collector = new Collector();
  collector.text(nodes, template, new Set());
  return collector;
}

/** The references of a compiled value tree. */
export function valueTemplateReferences(root: ValueTemplateNode): References {
  const collector = new Collector();
  collector.valueTemplate(root, new Set());
  return collector;
}

/** The public shape of `references`: names once each, calls with positions. */
export function toAnalysis(references: References): Analysis {
  return {
    variables: [...new Set(references.variables.map((reference) => reference.name))],
    functions: [...new Set(references.calls.map((reference) => reference.name))],
    calls: references.calls.map(({ name, start, end }) => ({ name, start, end })),
  };
}
