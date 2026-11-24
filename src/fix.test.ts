import { describe, expect, it } from "vitest";
import { fixBlankIdiom, fixInlineObject, fixRedundantCoalesce, redundantCoalesceRemovals } from "./fix.js";
import { checkTemplate, TAVNIT_TYPE_CODE, type TypeEnvironment } from "./typecheck/check.js";
import { arrayOf, NUMBER, objectOf, STRING, UNKNOWN } from "./typecheck/types.js";

describe("fixInlineObject()", () => {
  it("moves a lambda's record into a `_` body and drops its wrapping parentheses", () => {
    expect(fixInlineObject("${{ rows | map(r => ({ id: str(r.id), name: r.name ?? '', n: 0 })) | sort(x => x.id) }}")).toEqual({
      host: "${{ rows | map(r => _) | sort(x => x.id) }}",
      body: { id: "${{ str(r.id) }}", name: "${{ r.name ?? '' }}", n: 0 },
    });
  });

  it("keeps a call's own parentheses", () => {
    expect(fixInlineObject("${{ focus({ a: x, b: y, c: 'z' }) }}")).toEqual({
      host: "${{ focus(_) }}",
      body: { a: "${{ x }}", b: "${{ y }}", c: "z" },
    });
  });

  it("returns no host when the record is the whole expression, nesting inner records as trees", () => {
    expect(fixInlineObject("${{ { action: a, navigate: 'replace', args: { q: q } } }}")).toEqual({
      host: undefined,
      body: { action: "${{ a }}", navigate: "replace", args: { q: "${{ q }}" } },
    });
  });

  it("folds a multi-line field onto one line but leaves string literals alone", () => {
    const fix = fixInlineObject("${{ c ? {\n  a: x\n    + y,\n  b: 'l  i',\n  c: null\n} : null }}");
    expect(fix?.host).toBe("${{ c ? _ : null }}");
    expect(fix?.body).toEqual({ a: "${{ x + y }}", b: "l  i", c: null });
  });

  it("keeps the grouping parentheses of a field the AST starts inside", () => {
    expect(fixInlineObject("${{ { a: (s ?? '') == 'x', b: f((y)), c: (p) } }}")?.body).toEqual({
      a: "${{ (s ?? '') == 'x' }}",
      b: "${{ f((y)) }}",
      c: "${{ p }}",
    });
  });

  it("keeps grouping parentheses the AST ends inside", () => {
    expect(fixInlineObject("${{ { a: x == (y ?? z), b: 1, c: 2 } }}")?.body).toEqual({
      a: "${{ x == (y ?? z) }}",
      b: 1,
      c: 2,
    });
  });

  it("moves the record that carries the most other findings with it", () => {
    expect(fixInlineObject("${{ let n = f({ a: 1, b: 2, c: 3 }) in { x: n, y: 1, z: { p: 1, q: 2, r: 3 } } }}")?.host)
      .toBe("${{ let n = f({ a: 1, b: 2, c: 3 }) in _ }}");
    expect(fixInlineObject("${{ c ? { a: 1, b: 2, c: 3 } : { a: 1, b: 2, c: 3, d: 4 } }}")?.host).toBe("${{ c ? { a: 1, b: 2, c: 3 } : _ }}");
    expect(fixInlineObject("${{ c ? { a: 1, b: 2, c: 3 } : { d: 1, e: 2, f: 3 } }}")?.host).toBe("${{ c ? _ : { d: 1, e: 2, f: 3 } }}");
  });

  it("turns an array of records into a list", () => {
    expect(fixInlineObject("${{ [{ a: x, b: 1, c: 2 }, y] }}")).toEqual({
      host: undefined,
      body: [{ a: "${{ x }}", b: 1, c: 2 }, "${{ y }}"],
    });
  });

  it("declines what it cannot rewrite faithfully", () => {
    expect(fixInlineObject("plain text")).toBeUndefined();
    expect(fixInlineObject("${{ { a: 1, b: 2, c: 3 } }} ${{ { d: 1, e: 2, f: 3 } }}")).toBeUndefined();
    expect(fixInlineObject("${{ { a: 1, b: 2 } }}")).toBeUndefined();
    expect(fixInlineObject("id ${{ { a: 1, b: 2, c: 3 } }}")).toBeUndefined();
    expect(fixInlineObject("${{ map(xs, x => _) ?? { a: 1, b: 2, c: 3 } }}")).toBeUndefined();
    expect(fixInlineObject("${{ { _: 1, b: 2, c: 3 } }}")).toBeUndefined();
    expect(fixInlineObject("${{ { a: { _: 1 }, b: 2, c: 3 } }}")).toBeUndefined();
    expect(fixInlineObject("${{ [{ _: 1 }, { a: 1, b: 2, c: 3 }] }}")).toBeUndefined();
  });

  it("preserves escaped characters and whitespace inside string literals", () => {
    expect(fixInlineObject("${{ { a: f('a\\'  b'), b: x, c: y } }}")?.body).toEqual({
      a: "${{ f('a\\'  b') }}",
      b: "${{ x }}",
      c: "${{ y }}",
    });
  });

  it("honours the lint threshold", () => {
    expect(fixInlineObject("${{ { a: 1, b: 2, c: 3 } }}", { maxInlineObjectFields: 3 })).toBeUndefined();
  });

  it("allows literal text beside an expression", () => {
    expect(fixInlineObject("prefix ${{ { a: 1, b: 2, c: 3 } }}")).toBeUndefined();
  });
});

