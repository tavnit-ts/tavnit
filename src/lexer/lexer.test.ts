import { describe, expect, it } from "vitest";
import { extractSpans, parseTemplate } from "./spans.js";
import { TokenKind } from "./token.js";
import { tokenize } from "./tokenize.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kinds(source: string): string[] {
  return tokenize(source).map((t) => t.kind);
}

function nonEof(source: string) {
  return tokenize(source).filter((t) => t.kind !== TokenKind.EOF);
}

it("tokenizes Cyrillic context identifiers", () => {
  expect(nonEof("пробное.предмет")).toMatchObject([
    { kind: TokenKind.Identifier, value: "пробное" },
    { kind: TokenKind.Dot },
    { kind: TokenKind.Identifier, value: "предмет" },
  ]);
});

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

describe("number literals", () => {
  it("tokenizes integer", () => {
    expect(nonEof("42")).toMatchObject([{ kind: "Number", value: "42" }]);
  });

  it("tokenizes float", () => {
    expect(nonEof("3.14")).toMatchObject([{ kind: "Number", value: "3.14" }]);
  });

  it("tokenizes 0", () => {
    expect(nonEof("0")).toMatchObject([{ kind: "Number", value: "0" }]);
  });

  it("treats minus as separate Minus token before number", () => {
    const ts = nonEof("-7");
    expect(ts[0]?.kind).toBe(TokenKind.Minus);
    expect(ts[1]?.kind).toBe(TokenKind.Number);
    expect(ts[1]?.value).toBe("7");
  });

  it("does not include trailing dot when next char is not digit", () => {
    const ts = nonEof("42.foo");
    expect(ts[0]).toMatchObject({ kind: "Number", value: "42" });
    expect(ts[1]).toMatchObject({ kind: "Dot", value: "." });
    expect(ts[2]).toMatchObject({ kind: "Identifier", value: "foo" });
  });
});

describe("string literals", () => {
  it("double-quoted string", () => {
    const ts = nonEof('"hello"');
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ kind: "String", value: '"hello"' });
  });

  it("single-quoted string", () => {
    const ts = nonEof("'world'");
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ kind: "String", value: "'world'" });
  });

  it("double-quoted with backslash escapes", () => {
    const ts = nonEof(String.raw`"a\nb\tc"`);
    expect(ts[0]?.value).toBe(String.raw`"a\nb\tc"`);
  });

  it("single-quoted with escaped single quote", () => {
    const ts = nonEof(String.raw`'it\'s'`);
    expect(ts[0]?.value).toBe(String.raw`'it\'s'`);
  });

  it("double-quoted with escaped double quote", () => {
    const ts = nonEof(String.raw`"say \"hi\""`);
    expect(ts[0]?.value).toBe(String.raw`"say \"hi\""`);
  });

  it("throws on unterminated double-quoted string", () => {
    expect(() => tokenize('"unterminated')).toThrow(/Unterminated/);
  });

  it("throws on unterminated single-quoted string", () => {
    expect(() => tokenize("'unterminated")).toThrow(/Unterminated/);
  });

  it("throws on newline inside double-quoted string", () => {
    expect(() => tokenize('"line1\nline2"')).toThrow(/Unterminated/);
  });

  it("throws on newline inside single-quoted string", () => {
    expect(() => tokenize("'line1\nline2'")).toThrow(/Unterminated/);
  });

  it("throws on string ending with lone backslash before EOF", () => {
    // backslash is the last char — the post-escape char read is skipped, then EOF triggers unterminated
    expect(() => tokenize('"foo\\')).toThrow(/Unterminated/);
  });

  it("all supported escape sequences preserved in raw text", () => {
    const ts = nonEof(String.raw`"\\\n\t\r"`);
    expect(ts[0]?.kind).toBe(TokenKind.String);
  });
});

describe("boolean and null literals", () => {
  it("true", () => {
    expect(nonEof("true")).toMatchObject([{ kind: "True", value: "true" }]);
  });

  it("false", () => {
    expect(nonEof("false")).toMatchObject([{ kind: "False", value: "false" }]);
  });

  it("null", () => {
    expect(nonEof("null")).toMatchObject([{ kind: "Null", value: "null" }]);
  });
});

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

