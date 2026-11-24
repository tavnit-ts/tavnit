import { describe, expect, it } from "vitest";
import { lintValueTemplate } from "./lint.js";

describe("lintValueTemplate()", () => {
  it("does not report TAV001 for a record-building lambda while disabled", () => {
    const findings = lintValueTemplate({
      rows: "${{ records | map(record => ({ id: record.id, label: record.label, state: record.state })) }}",
    });

    expect(findings).toEqual([]);
  });

  it("allows compact one- and two-field records", () => {
    expect(lintValueTemplate({
      point: "${{ { x: source.x, y: source.y } }}",
      marker: "${{ { id: source.id } }}",
    })).toEqual([]);
  });

  it("does not report TAV001 for nested objects while disabled", () => {
    const findings = lintValueTemplate({
      command: "${{ { target: target, mode: mode, options: { cursor: null, query: query, limit: limit } } }}",
    });

    expect(findings).toEqual([]);
  });

  it("honours a caller-selected threshold", () => {
    expect(lintValueTemplate("${{ { first: 1, second: 2, third: 3 } }}", { maxInlineObjectFields: 3 })).toEqual([]);
    expect(() => lintValueTemplate("${{ {} }}", { maxInlineObjectFields: -1 })).toThrow(/non-negative integer/);
  });

  it("visits records in block-tag conditions, bodies, alternates, and array items", () => {
    const findings = lintValueTemplate({
      entries: [
        "${% if { a: 1, b: 2, c: 3 } %}${{ { d: 1, e: 2, f: 3 } }}${% elif { g: 1, h: 2, i: 3 } %}${% for row in [{ j: 1, k: 2, l: 3 }] %}${{ { m: 1, n: 2, o: 3 } }}${% endfor %}${% else %}${{ { p: 1, q: 2, r: 3 } }}${% endif %}",
      ],
    });

    expect(findings).toEqual([]);
  });

  it("accepts scalar tree nodes and visits blocks without alternates", () => {
    expect(lintValueTemplate({ empty: null, count: 1, text: "${% if true %}${{ { a: 1, b: 2, c: 3 } }}${% endif %}" }))
      .toEqual([]);
  });

  it("ignores literal text nodes", () => {
    expect(lintValueTemplate("prefix ${{ { a: 1, b: 2, c: 3 } }}")).toEqual([]);
  });
});

describe("TAV002–TAV005", () => {
  const codes = (value: string | Record<string, string>, options = {}) =>
    lintValueTemplate(value, options).map((finding) => finding.code);

  it("does not report TAV002 while disabled", () => {
    const long = `\${{ ${Array.from({ length: 90 }, (_, i) => `a${i}`).join(" + ")} }}`;
    const findings = lintValueTemplate(long);
    expect(findings).toEqual([]);
    expect(codes("${{ a + b }}")).toEqual([]);
    expect(codes(long, { maxExpressionLength: 1000 })).toEqual([]);
  });

  it("does not report TAV003 while disabled", () => {
    expect(codes("${{ a ? 1 : b ? 2 : c ? 3 : 4 }}")).toEqual([]);
    expect(codes("${{ a ? 1 : b ? 2 : 3 }}")).toEqual([]);
    expect(codes("${{ f(a ? (b ? (c ? 1 : 2) : 3) : 4) }}")).toEqual([]);
    expect(codes("${{ a ? 1 : b ? 2 : 3 }}", { maxTernaryDepth: 1 })).toEqual([]);
  });

  it("does not report TAV004 while disabled", () => {
    expect(codes("${{ xs | map(x => x.a) | filter(y => y) | sort(z => z) }}")).toEqual([]);
    expect(codes("${{ xs | map(x => x.a) | filter(y => y) }}")).toEqual([]);
    expect(codes("${{ xs | map(x => x.a) | filter(y => y) }}", { maxLambdas: 1 })).toEqual([]);
  });

  it("does not report TAV005 while the rule is disabled", () => {
    const findings = lintValueTemplate({
      a: "${{ (x ?? '') == '' }}",
      b: "${{ trim(x ?? '') != '' }}",
      c: "${{ '' == (x ?? '' | trim) }}",
      d: "${{ x == '' }}",
      e: "${{ (x ?? 'n') == '' }}",
      f: "${{ trim(x) == '' }}",
      g: "${{ x == y }}",
      h: "${{ '' == y }}",
    });
    expect(findings).toEqual([]);
  });

  it("reports TAV005 when blankIdiom is on", () => {
    const findings = lintValueTemplate({
      a: "${{ (x ?? '') == '' }}",
      b: "${{ trim(x ?? '') != '' }}",
      c: "${{ x == y }}",
    }, { blankIdiom: true });
    expect(findings.map((f) => f.code)).toEqual(["TAV005", "TAV005"]);
    expect(findings[0]?.message).toContain("blank(x)");
    expect(findings[1]?.message).toContain("filled(x)");
  });

  it("checks the limits are non-negative integers", () => {
    expect(() => lintValueTemplate("${{ a }}", { maxExpressionLength: -1 })).toThrow(/maxExpressionLength/);
    expect(() => lintValueTemplate("${{ a }}", { maxTernaryDepth: 1.5 })).toThrow(/maxTernaryDepth/);
    expect(() => lintValueTemplate("${{ a }}", { maxLambdas: -1 })).toThrow(/maxLambdas/);
  });

  it("lints block-tag conditions too", () => {
    expect(codes("${% if (x ?? '') == '' %}-${% endif %}")).toEqual([]);
  });
});
