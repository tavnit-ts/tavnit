import type { ASTNode } from "../parser/ast.js";
import { parse } from "../parser/parse.js";
import { referencedNames } from "../parser/walk.js";
import { compileTextTemplate, type TextTemplateNode } from "../parser/text-template.js";
import { compileValueTemplate, type ValueTemplate } from "../parser/value-template.js";
import type { Value } from "./types.js";

/** Cache activity since construction or the last {@link Cache.resetMetrics} call. */
export interface CacheMetrics {
  expressions: CacheMetric;
  textTemplates: CacheMetric;
  valueTemplates: CacheMetric;
}

/** Cache hits and misses for one compiled value kind. */
export interface CacheMetric {
  hits: number;
  misses: number;
}

/**
 * Opaque cache of compiled expressions and templates, returned by `createCache()`.
 *
 * Compilation does not depend on engine options — filters and limits apply
 * only at evaluation — so any engines may share one cache.
 */
export class Cache {
  readonly #expressions = new Map<string, ASTNode>();
  readonly #texts = new Map<string, TextTemplateNode[]>();
  /** Keyed by tree identity — the caller must not mutate a tree it passed in. */
  readonly #trees = new WeakMap<object, ValueTemplate>();
  readonly #names = new WeakMap<ASTNode, ReadonlySet<string>>();
  #metrics: CacheMetrics = {
    expressions: { hits: 0, misses: 0 },
    textTemplates: { hits: 0, misses: 0 },
    valueTemplates: { hits: 0, misses: 0 },
  };

  /** A snapshot of compilation-cache activity. */
  metrics(): CacheMetrics {
    return {
      expressions: { ...this.#metrics.expressions },
      textTemplates: { ...this.#metrics.textTemplates },
      valueTemplates: { ...this.#metrics.valueTemplates },
    };
  }

  /** Reset cache activity counters without evicting compiled values. */
  resetMetrics(): void {
    this.#metrics = {
      expressions: { hits: 0, misses: 0 },
      textTemplates: { hits: 0, misses: 0 },
      valueTemplates: { hits: 0, misses: 0 },
    };
  }

  /** @internal Compile an expression, memoised on its source. Throws `ParseError`. */
  expression(source: string): ASTNode {
    let node = this.#expressions.get(source);
    if (!node) {
      this.#metrics.expressions.misses++;
      node = parse(source);
      this.#expressions.set(source, node);
    } else {
      this.#metrics.expressions.hits++;
    }
    return node;
  }

  /** @internal Compile a text template, memoised on its source. Throws `ExpressionError`. */
  textTemplate(template: string): TextTemplateNode[] {
    let nodes = this.#texts.get(template);
    if (!nodes) {
      this.#metrics.textTemplates.misses++;
      nodes = compileTextTemplate(template, (source) => this.expression(source));
      this.#texts.set(template, nodes);
    } else {
      this.#metrics.textTemplates.hits++;
    }
    return nodes;
  }

  /**
   * @internal Compile a value tree from memoised text templates; with `memoise`,
   * the whole tree is also memoised on its identity. Throws `ExpressionError`.
   */
  valueTemplate(value: Value, memoise: boolean): ValueTemplate {
    const tree = memoise && value !== null && typeof value === "object" ? value : null;
    const cached = tree && this.#trees.get(tree);
    if (cached) {
      this.#metrics.valueTemplates.hits++;
      return cached;
    }
    if (tree) this.#metrics.valueTemplates.misses++;
    const template = compileValueTemplate(value, (text) => this.textTemplate(text));
    if (tree) this.#trees.set(tree, template);
    return template;
  }

  /** @internal The names a compiled expression reads or calls, memoised on the node. */
  names(node: ASTNode): ReadonlySet<string> {
    let names = this.#names.get(node);
    if (!names) {
      names = referencedNames(node);
      this.#names.set(node, names);
    }
    return names;
  }
}

export function createCache(): Cache {
  return new Cache();
}
