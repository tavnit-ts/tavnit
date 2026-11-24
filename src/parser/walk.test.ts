import { describe, expect, it } from "vitest";
import { ExpressionError } from "../engine/types.js";
import { parse } from "./parse.js";
import { textTemplateExpressions, parseTextTemplate } from "./text-template.js";
import { parseValueTemplate } from "./value-template.js";
import { forEachNode, someNode } from "./walk.js";

describe("forEachNode()", () => {
  it("visits every node, parents before children", () => {
    const kinds: string[] = [];
    forEachNode(parse("let x = [a, { k: -b }] in x | f(c ? d[e] : g.h, y => y)"), (node) => kinds.push(node.kind));
    expect(kinds).toEqual([
      "let", "array", "identifier", "object", "unary", "identifier",
      "pipe", "identifier", "ternary", "identifier", "index", "identifier", "identifier",
      "member", "identifier", "arrow", "identifier",
    ]);
  });

  it("descends into every expression of a substituted `_` body", () => {
    const template = parseValueTemplate({
      rows: "${{ items | map(t => _) }}",
      _: [
        { $if: "${{ a }}", "${{ k }}": "x${{ b }}", "...": "${{ c }}", z: 1 },
        { "...": "${{ d }}" },
        1,
      ],
    });
    const root = template._root;
    if (root.kind !== "object" || root.parts[0].kind !== "entry") throw new Error("expected an object entry");
    const host = root.parts[0].value;
    if (host.kind !== "expression") throw new Error("expected a host expression");
    const names: string[] = [];
    forEachNode(host.node, (node) => { if (node.kind === "identifier") names.push(node.name); });
    expect(names).toEqual(["items", "a", "k", "b", "c", "d"]);
  });

  it("someNode() stops at the first match", () => {
    expect(someNode(parse("a + f(_)"), (node) => node.kind === "identifier" && node.name === "_")).toBe(true);
    expect(someNode(parse("a + 1"), (node) => node.kind === "call")).toBe(false);
  });
});

describe("parseTextTemplate()", () => {
  it("reports a block-tag structure error as an ExpressionError on the template", () => {
    expect(() => parseTextTemplate("a${% endif %}")).toThrow(ExpressionError);
  });
});

describe("textTemplateExpressions()", () => {
  it("skips a missing else branch", () => {
    expect(textTemplateExpressions(parseTextTemplate("x${% if a %}${{ b }}${% endif %}"))).toHaveLength(2);
  });

  it("collects spans, conditions and iterables in source order", () => {
    const nodes = parseTextTemplate("${% if a %}${{ b }}${% elif c %}${% for x in d %}${{ x }}${% endfor %}${% else %}${{ e }}${% endif %}");
    expect(textTemplateExpressions(nodes).map((node) => node.kind === "identifier" ? node.name : node.kind))
      .toEqual(["a", "b", "c", "d", "x", "e"]);
  });
});
