import { describe, expect, it } from "vitest";
import type { ASTNode } from "./ast.js";
import { ParseError, parse } from "./parse.js";

// Helper — parse and return typed node
function p(src: string): ASTNode {
  return parse(src);
}

describe("parser", () => {
  // ── Literals ──────────────────────────────────────────────────────────────

  describe("literals", () => {
    it("accepts the largest finite number literal and rejects an overflowing one", () => {
      expect(parse(`1${"0".repeat(308)}`)).toMatchObject({ kind: "literal", value: 1e308 });
      let err: unknown;
      try {
        parse(`1 + 1${"0".repeat(309)}`);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).message).toBe("Number literal is too large");
      expect((err as ParseError).start).toMatchObject({ column: 5 });
    });

    it("keeps a tiny decimal literal that underflows to 0", () => {
      expect(parse(`0.${"0".repeat(400)}1`)).toMatchObject({ kind: "literal", value: 0 });
    });

    it("integer", () => {
      expect(p("42")).toMatchObject({ kind: "literal", value: 42 });
    });

    it("float", () => {
      expect(p("3.14")).toMatchObject({ kind: "literal", value: 3.14 });
    });

    it("double-quoted string", () => {
      expect(p('"hello"')).toMatchObject({ kind: "literal", value: "hello" });
    });

    it("single-quoted string", () => {
      expect(p("'world'")).toMatchObject({ kind: "literal", value: "world" });
    });

    it("string escape sequences", () => {
      expect(p(String.raw`"a\nb"`)).toMatchObject({ kind: "literal", value: "a\nb" });
      expect(p(String.raw`"a\tb"`)).toMatchObject({ kind: "literal", value: "a\tb" });
      expect(p(String.raw`"a\\b"`)).toMatchObject({ kind: "literal", value: String.raw`a\b` });
      expect(p(String.raw`"a\"b"`)).toMatchObject({ kind: "literal", value: 'a"b' });
      expect(p(String.raw`'a\'b'`)).toMatchObject({ kind: "literal", value: "a'b" });
      expect(p(String.raw`"a\rb"`)).toMatchObject({ kind: "literal", value: "a\rb" });
    });

    it("unrecognized escape sequence is passed through verbatim", () => {
      // \a is not a known escape — kept as \a
      expect(p(String.raw`"\a"`)).toMatchObject({ kind: "literal", value: String.raw`\a` });
    });

    it("true", () => {
      expect(p("true")).toMatchObject({ kind: "literal", value: true });
    });

    it("false", () => {
      expect(p("false")).toMatchObject({ kind: "literal", value: false });
    });

    it("null", () => {
      expect(p("null")).toMatchObject({ kind: "literal", value: null });
    });
  });

  // ── Identifier ────────────────────────────────────────────────────────────

  describe("identifier", () => {
    it("simple name", () => {
      expect(p("foo")).toMatchObject({ kind: "identifier", name: "foo" });
    });

    it("underscore prefix", () => {
      expect(p("_val")).toMatchObject({ kind: "identifier", name: "_val" });
    });

    it("includes digits after start", () => {
      expect(p("x1")).toMatchObject({ kind: "identifier", name: "x1" });
    });
  });

  // ── Unary operators ───────────────────────────────────────────────────────

  describe("unary operators", () => {
    it("! bang", () => {
      expect(p("!foo")).toMatchObject({
        kind: "unary",
        op: "!",
        operand: { kind: "identifier", name: "foo" },
      });
    });

    it("not keyword", () => {
      expect(p("not foo")).toMatchObject({
        kind: "unary",
        op: "not",
        operand: { kind: "identifier", name: "foo" },
      });
    });

    it("unary minus", () => {
      expect(p("-x")).toMatchObject({
        kind: "unary",
        op: "-",
        operand: { kind: "identifier", name: "x" },
      });
    });

    it("double not", () => {
      expect(p("!!x")).toMatchObject({
        kind: "unary",
        op: "!",
        operand: { kind: "unary", op: "!" },
      });
    });

    it("! binds tighter than binary: !a && b → (!a) && b", () => {
      expect(p("!a && b")).toMatchObject({
        kind: "binary",
        op: "&&",
        left: { kind: "unary", op: "!" },
      });
    });

    it("! binds looser than member access: !a.b → !(a.b)", () => {
      expect(p("!a.b")).toMatchObject({
        kind: "unary",
        op: "!",
        operand: { kind: "member", property: "b" },
      });
    });
  });

  // ── Binary operators ──────────────────────────────────────────────────────

  describe("binary operators", () => {
    it("addition", () => {
      expect(p("a + b")).toMatchObject({ kind: "binary", op: "+" });
    });

    it("subtraction", () => {
      expect(p("a - b")).toMatchObject({ kind: "binary", op: "-" });
    });

    it("multiplication", () => {
      expect(p("a * b")).toMatchObject({ kind: "binary", op: "*" });
    });

    it("division", () => {
      expect(p("a / b")).toMatchObject({ kind: "binary", op: "/" });
    });

    it("modulo", () => {
      expect(p("a % b")).toMatchObject({ kind: "binary", op: "%" });
    });

    it("exponentiation is right-associative", () => {
      expect(p("a ** b ** c")).toMatchObject({
        kind: "binary",
        op: "**",
        left: { kind: "identifier", name: "a" },
        right: { kind: "binary", op: "**" },
      });
    });

    it("exponentiation binds tighter than multiplication and unary minus", () => {
      expect(p("a * b ** c")).toMatchObject({ op: "*", right: { op: "**" } });
      expect(p("(-a) ** b")).toMatchObject({ op: "**", left: { kind: "unary", op: "-" } });
      expect(p("-(a ** b)")).toMatchObject({ kind: "unary", op: "-", operand: { op: "**" } });
      expect(p("-a * b")).toMatchObject({ kind: "binary", op: "*", left: { kind: "unary" } });
      expect(p("a ** -b")).toMatchObject({ op: "**", right: { kind: "unary", op: "-" } });
    });

    it("equality", () => {
      expect(p("a == b")).toMatchObject({ kind: "binary", op: "==" });
    });

    it("inequality", () => {
      expect(p("a != b")).toMatchObject({ kind: "binary", op: "!=" });
    });

    it("less than", () => {
      expect(p("a < b")).toMatchObject({ kind: "binary", op: "<" });
    });

    it("greater than", () => {
      expect(p("a > b")).toMatchObject({ kind: "binary", op: ">" });
    });

    it("less or equal", () => {
      expect(p("a <= b")).toMatchObject({ kind: "binary", op: "<=" });
    });

    it("greater or equal", () => {
      expect(p("a >= b")).toMatchObject({ kind: "binary", op: ">=" });
    });

    it("logical &&", () => {
      expect(p("a && b")).toMatchObject({ kind: "binary", op: "&&" });
    });

    it("keyword and", () => {
      expect(p("a and b")).toMatchObject({ kind: "binary", op: "&&" });
    });

    it("logical ||", () => {
      expect(p("a || b")).toMatchObject({ kind: "binary", op: "||" });
    });

    it("keyword or", () => {
      expect(p("a or b")).toMatchObject({ kind: "binary", op: "||" });
    });

    it("nullish ??", () => {
      expect(p("a ?? b")).toMatchObject({ kind: "binary", op: "??" });
    });

    it("membership in", () => {
      expect(p('"x" in arr')).toMatchObject({ kind: "binary", op: "in" });
    });
  });

  // ── Precedence ────────────────────────────────────────────────────────────

  describe("precedence", () => {
    it("* before +: a + b * c → a + (b * c)", () => {
      expect(p("a + b * c")).toMatchObject({
        kind: "binary",
        op: "+",
        right: { kind: "binary", op: "*" },
      });
    });

    it("+ left-associative: a + b + c → (a + b) + c", () => {
      expect(p("a + b + c")).toMatchObject({
        kind: "binary",
        op: "+",
        left: { kind: "binary", op: "+" },
      });
    });

    it("* left-associative: a * b * c → (a * b) * c", () => {
      expect(p("a * b * c")).toMatchObject({
        kind: "binary",
        op: "*",
        left: { kind: "binary", op: "*" },
      });
    });

    it("< before ==: a < b == c < d → (a<b) == (c<d)", () => {
      expect(p("a < b == c < d")).toMatchObject({
        kind: "binary",
        op: "==",
        left: { kind: "binary", op: "<" },
        right: { kind: "binary", op: "<" },
      });
    });

    it("== before in: a == b in arr → (a==b) in arr", () => {
      expect(p("a == b in arr")).toMatchObject({
        kind: "binary",
        op: "in",
        left: { kind: "binary", op: "==" },
      });
    });

    it("in before &&: x in arr && y → (x in arr) && y", () => {
      expect(p("x in arr && y")).toMatchObject({
        kind: "binary",
        op: "&&",
        left: { kind: "binary", op: "in" },
      });
    });

    it("&& before ||: a || b && c → a || (b && c)", () => {
      expect(p("a || b && c")).toMatchObject({
        kind: "binary",
        op: "||",
        right: { kind: "binary", op: "&&" },
      });
    });

    it("|| before ??: a ?? b || c → (a?? b) || c would be ILLEGAL — here test valid: a ?? (b || c) via parens", () => {
      expect(() => p("a ?? b || c")).toThrow(ParseError);
    });

    it("grouping overrides: (a + b) * c", () => {
      expect(p("(a + b) * c")).toMatchObject({
        kind: "binary",
        op: "*",
        left: { kind: "binary", op: "+" },
      });
    });

    it("ternary lower than binary: a + b ? c : d → (a+b) ? c : d", () => {
      expect(p("a + b ? c : d")).toMatchObject({
        kind: "ternary",
        condition: { kind: "binary", op: "+" },
      });
    });

    it("pipe lower than ternary: a ? b : c | fn → (a?b:c) | fn", () => {
      expect(p("a ? b : c | fn")).toMatchObject({
        kind: "pipe",
        callee: "fn",
        left: { kind: "ternary" },
      });
    });
  });

  // ── Member access ─────────────────────────────────────────────────────────

  describe("member access", () => {
    it("dot notation", () => {
      expect(p("obj.prop")).toMatchObject({
        kind: "member",
        property: "prop",
        optional: false,
        object: { kind: "identifier", name: "obj" },
      });
    });

    it("optional dot", () => {
      expect(p("obj?.prop")).toMatchObject({
        kind: "member",
        property: "prop",
        optional: true,
      });
    });

    it("bracket notation", () => {
      expect(p("obj[key]")).toMatchObject({
        kind: "index",
        optional: false,
        key: { kind: "identifier", name: "key" },
      });
    });

    it("optional bracket ?.[", () => {
      expect(p("obj?.[key]")).toMatchObject({
        kind: "index",
        optional: true,
        key: { kind: "identifier", name: "key" },
      });
    });

    it("chained dot: a.b.c", () => {
      expect(p("a.b.c")).toMatchObject({
        kind: "member",
        property: "c",
        object: { kind: "member", property: "b" },
      });
    });

    it("mixed chain: a.b[c].d", () => {
      expect(p("a.b[c].d")).toMatchObject({
        kind: "member",
        property: "d",
        object: {
          kind: "index",
          object: { kind: "member", property: "b" },
        },
      });
    });

    it("string literal key in brackets", () => {
      expect(p('obj["key"]')).toMatchObject({
        kind: "index",
        key: { kind: "literal", value: "key" },
      });
    });

    it("source positions on member node span from object start to prop end", () => {
      const node = p("obj.prop");
      expect(node.start).toEqual({ line: 1, column: 1 });
      expect(node.end).toEqual({ line: 1, column: 9 });
    });
  });

  // ── Function calls ────────────────────────────────────────────────────────

  describe("function calls", () => {
    it("no args", () => {
      expect(p("fn()")).toMatchObject({ kind: "call", callee: "fn", args: [] });
    });

    it("single arg", () => {
      expect(p("fn(x)")).toMatchObject({
        kind: "call",
        callee: "fn",
        args: [{ kind: "identifier", name: "x" }],
      });
    });

    it("multiple args", () => {
      expect(p("fn(a, b, c)")).toMatchObject({
        kind: "call",
        callee: "fn",
        args: [
          { kind: "identifier", name: "a" },
          { kind: "identifier", name: "b" },
          { kind: "identifier", name: "c" },
        ],
      });
    });

    it("nested call", () => {
      expect(p("fn(g(x))")).toMatchObject({
        kind: "call",
        callee: "fn",
        args: [{ kind: "call", callee: "g" }],
      });
    });

    it("call with expression arg", () => {
      expect(p("fn(a + b)")).toMatchObject({
        kind: "call",
        callee: "fn",
        args: [{ kind: "binary", op: "+" }],
      });
    });

    it("qualified callee: a dotted name names a function", () => {
      expect(p("mod.fn(1)")).toMatchObject({ kind: "call", callee: "mod.fn", args: [{ kind: "literal", value: 1 }] });
      expect(p("a.b.c()")).toMatchObject({ kind: "call", callee: "a.b.c", args: [] });
    });

    it("a dotted name without a call stays member access", () => {
      expect(p("mod.fn")).toMatchObject({ kind: "member", property: "fn" });
    });

    it("expression callee throws", () => {
      expect(() => p("(a + b)(1)")).toThrow(ParseError);
      expect(() => p("a[0](1)")).toThrow(ParseError);
      expect(() => p("a[0].fn(1)")).toThrow(ParseError);
    });

    it("optional member callee throws", () => {
      expect(() => p("obj?.fn()")).toThrow(ParseError);
    });
  });

  // ── Pipe ─────────────────────────────────────────────────────────────────

  describe("pipe", () => {
    it("no args: x | fn", () => {
      expect(p("x | fn")).toMatchObject({ kind: "pipe", callee: "fn", args: [] });
    });

    it("with args: x | fn(a)", () => {
      expect(p("x | fn(a)")).toMatchObject({
        kind: "pipe",
        callee: "fn",
        args: [{ kind: "identifier", name: "a" }],
      });
    });

    it("chained left-to-right: x | f | g(y)", () => {
      expect(p("x | f | g(y)")).toMatchObject({
        kind: "pipe",
        callee: "g",
        left: { kind: "pipe", callee: "f", left: { kind: "identifier", name: "x" } },
      });
    });

    it("qualified callee: x | mod.fn(a)", () => {
      expect(p("x | mod.fn(a)")).toMatchObject({
        kind: "pipe",
        callee: "mod.fn",
        args: [{ kind: "identifier", name: "a" }],
      });
    });

    it("pipe is lower than arithmetic: a + b | fn → (a+b) | fn", () => {
      expect(p("a + b | fn")).toMatchObject({
        kind: "pipe",
        callee: "fn",
        left: { kind: "binary", op: "+" },
      });
    });

    it("non-identifier after pipe throws", () => {
      expect(() => p("x | 42")).toThrow(ParseError);
    });
  });

  // ── Ternary ───────────────────────────────────────────────────────────────

  describe("ternary", () => {
    it("basic a ? b : c", () => {
      expect(p("a ? b : c")).toMatchObject({
        kind: "ternary",
        condition: { name: "a" },
        consequent: { name: "b" },
        alternate: { name: "c" },
      });
    });

    it("right-associative: a ? b : c ? d : e → a ? b : (c ? d : e)", () => {
      expect(p("a ? b : c ? d : e")).toMatchObject({
        kind: "ternary",
        condition: { name: "a" },
        consequent: { name: "b" },
        alternate: { kind: "ternary", condition: { name: "c" } },
      });
    });

    it("expression in condition", () => {
      expect(p("a > 0 ? b : c")).toMatchObject({
        kind: "ternary",
        condition: { kind: "binary", op: ">" },
      });
    });

    it("missing colon throws", () => {
      expect(() => p("a ? b")).toThrow(ParseError);
    });
  });

  // ── Array literals ────────────────────────────────────────────────────────

  describe("array literals", () => {
    it("empty array", () => {
      expect(p("[]")).toMatchObject({ kind: "array", elements: [] });
    });

    it("numbers", () => {
      expect(p("[1, 2, 3]")).toMatchObject({
        kind: "array",
        elements: [{ value: 1 }, { value: 2 }, { value: 3 }],
      });
    });

    it("mixed expressions", () => {
      expect(p("[a, b + c, fn(x)]")).toMatchObject({
        kind: "array",
        elements: [
          { kind: "identifier" },
          { kind: "binary" },
          { kind: "call" },
        ],
      });
    });

    it("nested array", () => {
      expect(p("[[1, 2], [3]]")).toMatchObject({
        kind: "array",
        elements: [{ kind: "array" }, { kind: "array" }],
      });
    });
  });

  // ── Object literals ───────────────────────────────────────────────────────

  describe("object literals", () => {
    it("empty object", () => {
      expect(p("{}")).toMatchObject({ kind: "object", entries: [] });
    });

    it("single entry", () => {
      expect(p('{ "a": 1 }')).toMatchObject({
        kind: "object",
        entries: [["a", { value: 1 }]],
      });
    });

    it("multiple entries", () => {
      expect(p('{ "a": 1, "b": x }')).toMatchObject({
        kind: "object",
        entries: [
          ["a", { kind: "literal", value: 1 }],
          ["b", { kind: "identifier", name: "x" }],
        ],
      });
    });

    it("unquoted identifier key", () => {
      expect(p("{ a: 1 }")).toMatchObject({
        kind: "object",
        entries: [["a", { value: 1 }]],
      });
    });

    it("unquoted identifier keys — multiple entries", () => {
      expect(p("{ days: 3, hours: 2 }")).toMatchObject({
        kind: "object",
        entries: [
          ["days", { value: 3 }],
          ["hours", { value: 2 }],
        ],
      });
    });

    it("unquoted and quoted keys can be mixed", () => {
      expect(p('{ a: 1, "b": 2 }')).toMatchObject({
        kind: "object",
        entries: [
          ["a", { value: 1 }],
          ["b", { value: 2 }],
        ],
      });
    });

    it("value can be an expression", () => {
      expect(p('{ "x": a + b }')).toMatchObject({
        kind: "object",
        entries: [["x", { kind: "binary", op: "+" }]],
      });
    });
  });

  // ── ?? mixing restriction ─────────────────────────────────────────────────

  describe("?? mixing restriction", () => {
    it("a && b ?? c throws", () => {
      expect(() => p("a && b ?? c")).toThrow(ParseError);
    });

    it("a ?? b && c throws", () => {
      expect(() => p("a ?? b && c")).toThrow(ParseError);
    });

    it("a || b ?? c throws", () => {
      expect(() => p("a || b ?? c")).toThrow(ParseError);
    });

    it("a ?? b || c throws", () => {
      expect(() => p("a ?? b || c")).toThrow(ParseError);
    });

    it("a and b ?? c throws (keyword alias)", () => {
      expect(() => p("a and b ?? c")).toThrow(ParseError);
    });

    it("a ?? b or c throws (keyword alias)", () => {
      expect(() => p("a ?? b or c")).toThrow(ParseError);
    });

    it("?? chained: a ?? b ?? c is fine", () => {
      expect(() => p("a ?? b ?? c")).not.toThrow();
    });

    it("(a && b) ?? c is fine — parens reset context", () => {
      expect(() => p("(a && b) ?? c")).not.toThrow();
    });

    it("a ?? (b && c) is fine — parens reset context", () => {
      expect(() => p("a ?? (b && c)")).not.toThrow();
    });

    it("a || b || c is fine", () => {
      expect(() => p("a || b || c")).not.toThrow();
    });
  });

  // ── Reserved name rejection ───────────────────────────────────────────────

  describe("reserved name rejection", () => {
    it("obj.__proto__ throws", () => {
      expect(() => p("obj.__proto__")).toThrow(ParseError);
    });

    it("obj.constructor throws", () => {
      expect(() => p("obj.constructor")).toThrow(ParseError);
    });

    it("obj.prototype throws", () => {
      expect(() => p("obj.prototype")).toThrow(ParseError);
    });

    it('obj["__proto__"] throws', () => {
      expect(() => p('obj["__proto__"]')).toThrow(ParseError);
    });

    it('obj["constructor"] throws', () => {
      expect(() => p('obj["constructor"]')).toThrow(ParseError);
    });

    it("obj?.constructor throws", () => {
      expect(() => p("obj?.constructor")).toThrow(ParseError);
    });

    it("obj?.[dynamic] is fine — dynamic keys cannot be checked at parse time", () => {
      expect(() => p("obj?.[key]")).not.toThrow();
    });

    it('obj?.["__proto__"] throws', () => {
      expect(() => p('obj?.["__proto__"]')).toThrow(ParseError);
    });

    it('obj?.["constructor"] throws', () => {
      expect(() => p('obj?.["constructor"]')).toThrow(ParseError);
    });

    it("obj.__defineGetter__ throws", () => {
      expect(() => p("obj.__defineGetter__")).toThrow(ParseError);
    });

    it.each(["obj.constructor", "obj?.constructor", 'obj["constructor"]', "constructor => 1", "let constructor = 1 in 1"])(
      "%s names the reserved name",
      (source) => {
        expect(() => p(source)).toThrow("Access to reserved name 'constructor' is not allowed");
      },
    );
  });

  // ── Syntax errors with positions ──────────────────────────────────────────

  describe("syntax errors", () => {
    it("empty expression throws", () => {
      expect(() => p("")).toThrow(ParseError);
    });

    it("unclosed paren throws", () => {
      expect(() => p("(a + b")).toThrow(ParseError);
    });

    it("stray token after expression throws", () => {
      expect(() => p("a b")).toThrow(ParseError);
    });

    it("missing operand throws", () => {
      expect(() => p("a +")).toThrow(ParseError);
    });

    it("ParseError carries source position", () => {
      let err: ParseError | undefined;
      try { p("obj.constructor"); } catch (e) { err = e as ParseError; }
      expect(err).toBeInstanceOf(ParseError);
      expect(err?.start).toBeDefined();
      expect(err?.start.line).toBe(1);
      expect(err?.start.column).toBeGreaterThan(1);
    });

    it("unclosed array throws", () => {
      expect(() => p("[1, 2")).toThrow(ParseError);
    });

    it("unclosed object throws", () => {
      expect(() => p('{ "a": 1')).toThrow(ParseError);
    });

    it("unterminated argument list (EOF in args) throws", () => {
      expect(() => p("fn(a")).toThrow(ParseError);
    });
  });

  // ── Source positions ──────────────────────────────────────────────────────

  describe("source positions", () => {
    it("number literal starts at column 1", () => {
      const n = p("42");
      expect(n.start).toEqual({ line: 1, column: 1 });
    });

    it("identifier after spaces has correct column", () => {
      const n = p("  foo");
      expect(n.start).toEqual({ line: 1, column: 3 });
    });

    it("binary node spans both operands", () => {
      const n = p("a + b");
      expect(n.start).toEqual({ line: 1, column: 1 });
      expect(n.end).toEqual({ line: 1, column: 6 });
    });
  });

  // ── Complex / integration expressions ────────────────────────────────────

  describe("complex expressions", () => {
    it("chained optional access with nullish fallback", () => {
      expect(p("user?.contact?.email ?? null")).toMatchObject({
        kind: "binary",
        op: "??",
        left: { kind: "member", property: "email", optional: true },
      });
    });

    it("pipe chain with member access", () => {
      expect(p('items | filter(x) | join(",")')).toMatchObject({
        kind: "pipe",
        callee: "join",
        left: { kind: "pipe", callee: "filter" },
      });
    });

    it("ternary with arithmetic", () => {
      expect(p("count > 0 ? count * 2 : 0")).toMatchObject({
        kind: "ternary",
        condition: { kind: "binary", op: ">" },
        consequent: { kind: "binary", op: "*" },
        alternate: { kind: "literal", value: 0 },
      });
    });

    it("membership in array literal", () => {
      expect(p('"a" in ["a", "b"]')).toMatchObject({
        kind: "binary",
        op: "in",
        right: { kind: "array" },
      });
    });

    it("unary minus in expression", () => {
      expect(p("a + -b")).toMatchObject({
        kind: "binary",
        op: "+",
        right: { kind: "unary", op: "-" },
      });
    });
  });
});