describe("identifiers", () => {
  it("simple identifier", () => {
    expect(nonEof("foo")).toMatchObject([{ kind: "Identifier", value: "foo" }]);
  });

  it("identifier with underscore", () => {
    expect(nonEof("_bar")).toMatchObject([{ kind: "Identifier", value: "_bar" }]);
  });

  it("identifier with digits", () => {
    expect(nonEof("foo42")).toMatchObject([{ kind: "Identifier", value: "foo42" }]);
  });

  it("camelCase identifier", () => {
    expect(nonEof("myVar")).toMatchObject([{ kind: "Identifier", value: "myVar" }]);
  });
});

// ---------------------------------------------------------------------------
// Reserved words
// ---------------------------------------------------------------------------

describe("reserved words", () => {
  it("let", () => {
    expect(nonEof("let")).toMatchObject([{ kind: "Let" }]);
  });

  it("in", () => {
    expect(nonEof("in")).toMatchObject([{ kind: "In" }]);
  });

  it("and", () => {
    expect(nonEof("and")).toMatchObject([{ kind: "And" }]);
  });

  it("or", () => {
    expect(nonEof("or")).toMatchObject([{ kind: "Or" }]);
  });

  it("not", () => {
    expect(nonEof("not")).toMatchObject([{ kind: "Not" }]);
  });

  it("an Object.prototype member name is an identifier", () => {
    expect(nonEof("constructor toString valueOf")).toMatchObject([
      { kind: "Identifier" }, { kind: "Identifier" }, { kind: "Identifier" },
    ]);
  });

  it("identifier starting with reserved word is not reserved", () => {
    expect(nonEof("inlet")).toMatchObject([{ kind: "Identifier", value: "inlet" }]);
    expect(nonEof("notFound")).toMatchObject([{ kind: "Identifier", value: "notFound" }]);
    expect(nonEof("letter")).toMatchObject([{ kind: "Identifier", value: "letter" }]);
  });
});

// ---------------------------------------------------------------------------
// Single-character operators
// ---------------------------------------------------------------------------

describe("single-character operators", () => {
  const cases: [string, string][] = [
    ["+", "Plus"],
    ["-", "Minus"],
    ["*", "Star"],
    ["/", "Slash"],
    ["%", "Percent"],
    ["!", "Bang"],
    ["|", "PipeOp"],
    ["?", "Question"],
    [":", "Colon"],
    ["<", "Lt"],
    [">", "Gt"],
    [".", "Dot"],
    [",", "Comma"],
    ["(", "LParen"],
    [")", "RParen"],
    ["[", "LBracket"],
    ["]", "RBracket"],
    ["{", "LBrace"],
    ["}", "RBrace"],
  ];

  for (const [src, kind] of cases) {
    it(`${src} → ${kind}`, () => {
      expect(nonEof(src)).toMatchObject([{ kind, value: src }]);
    });
  }
});

// ---------------------------------------------------------------------------
// Multi-character operators
// ---------------------------------------------------------------------------

