import { describe, expect, it } from "vitest";
import { resolve } from "../evaluator/types.js";
import { extractSpans } from "../lexer/spans.js";
import { createEngine } from "./engine.js";
import { formatDiagnostic } from "./format.js";
import { type Diagnostic, ExpressionError, type Value } from "./types.js";

const engine = createEngine();

/** The single diagnostic of the ExpressionError `run` rejects with. */
async function diagnosticOf(run: () => Promise<Value>): Promise<Diagnostic> {
  const error = await run().then(
    () => { throw new Error("expected a rejection"); },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ExpressionError);
  const { errors } = error as ExpressionError;
  expect(errors).toHaveLength(1);
  return errors[0];
}

describe("error messages name Tavnit types", () => {
  it.each([
    ['"a" + [1]', "Operator '+' requires two numbers or two strings, got string and array"],
    ["m[null]", "Object key must be a string or number, got null"],
    ["now() < today()", "Operator '<' cannot compare instant and plaindate; convert one to the other's type (toInstant, toPlainDate)"],
    ["map(5, x => x)", "map() requires an array, got number"],
    ["[1] | map(x => x) | join(5)", "join() separator must be a string, got number"],
  ])("%s", async (source, message) => {
    const diagnostic = await diagnosticOf(() => engine.evaluate(source, { m: {} }));
    expect(diagnostic.message).toBe(message);
  });

  it("type() uses the same names", async () => {
    expect(await engine.evaluate("[type(null), type([]), type(x => x), type(now())]")).toEqual([
      "null", "array", "function", "instant",
    ]);
  });
});

describe("runtime errors carry the failing node's span", () => {
  it("a property access points at the property", async () => {
    const { location } = await diagnosticOf(() => engine.evaluate("user.address.city", { user: { address: null } }));
    expect(location).toEqual({ source: "user.address.city", start: { line: 1, column: 13 } });
  });

  it("a binary operator spans the whole operation", async () => {
    const { location } = await diagnosticOf(() => engine.evaluate("1 + (a - 'b')", { a: 1 }));
    expect(location?.start).toEqual({ line: 1, column: 6 });
    expect(location?.end).toEqual({ line: 1, column: 13 });
  });

  it("a pipe call spans `callee(args)`, not the left side", async () => {
    const { location } = await diagnosticOf(() => engine.evaluate("x | map(v => v.id)", { x: null }));
    expect(location?.start).toEqual({ line: 1, column: 5 });
    expect(location?.end).toEqual({ line: 1, column: 19 });
  });

  it("the async path attributes the same way", async () => {
    const { location } = await diagnosticOf(() =>
      engine.evaluate("s.k | map(v => v)", { s: resolve(async () => null) }));
    expect(location?.start).toEqual({ line: 1, column: 7 });
  });

  it("an unknown function points at its call", async () => {
    const { message, location } = await diagnosticOf(() => engine.evaluate("1 + nope(2)"));
    expect(message).toBe("Unknown function 'nope'");
    expect(location?.start).toEqual({ line: 1, column: 5 });
  });

  it("a host filter's plain Error is located at its call", async () => {
    const eng = createEngine({ filters: { boom: () => { throw new Error("boom failed"); } } });
    const { message, location } = await diagnosticOf(() => eng.evaluate("1 + boom(2)"));
    expect(message).toBe("boom failed");
    expect(location?.start).toEqual({ line: 1, column: 5 });
    expect(location?.end).toEqual({ line: 1, column: 12 });
  });
});