describe("fixBlankIdiom()", () => {
  it("leaves a comparison that involves no empty string alone", () => {
    expect(fixBlankIdiom("${{ x == y }}")).toBeUndefined();
    expect(fixBlankIdiom("${{ x != y }}")).toBeUndefined();
  });

  it("rewrites the blank comparisons", () => {
    expect(fixBlankIdiom("${{ (x ?? '') == '' }}")).toBe("${{ blank(x) }}");
    expect(fixBlankIdiom("${{ (x ?? '') != '' }}")).toBe("${{ filled(x) }}");
    expect(fixBlankIdiom("${{ trim(args.name ?? '') == '' }}")).toBe("${{ blank(args.name) }}");
    expect(fixBlankIdiom("${{ '' != (x ?? '' | trim) }}")).toBe("${{ filled(x) }}");
  });

  it("keeps the surrounding expression and text", () => {
    expect(fixBlankIdiom("a ${{ ok && (x ?? '') == '' ? 1 : 2 }} b ${{ y }} ${{ (z ?? '') != '' }}"))
      .toBe("a ${{ ok && blank(x) ? 1 : 2 }} b ${{ y }} ${{ filled(z) }}");
    expect(fixBlankIdiom("${{ ((a ?? b) ?? '') == '' }}")).toBe("${{ blank(a ?? b) }}");
    expect(fixBlankIdiom("${{ items | filter(i => (i.n ?? '') != '') }}")).toBe("${{ items | filter(i => filled(i.n)) }}");
  });

  it("rewrites several idioms of one expression", () => {
    expect(fixBlankIdiom("${{ (a ?? '') == '' || (b ?? '') != '' }}")).toBe("${{ blank(a) || filled(b) }}");
  });

  it("returns undefined when nothing matches", () => {
    expect(fixBlankIdiom("${{ x == '' }}")).toBeUndefined();
    expect(fixBlankIdiom("plain")).toBeUndefined();
  });
});