// ── Trailing commas ───────────────────────────────────────────────────────────

describe("trailing commas", () => {
  it("array literal accepts trailing comma", () => {
    expect(p("[1, 2, 3,]")).toMatchObject({
      kind: "array",
      elements: [{ kind: "literal", value: 1 }, { kind: "literal", value: 2 }, { kind: "literal", value: 3 }],
    });
  });

  it("object literal accepts trailing comma", () => {
    expect(p("{ a: 1, b: 2, }")).toMatchObject({
      kind: "object",
      entries: [
        ["a", { kind: "literal", value: 1 }],
        ["b", { kind: "literal", value: 2 }],
      ],
    });
  });

  it("function call accepts trailing comma", () => {
    expect(p("str(42,)")).toMatchObject({
      kind: "call",
      callee: "str",
      args: [{ kind: "literal", value: 42 }],
    });
  });
});

// ── Arrow param backtracking ──────────────────────────────────────────────────

describe("arrow param parsing — backtrack on non-identifier after comma", () => {
  it("(ident, non-ident) fails arrow-param lookahead and falls through to an error", () => {
    // tryParseArrowParamList sees `a`, then `, `, then `1` (Number — not Identifier)
    // → returns null (line 609 hit). Parser restores position and tries regular
    // grouping: parses `a` as expr, then expects `)` but sees `,` → ParseError.
    expect(() => p("(a, 1)")).toThrow(ParseError);
  });
});