describe("text-template errors are in template coordinates", () => {
  const template = "Hello ${{ name }},\n  total: ${{ price * qty | toFixed(\"2\") }}";

  it("a runtime error inside a span", async () => {
    const { location } = await diagnosticOf(() => engine.render(template, { name: "A", price: 1, qty: 2 }));
    expect(location).toEqual({
      source: template,
      start: { line: 2, column: 28 },
      end: { line: 2, column: 40 },
    });
  });

  it("a parse error inside a block-tag condition", async () => {
    const { message, location } = await diagnosticOf(() => engine.render("line1\n${% if a > %}x${% endif %}"));
    expect(message).toBe("Unexpected end of expression");
    expect(location?.start).toEqual({ line: 2, column: 11 });
  });

  it("a template syntax error, without the position in its message", async () => {
    const { message, location } = await diagnosticOf(() => engine.render("a\nb ${% foo %}"));
    expect(message).toBe("Unknown tag 'foo'");
    expect(location?.start).toEqual({ line: 2, column: 3 });
  });

  it("a lexing error is an ExpressionError located in the template", async () => {
    const { message, location } = await diagnosticOf(() => engine.render('x ${{ "abc }}'));
    expect(message).toBe("Unterminated string literal");
    expect(location?.start).toEqual({ line: 1, column: 7 });
  });

  it("an unexpected character has a start and no end", async () => {
    const template = "x ${{ a # b }}";
    const { message, location } = await diagnosticOf(() => engine.render(template));
    expect(message).toBe("Unexpected character '#'");
    expect(location).toEqual({ source: template, start: { line: 1, column: 9 } });
  });

  it("a parse error on a later line of a multi-line span", async () => {
    const template = "x ${{ a +\n  * b }}";
    const { message, location } = await diagnosticOf(() => engine.render(template));
    expect(message).toBe("Unexpected token '*'");
    expect(location).toEqual({ source: template, start: { line: 2, column: 3 }, end: { line: 2, column: 4 } });
  });

  it("a span that renders a function points at the span's expression", async () => {
    const { message, location } = await diagnosticOf(() => engine.render("a\nb ${{ x => x }} c"));
    expect(message).toBe("Function values cannot be used as a top-level expression result");
    expect(location).toEqual({ source: "a\nb ${{ x => x }} c", start: { line: 2, column: 7 }, end: { line: 2, column: 13 } });
  });

  it.each([
    ["The 'for' iterable must be an array", "${% for i in 5 %}${% endfor %}", 5],
    ["Iteration limit 2 exceeded; raise maxIterations", "${% for i in [1, 2, 3] %}${% endfor %}", 3],
  ])("%s points at the iterable", async (expected, loop, maxIterations) => {
    const strict = createEngine({ maxIterations: maxIterations - 1 });
    const { message, location } = await diagnosticOf(() => strict.render(`a\n${loop}`));
    expect(message).toBe(expected);
    expect(location?.start).toEqual({ line: 2, column: 14 });
  });

  it("an error from another source — a compiled filter — points at the span", async () => {
    const withFilter = engine.derive({ filters: { city: engine.compile("x => x.address.city") } });
    const { message, location } = await diagnosticOf(() => withFilter.render("a\nb ${{ city(user) }}", { user: { address: null } }));
    expect(message).toBe("`x.address` is null, cannot read `city`");
    expect(location).toEqual({ source: "a\nb ${{ city(user) }}", start: { line: 2, column: 6 } });
  });

  it("extractSpans reports the offset of an unterminated span", () => {
    expect(() => extractSpans("ab ${{ x")).toThrow(expect.objectContaining({ offset: 3 }));
  });
});

describe("formatDiagnostic / ExpressionError.format", () => {
  it("prints position, message and a caret under the span", async () => {
    const error = await engine.evaluate("x | map(v => v.id)", { x: null }).catch((e: ExpressionError) => e);
    expect((error as ExpressionError).format({ name: "rules.yaml" })).toBe([
      "rules.yaml:1:5: error: map() requires an array, got null",
      "  1 | x | map(v => v.id)",
      "    |     ^^^^^^^^^^^^^^",
    ].join("\n"));
  });

  it("prints a value template's path as an accessor", async () => {
    const error = await engine
      .renderObject({ headers: { "content-type": "${{ a.b.c }}" }, rows: ["${{ 1 }}", "${{ a.b.c }}"] }, { a: null })
      .catch((e: ExpressionError) => e);
    expect((error as ExpressionError).format()).toBe([
      "1:3: error: `a` is null, cannot read `b`",
      "  at headers[\"content-type\"]",
      "  1 |  a.b.c ",
      "    |   ^",
    ].join("\n"));
  });

  it("keeps tabs so the caret lines up", () => {
    const text = formatDiagnostic({
      message: "m",
      location: { source: "a\n\t\tb.c", start: { line: 2, column: 4 }, end: { line: 2, column: 5 } },
    });
    expect(text.split("\n").slice(1)).toEqual(["  2 | \t\tb.c", "    | \t\t ^"]);
  });

  it("without a position shows a one-line source and no caret", () => {
    expect(formatDiagnostic({ message: "m", location: { source: "a + b" } })).toBe("error: m\n  | a + b");
    expect(formatDiagnostic({ message: "m", location: { source: "a\nb" } })).toBe("error: m");
    expect(formatDiagnostic({ message: "m" }, { name: "f" })).toBe("f: error: m");
    // A position past the source's last line still prints, with an empty excerpt line.
    expect(formatDiagnostic({ message: "m", location: { source: "a", start: { line: 3, column: 1 } } }))
      .toBe("3:1: error: m\n  3 | \n    | ^");
  });

  it("separates several diagnostics with a blank line", () => {
    const error = new ExpressionError([{ message: "one" }, { message: "two", path: [0, "k"] }]);
    expect(error.format()).toBe("error: one\n\nerror: two\n  at [0].k");
  });
});