describe("fixRedundantCoalesce()", () => {
  const required = (type: Parameters<typeof arrayOf>[0]) => ({ type, presence: "required" as const });
  const environment: TypeEnvironment = {
    redundancy: true,
    names: {
      args: objectOf({ a: required(STRING), b: required(STRING), n: required(NUMBER), xs: required(arrayOf(STRING, true)) }, false),
      anything: UNKNOWN,
    },
  };

  /** The template rewritten for every `TAV201` the checker reports on it, and the findings it removed. */
  function fixed(template: string, source = template): { text: string | undefined; count: number } {
    const found = checkTemplate(template, environment).filter((finding) => finding.code === TAVNIT_TYPE_CODE.redundantCoalesce);
    const fixes = found.flatMap((finding) => (finding.dropFallback === undefined ? [] : [finding.dropFallback]));
    return { text: fixRedundantCoalesce(source, fixes), count: fixes.length };
  }

  it("reports the removed ranges in the template's own offsets", () => {
    const template = "x ${{ args.a ?? '' }} y ${{ args.b ?? null }}";
    const found = checkTemplate(template, environment).flatMap((finding) => (finding.dropFallback === undefined ? [] : [finding.dropFallback]));
    expect(redundantCoalesceRemovals(template, found).map(({ start, end }) => template.slice(start, end))).toEqual([" ?? ''", " ?? null"]);
    expect(redundantCoalesceRemovals(template, [])).toEqual([]);
  });

  it("removes the fallback and keeps the left operand", () => {
    expect(fixed("${{ args.a ?? '' }}")).toEqual({ text: "${{ args.a }}", count: 1 });
    expect(fixed("x ${{ args.n ?? 0 }} y")).toEqual({ text: "x ${{ args.n }} y", count: 1 });
    expect(fixed("${{ args.xs | first ?? 'none' }}")).toEqual({ text: "${{ args.xs | first }}", count: 1 });
  });

  it("keeps the parentheses around the whole `??` or around either operand", () => {
    expect(fixed("${{ (args.a ?? null) == null }}").text).toBe("${{ (args.a) == null }}");
    expect(fixed("${{ (args.a) ?? 'x' }}").text).toBe("${{ (args.a) }}");
    expect(fixed("${{ args.a ?? ('x') }}").text).toBe("${{ args.a }}");
    expect(fixed("${{ toLowerCase(args.a ?? null) == 'html' }}").text).toBe("${{ toLowerCase(args.a) == 'html' }}");
    expect(fixed("${{ (args.n + 1) ?? 0 }}").text).toBe("${{ (args.n + 1) }}");
  });

  it("removes a fallback that spans lines or holds a string with parentheses", () => {
    expect(fixed("${{ args.a ??\n  'x ) (' }}").text).toBe("${{ args.a }}");
    expect(fixed("${{ args.a ?? f(1, 2) }}").text).toBe("${{ args.a }}");
  });

  it("rewrites several fallbacks of several expressions in one pass", () => {
    expect(fixed("${{ args.a ?? '' }}-${{ args.b ?? '' }} ${{ anything ?? 1 }} ${{ args.n ?? 0 }}")).toEqual({
      text: "${{ args.a }}-${{ args.b }} ${{ anything ?? 1 }} ${{ args.n }}",
      count: 3,
    });
    expect(fixed("${{ args.a ?? args.b ?? '' }}").text).toBe("${{ args.a }}");
    expect(fixed("${{ (args.a ?? 'x') ?? 'y' }}").text).toBe("${{ (args.a) }}");
  });

  it("applies spans of the parsed value to the raw source of the same expressions", () => {
    const raw = "|-\n  ${{ args.a ?? '' }}";
    expect(fixed("${{ args.a ?? '' }}", raw)).toEqual({ text: "|-\n  ${{ args.a }}", count: 1 });
  });

  it("returns undefined when there is nothing to remove", () => {
    expect(fixRedundantCoalesce("${{ args.a ?? '' }}", [])).toBeUndefined();
    expect(fixRedundantCoalesce("plain", [])).toBeUndefined();
    const [fix] = checkTemplate("${{ args.a ?? '' }}", environment).flatMap((finding) => (finding.dropFallback ? [finding.dropFallback] : []));
    expect(fixRedundantCoalesce("${{ args.a ?? '' }}", [{ ...fix, expression: 3 }])).toBeUndefined();
  });

  it("leaves a fix alone whose spans do not sit on a '??' with its parentheses closed", () => {
    const template = "${{ args.a ?? ('x') }}";
    const [fix] = checkTemplate(template, environment).flatMap((finding) => (finding.dropFallback ? [finding.dropFallback] : []));
    expect(fixRedundantCoalesce(template, [fix])).toBe("${{ args.a }}");
    // The left span ends too early to reach the operator, then the right span runs past its parenthesis.
    expect(fixRedundantCoalesce(template, [{ ...fix, left: { start: fix.left.start, end: fix.left.start } }])).toBeUndefined();
    const past = { ...fix.right.end, column: fix.right.end.column + 1 };
    expect(fixRedundantCoalesce(template, [{ ...fix, right: { ...fix.right, end: past } }])).toBeUndefined();
  });

  it("drops a fix nested in another's removed text", () => {
    const template = "${{ args.a ?? (args.b ?? 'x') }}";
    const fixes = checkTemplate(template, environment).flatMap((finding) => (finding.dropFallback ? [finding.dropFallback] : []));
    expect(fixes).toHaveLength(2);
    expect(fixRedundantCoalesce(template, fixes)).toBe("${{ args.a }}");
    expect(fixRedundantCoalesce(template, [...fixes].reverse())).toBe("${{ args.a }}");
    // The first finding is the inner `??`; two copies of it remove that operator once.
    expect(fixRedundantCoalesce(template, [fixes[0], fixes[0]])).toBe("${{ args.a ?? (args.b) }}");
  });

  it("produces an expression that parses to the same left operand", () => {
    const text = fixed("${{ (args.a ?? '').length }}").text;
    expect(text).toBe("${{ (args.a).length }}");
  });
});