describe("multi-character operators", () => {
  it("&&", () => {
    expect(nonEof("&&")).toMatchObject([{ kind: "AmpAmp", value: "&&" }]);
  });

  it("||", () => {
    expect(nonEof("||")).toMatchObject([{ kind: "PipePipe", value: "||" }]);
  });

  it("??", () => {
    expect(nonEof("??")).toMatchObject([{ kind: "QuestionQuestion", value: "??" }]);
  });

  it("?.", () => {
    expect(nonEof("?.")).toMatchObject([{ kind: "QuestionDot", value: "?." }]);
  });

  it("=>", () => {
    expect(nonEof("=>")).toMatchObject([{ kind: "Arrow", value: "=>" }]);
  });

  it("==", () => {
    expect(nonEof("==")).toMatchObject([{ kind: "Eq", value: "==" }]);
  });

  it("!=", () => {
    expect(nonEof("!=")).toMatchObject([{ kind: "NotEq", value: "!=" }]);
  });

  it("<=", () => {
    expect(nonEof("<=")).toMatchObject([{ kind: "LtEq", value: "<=" }]);
  });

  it(">=", () => {
    expect(nonEof(">=")).toMatchObject([{ kind: "GtEq", value: ">=" }]);
  });

  it("?. is distinct from ? and .", () => {
    const ts = nonEof("a?.b");
    expect(ts[0]?.kind).toBe(TokenKind.Identifier);
    expect(ts[1]?.kind).toBe(TokenKind.QuestionDot);
    expect(ts[2]?.kind).toBe(TokenKind.Identifier);
  });

  it("?.[ — QuestionDot followed by LBracket", () => {
    const ts = nonEof("a?.[key]");
    expect(ts[1]?.kind).toBe(TokenKind.QuestionDot);
    expect(ts[2]?.kind).toBe(TokenKind.LBracket);
  });

  it("single & is not AmpAmp", () => {
    // & is not a valid Tavnit token — should throw
    expect(() => tokenize("&")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Position reporting
// ---------------------------------------------------------------------------

describe("position reporting", () => {
  it("first token starts at line 1, col 1", () => {
    const [t] = tokenize("foo");
    expect(t?.start).toEqual({ line: 1, column: 1 });
  });

  it("second token has correct column", () => {
    const ts = nonEof("a b");
    expect(ts[0]?.start).toEqual({ line: 1, column: 1 });
    expect(ts[1]?.start).toEqual({ line: 1, column: 3 });
  });

  it("newline advances line counter", () => {
    const ts = nonEof("a\nb");
    expect(ts[0]?.start.line).toBe(1);
    expect(ts[1]?.start.line).toBe(2);
    expect(ts[1]?.start.column).toBe(1);
  });

  it("end position is exclusive (past last char)", () => {
    const ts = nonEof("foo");
    expect(ts[0]?.end).toEqual({ line: 1, column: 4 });
  });

  it("multi-char operator end position", () => {
    const ts = nonEof("&&");
    expect(ts[0]?.start).toEqual({ line: 1, column: 1 });
    expect(ts[0]?.end).toEqual({ line: 1, column: 3 });
  });

  it("EOF token position at end of source", () => {
    const ts = tokenize("ab");
    const eof = ts.at(-1);
    expect(eof?.kind).toBe(TokenKind.EOF);
    expect(eof?.start).toEqual({ line: 1, column: 3 });
  });
});

// ---------------------------------------------------------------------------
// Whitespace
// ---------------------------------------------------------------------------

describe("whitespace", () => {
  it("spaces and tabs are ignored", () => {
    expect(kinds("  a \t b  ")).toEqual(["Identifier", "Identifier", "EOF"]);
  });

  it("tokenizes ** as one StarStar token, * * as two Stars", () => {
    expect(kinds("a ** b")).toEqual(["Identifier", "StarStar", "Identifier", "EOF"]);
    expect(kinds("a * * b")).toEqual(["Identifier", "Star", "Star", "Identifier", "EOF"]);
  });

  it("reads exponent number literals as one token", () => {
    for (const text of ["1e3", "1E3", "1.5e-3", "2e+6", "10e0"]) {
      expect(nonEof(text).map((t) => [t.kind, t.value])).toEqual([["Number", text]]);
    }
  });

  it("leaves an e without digits after it as an identifier", () => {
    expect(nonEof("1e").map((t) => t.kind)).toEqual(["Number", "Identifier"]);
    expect(nonEof("1e+").map((t) => t.kind)).toEqual(["Number", "Identifier", "Plus"]);
  });

  it("carriage return is ignored", () => {
    expect(kinds("a\rb")).toEqual(["Identifier", "Identifier", "EOF"]);
  });

  it("expression with mixed whitespace tokenizes correctly", () => {
    const ts = nonEof("price * qty");
    expect(ts.map((t) => t.kind)).toEqual(["Identifier", "Star", "Identifier"]);
  });
});

// ---------------------------------------------------------------------------
// Compound expressions
// ---------------------------------------------------------------------------

describe("compound expressions", () => {
  it("arithmetic expression", () => {
    const ts = nonEof("price * qty + 1");
    expect(ts.map((t) => t.kind)).toEqual([
      "Identifier", "Star", "Identifier", "Plus", "Number",
    ]);
  });

  it("comparison expression", () => {
    const ts = nonEof("a >= b && c != null");
    expect(ts.map((t) => t.kind)).toEqual([
      "Identifier", "GtEq", "Identifier", "AmpAmp", "Identifier", "NotEq", "Null",
    ]);
  });

  it("nullish coalescing", () => {
    const ts = nonEof("limit ?? 200");
    expect(ts.map((t) => t.kind)).toEqual(["Identifier", "QuestionQuestion", "Number"]);
  });

  it("ternary", () => {
    const ts = nonEof("a ? b : c");
    expect(ts.map((t) => t.kind)).toEqual([
      "Identifier", "Question", "Identifier", "Colon", "Identifier",
    ]);
  });

  it("pipe operator", () => {
    const ts = nonEof("price | toFixed(2)");
    expect(ts.map((t) => t.kind)).toEqual([
      "Identifier", "PipeOp", "Identifier", "LParen", "Number", "RParen",
    ]);
  });

  it("arrow function", () => {
    const ts = nonEof("x => x.price");
    expect(ts.map((t) => t.kind)).toEqual([
      "Identifier", "Arrow", "Identifier", "Dot", "Identifier",
    ]);
  });

  it("let keyword in expression", () => {
    const ts = nonEof("let x = 1 in x");
    expect(ts.map((t) => t.kind)).toEqual([
      "Let", "Identifier", "Assign", "Number", "In", "Identifier",
    ]);
  });

  it("object literal", () => {
    const ts = nonEof('{ "key": value }');
    expect(ts.map((t) => t.kind)).toEqual([
      "LBrace", "String", "Colon", "Identifier", "RBrace",
    ]);
  });

  it("array literal", () => {
    const ts = nonEof("[1, 2, 3]");
    expect(ts.map((t) => t.kind)).toEqual([
      "LBracket", "Number", "Comma", "Number", "Comma", "Number", "RBracket",
    ]);
  });

  it("keyword aliases: and / or / not", () => {
    const ts = nonEof("active and not paused or done");
    expect(ts.map((t) => t.kind)).toEqual([
      "Identifier", "And", "Not", "Identifier", "Or", "Identifier",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("error cases", () => {
  it("throws on unexpected character @", () => {
    expect(() => tokenize("foo @bar")).toThrow(/Unexpected character/);
  });

  it("throws on unexpected character #", () => {
    expect(() => tokenize("#")).toThrow(/Unexpected character/);
  });
});

// ---------------------------------------------------------------------------
// extractSpans
// ---------------------------------------------------------------------------

describe("extractSpans", () => {
  it("no spans — pure literal", () => {
    const spans = extractSpans("hello world");
    expect(spans).toEqual([{ kind: "literal", text: "hello world" }]);
  });

  it("single span only", () => {
    const spans = extractSpans("${{ name }}");
    expect(spans).toEqual([
      { kind: "expression", source: " name ", offset: 0 },
    ]);
  });

  it("single span with surrounding text", () => {
    const spans = extractSpans("/orders/${{ id }}/details");
    expect(spans).toEqual([
      { kind: "literal", text: "/orders/" },
      { kind: "expression", source: " id ", offset: 8 },
      { kind: "literal", text: "/details" },
    ]);
  });

  it("multiple spans", () => {
    const spans = extractSpans("Hello ${{ name }}, you have ${{ size(items) }} items");
    expect(spans).toHaveLength(5);
    expect(spans[0]).toEqual({ kind: "literal", text: "Hello " });
    expect(spans[1]).toMatchObject({ kind: "expression", source: " name " });
    expect(spans[2]).toEqual({ kind: "literal", text: ", you have " });
    expect(spans[3]).toMatchObject({ kind: "expression", source: " size(items) " });
    expect(spans[4]).toEqual({ kind: "literal", text: " items" });
  });

  it("tavnit escape maps to literal open-brace sequence, rest continues as literal", () => {
    // Input: "cost is $\{{ expensive }}" — $\{{ is the escape, everything after is literal
    const input = String.raw`cost is $\{{ expensive }}`;
    const spans = extractSpans(input);
    const openBrace = "$" + "{{";
    expect(spans).toEqual([{ kind: "literal", text: `cost is ${openBrace} expensive }}` }]);
  });

  it("tavnit escape followed immediately by an expression span", () => {
    // Input: "$\{{ ${{ value }}" — escape produces literal "${{", then expression span
    // String.raw avoids \\; openBrace variable avoids ${{ literal triggering lint rules.
    const openBrace = "$" + "{{";
    const escapePart = String.raw`$\{{ `;
    const input = `${escapePart}${openBrace} value }}`;
    const spans = extractSpans(input);
    expect(spans[0]).toEqual({ kind: "literal", text: `${openBrace} ` });
    expect(spans[1]).toMatchObject({ kind: "expression", source: " value " });
  });

  it("empty template", () => {
    expect(extractSpans("")).toEqual([]);
  });

  it("adjacent spans with no literal between", () => {
    const spans = extractSpans("${{ a }}${{ b }}");
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ kind: "expression", source: " a " });
    expect(spans[1]).toMatchObject({ kind: "expression", source: " b " });
  });

  it("a }} inside a string literal does not end the span", () => {
    const open = "$" + "{{";
    expect(extractSpans(`${open} "}}" }}`)).toEqual([{ kind: "expression", source: ' "}}" ', offset: 0 }]);
    expect(extractSpans(`${open} '}}' + "x" }}!`)).toEqual([
      { kind: "expression", source: ` '}}' + "x" `, offset: 0 },
      { kind: "literal", text: "!" },
    ]);
  });

  it("an escaped quote does not end the string", () => {
    const open = "$" + "{{";
    const spans = extractSpans(`${open} "a\\"}}" }}`);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ kind: "expression", source: ' "a\\"}}" ' });
  });

  it("a nested template marker inside a string stays in the span", () => {
    const open = "$" + "{{";
    const spans = extractSpans(`${open} x == "${open} y }}" }}`);
    expect(spans).toEqual([{ kind: "expression", source: ` x == "${open} y }}" `, offset: 0 }]);
  });

  it("a } right before the terminator closes the object, not the span", () => {
    const open = "$" + "{{";
    expect(extractSpans(`${open} {id: 1}}}`)).toEqual([{ kind: "expression", source: " {id: 1}", offset: 0 }]);
    expect(extractSpans(`${open} {a: {b: 1}}}}`)).toEqual([{ kind: "expression", source: " {a: {b: 1}}", offset: 0 }]);
  });

  it("an unclosed string falls back to the first }}", () => {
    const open = "$" + "{{";
    expect(extractSpans(`${open} "abc }}`)).toEqual([{ kind: "expression", source: ' "abc ', offset: 0 }]);
  });

  it("an unclosed object brace is an unterminated span", () => {
    expect(() => extractSpans("${{ {id: 1 }}")).toThrow(/Unterminated expression span/);
  });

  it("parseTemplate scans the same way", () => {
    const open = "$" + "{{";
    expect(parseTemplate(`a ${open} "}}" }} b ${open} {id: 1}}}`)).toEqual([
      { kind: "literal", text: "a " },
      { kind: "expression", source: ' "}}" ', offset: 2 },
      { kind: "literal", text: " b " },
      { kind: "expression", source: " {id: 1}", offset: 16 },
    ]);
  });

  it("throws on unterminated span", () => {
    expect(() => extractSpans("Hello ${{ unterminated")).toThrow(/Unterminated/);
  });

  it("offset reflects position of ${{ in template", () => {
    const spans = extractSpans("prefix${{ expr }}");
    const expr = spans.find((s) => s.kind === "expression");
    expect(expr).toMatchObject({ kind: "expression", offset: 6 });
  });

  it("pure expression mode — single span no surrounding text", () => {
    const spans = extractSpans("${{ enabled }}");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ kind: "expression", source: " enabled " });
  });
});

// ---------------------------------------------------------------------------
// parseTemplate()
// ---------------------------------------------------------------------------

describe("parseTemplate() — flat template (no blocks)", () => {
  it("plain text only produces a single literal node", () => {
    const nodes = parseTemplate("hello world");
    expect(nodes).toEqual([{ kind: "literal", text: "hello world" }]);
  });

  it("empty string produces no nodes", () => {
    expect(parseTemplate("")).toEqual([]);
  });

  it("single expression span matches extractSpans output", () => {
    const nodes = parseTemplate("${{ name }}");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "expression", source: " name ", offset: 0 });
  });

  it("mixed literal + expression mirrors extractSpans", () => {
    const nodes = parseTemplate("Hello ${{ name }}!");
    expect(nodes).toEqual([
      { kind: "literal", text: "Hello " },
      { kind: "expression", source: " name ", offset: 6 },
      { kind: "literal", text: "!" },
    ]);
  });

  it("$\\{{ escape produces literal ${{ (mirrors extractSpans)", () => {
    const nodes = parseTemplate(String.raw`before $\{{ after`);
    expect(nodes).toEqual([{ kind: "literal", text: "before ${{ after" }]);
  });

  it("$\\{% escape produces literal ${%", () => {
    const nodes = parseTemplate(String.raw`before $\{% after`);
    expect(nodes).toEqual([{ kind: "literal", text: "before ${% after" }]);
  });

  it("throws on unterminated expression span", () => {
    expect(() => parseTemplate("${{ unclosed")).toThrow(/Unterminated expression span/);
  });
});

describe("parseTemplate() — if tag", () => {
  it("if-only: true body captured, no else", () => {
    const nodes = parseTemplate("${% if show %}yes${% endif %}");
    expect(nodes).toHaveLength(1);
    const ifNode = nodes[0];
    expect(ifNode.kind).toBe("if");
    if (ifNode.kind !== "if") return;
    expect(ifNode.condition).toBe("show");
    expect(ifNode.consequent).toEqual([{ kind: "literal", text: "yes" }]);
    expect(ifNode.elseifs).toEqual([]);
    expect(ifNode.alternate).toBeNull();
  });

  it("if–else: both branches captured", () => {
    const nodes = parseTemplate("${% if x %}A${% else %}B${% endif %}");
    expect(nodes).toHaveLength(1);
    const ifNode = nodes[0];
    expect(ifNode.kind).toBe("if");
    if (ifNode.kind !== "if") return;
    expect(ifNode.consequent).toEqual([{ kind: "literal", text: "A" }]);
    expect(ifNode.alternate).toEqual([{ kind: "literal", text: "B" }]);
  });

  it("if–elif–else: all three branches captured", () => {
    const nodes = parseTemplate("${% if a %}A${% elif b %}B${% else %}C${% endif %}");
    expect(nodes).toHaveLength(1);
    const ifNode = nodes[0];
    expect(ifNode.kind).toBe("if");
    if (ifNode.kind !== "if") return;
    expect(ifNode.consequent).toEqual([{ kind: "literal", text: "A" }]);
    expect(ifNode.elseifs).toHaveLength(1);
    expect(ifNode.elseifs[0]).toMatchObject({ condition: "b" });
    expect(ifNode.elseifs[0].body).toEqual([{ kind: "literal", text: "B" }]);
    expect(ifNode.alternate).toEqual([{ kind: "literal", text: "C" }]);
  });

  it("conditionOffset points to the condition expression in the template", () => {
    // "${% if show %}..." — "show" starts at offset 7 (after "${% if ")
    const nodes = parseTemplate("${% if show %}yes${% endif %}");
    const ifNode = nodes[0];
    if (ifNode.kind !== "if") return;
    expect(ifNode.conditionOffset).toBe(7); // "${% if " is 7 chars
  });

  it("if body can contain expression spans", () => {
    const nodes = parseTemplate("${% if ok %}${{ value }}${% endif %}");
    const ifNode = nodes[0];
    if (ifNode.kind !== "if") return;
    expect(ifNode.consequent).toHaveLength(1);
    expect(ifNode.consequent[0]).toMatchObject({ kind: "expression", source: " value " });
  });

  it("throws on unterminated if block", () => {
    expect(() => parseTemplate("${% if x %}body")).toThrow(/Unterminated 'if' block/);
  });

  it("throws on empty block tag", () => {
    expect(() => parseTemplate("${% %}")).toThrow(/Empty block tag/);
  });

  it("throws on unterminated elif branch (no endif after elif)", () => {
    expect(() => parseTemplate("${% if cond %}body${% elif cond2 %}elif_body")).toThrow(/Unterminated 'if' block/);
  });

  it("throws on unterminated else branch (no endif after else)", () => {
    expect(() => parseTemplate("${% if cond %}body${% else %}else_body")).toThrow(/Unterminated 'if' block/);
  });

  it("throws on unexpected elif/else/endif at top level", () => {
    expect(() => parseTemplate("${% endif %}")).toThrow(/Unexpected 'endif'/);
    expect(() => parseTemplate("${% else %}")).toThrow(/Unexpected 'else'/);
    expect(() => parseTemplate("${% elif x %}")).toThrow(/Unexpected 'elif'/);
  });
});

describe("parseTemplate() — for tag", () => {
  it("parses loop variable, iterable, and body correctly", () => {
    const nodes = parseTemplate("${% for item in items %}[${{ item }}]${% endfor %}");
    expect(nodes).toHaveLength(1);
    const forNode = nodes[0];
    expect(forNode.kind).toBe("for");
    if (forNode.kind !== "for") return;
    expect(forNode.variable).toBe("item");
    expect(forNode.iterable).toBe("items");
    expect(forNode.body).toMatchObject([
      { kind: "literal", text: "[" },
      { kind: "expression", source: " item " },
      { kind: "literal", text: "]" },
    ]);
  });

  it("iterableOffset points to the iterable expression in the template", () => {
    // "${% for x in items %}" — "items" starts at 14 (after "${% for x in ")
    const nodes = parseTemplate("${% for x in items %}${% endfor %}");
    const forNode = nodes[0];
    if (forNode.kind !== "for") return;
    // "${% for x in " = 13 chars: $,{,%,' ',f,o,r,' ',x,' ',i,n,' '
    expect(forNode.iterableOffset).toBe(13);
  });

  it("for over empty body is valid", () => {
    const nodes = parseTemplate("${% for x in list %}${% endfor %}");
    const forNode = nodes[0];
    if (forNode.kind !== "for") return;
    expect(forNode.body).toEqual([]);
  });

  it("throws on unterminated for block", () => {
    expect(() => parseTemplate("${% for x in items %}body")).toThrow(/Unterminated 'for' block/);
  });

  it("throws on for without 'in' keyword", () => {
    expect(() => parseTemplate("${% for x items %}${% endfor %}")).toThrow(
      /Expected 'in' after loop variable/,
    );
  });

  it("throws on empty iterable expression in for tag", () => {
    expect(() => parseTemplate("${% for x in %}${% endfor %}")).toThrow(/Expected an iterable expression/);
  });

  it("throws on non-identifier loop variable", () => {
    expect(() => parseTemplate("${% for 1x in items %}${% endfor %}")).toThrow(
      /Expected an identifier for loop variable/,
    );
  });

  it("throws on unexpected endfor at top level", () => {
    expect(() => parseTemplate("${% endfor %}")).toThrow(/Unexpected 'endfor'/);
  });
});

describe("parseTemplate() — nested blocks", () => {
  it("for inside if: parsed as nested structure", () => {
    const template = "${% if show %}${% for x in list %}${{ x }}${% endfor %}${% endif %}";
    const nodes = parseTemplate(template);
    expect(nodes).toHaveLength(1);
    const ifNode = nodes[0];
    if (ifNode.kind !== "if") return;
    expect(ifNode.consequent).toHaveLength(1);
    expect(ifNode.consequent[0].kind).toBe("for");
  });

  it("if inside for: parsed as nested structure", () => {
    const template = "${% for x in list %}${% if x %}yes${% endif %}${% endfor %}";
    const nodes = parseTemplate(template);
    expect(nodes).toHaveLength(1);
    const forNode = nodes[0];
    if (forNode.kind !== "for") return;
    expect(forNode.body).toHaveLength(1);
    expect(forNode.body[0].kind).toBe("if");
  });
});

describe("parseTemplate() — unknown tag", () => {
  it("throws on unknown tag names", () => {
    expect(() => parseTemplate("${% macro foo %}${% endmacro %}")).toThrow(
      /Unknown tag 'macro'/,
    );
  });
});

describe("parseTemplate() — literal text before a block tag", () => {
  it("emits accumulated literal text before an if block as a preceding node", () => {
    // The literal "prefix " must be flushed to nodes before the if block is parsed.
    // This covers the `nodes.push({ kind: 'literal', text: literal })` + `literal = ""`
    // path that fires when a block tag is encountered mid-template.
    const nodes = parseTemplate("prefix ${% if x %}body${% endif %}");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ kind: "literal", text: "prefix " });
    expect(nodes[1].kind).toBe("if");
  });

  it("emits accumulated literal text before a for block", () => {
    const nodes = parseTemplate("start: ${% for x in items %}${{ x }}${% endfor %}");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ kind: "literal", text: "start: " });
    expect(nodes[1].kind).toBe("for");
  });
});

describe("parseTemplate() — unterminated block tag", () => {
  it("throws when a block tag has no closing %}", () => {
    expect(() => parseTemplate("${% if x")).toThrow(/Unterminated block tag/);
  });
});
