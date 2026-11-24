import type { TextTemplateExpression, TextTemplateNode } from "../parser/text-template.js";
import { isTruthy } from "./evaluate.js";
import type { DataContext, Value } from "./types.js";

/**
 * The length of `text` in UTF-8, without allocating the bytes: every appended piece of a template is
 * measured, and `TextEncoder.encode` per piece cost half again the render. A lone surrogate counts as
 * U+FFFD (three bytes), as the encoder writes it.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export interface TextTemplateRuntime {
  evaluate(expression: TextTemplateExpression, context: DataContext): Promise<Value>;
  stringify(value: Value, expression: TextTemplateExpression): string;
  outputLimit(bytes: number): void;
  invalidIterable(iterable: TextTemplateExpression): Error;
  iterationLimit(iterable: TextTemplateExpression): Error;
}

/** Evaluate compiled `${{ }}` spans and `${% if/for %}` text-template nodes. */
export async function evaluateTextTemplate(
  nodes: TextTemplateNode[],
  context: DataContext,
  runtime: TextTemplateRuntime,
  loopBudget: { remaining: number },
  output: { bytes: number } = { bytes: 0 },
): Promise<string> {
  const append = (text: string) => {
    output.bytes += utf8Length(text);
    runtime.outputLimit(output.bytes);
    return text;
  };
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.kind === "literal") {
      parts.push(append(node.text));
    } else if (node.kind === "expression") {
      parts.push(append(runtime.stringify(await runtime.evaluate(node, context), node)));
    } else if (node.kind === "if") {
      let body = node.alternate;
      for (const branch of node.branches) {
        if (isTruthy(await runtime.evaluate(branch.condition, context))) {
          body = branch.body;
          break;
        }
      }
      if (body) parts.push(await evaluateTextTemplate(body, context, runtime, loopBudget, output));
    } else {
      const iterable = await runtime.evaluate(node.iterable, context);
      if (!Array.isArray(iterable)) throw runtime.invalidIterable(node.iterable);
      for (let index = 0; index < iterable.length; index++) {
        if (loopBudget.remaining <= 0) throw runtime.iterationLimit(node.iterable);
        loopBudget.remaining--;
        parts.push(await evaluateTextTemplate(node.body, {
          ...context,
          [node.variable]: iterable[index] ?? null,
          forloop: { index, index1: index + 1, first: index === 0, last: index === iterable.length - 1, length: iterable.length },
        }, runtime, loopBudget, output));
      }
    }
  }
  return parts.join("");
}

/** The runtime of a synchronous render: the same hooks, with `evaluate` returning the value itself. */
export interface TextTemplateRuntimeSync extends Omit<TextTemplateRuntime, "evaluate"> {
  evaluate(expression: TextTemplateExpression, context: DataContext): Value;
}

/** `evaluateTextTemplate` for a template with nothing to await. */
export function evaluateTextTemplateSync(
  nodes: TextTemplateNode[],
  context: DataContext,
  runtime: TextTemplateRuntimeSync,
  loopBudget: { remaining: number },
  output: { bytes: number } = { bytes: 0 },
): string {
  const append = (text: string) => {
    output.bytes += utf8Length(text);
    runtime.outputLimit(output.bytes);
    return text;
  };
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.kind === "literal") {
      parts.push(append(node.text));
    } else if (node.kind === "expression") {
      parts.push(append(runtime.stringify(runtime.evaluate(node, context), node)));
    } else if (node.kind === "if") {
      let body = node.alternate;
      for (const branch of node.branches) {
        if (isTruthy(runtime.evaluate(branch.condition, context))) {
          body = branch.body;
          break;
        }
      }
      if (body) parts.push(evaluateTextTemplateSync(body, context, runtime, loopBudget, output));
    } else {
      const iterable = runtime.evaluate(node.iterable, context);
      if (!Array.isArray(iterable)) throw runtime.invalidIterable(node.iterable);
      for (let index = 0; index < iterable.length; index++) {
        if (loopBudget.remaining <= 0) throw runtime.iterationLimit(node.iterable);
        loopBudget.remaining--;
        parts.push(evaluateTextTemplateSync(node.body, {
          ...context,
          [node.variable]: iterable[index] ?? null,
          forloop: { index, index1: index + 1, first: index === 0, last: index === iterable.length - 1, length: iterable.length },
        }, runtime, loopBudget, output));
      }
    }
  }
  return parts.join("");
}
