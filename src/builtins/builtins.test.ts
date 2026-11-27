import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEngine } from "../engine/engine.js";
import { ExpressionError } from "../engine/types.js";
import { resolve, type Value } from "../evaluator/types.js";

// Helper to evaluate synchronously via the engine
const eng = createEngine({ timeoutMs: 5000 });
/** Lenient reading (a missing name is null) and 1/0 = Infinity, for the tests that mean them. */
const infEng = createEngine({ timeoutMs: 5000, divisionByZero: "infinity" });
const lenientEng = createEngine({ timeoutMs: 5000, strict: false });
async function ev(expr: string, ctx: Record<string, unknown> = {}) {
  return eng.evaluate(expr, ctx as never);
}
async function throws(expr: string, ctx: Record<string, unknown> = {}) {
  await expect(ev(expr, ctx)).rejects.toBeInstanceOf(ExpressionError);
}

// ── str() ─────────────────────────────────────────────────────────────────────

describe("str()", () => {
  it("passes strings through", async () => {
    expect(await ev('str("hello")')).toBe("hello");
  });
  it("converts finite numbers to decimal strings", async () => {
    expect(await ev("str(42)")).toBe("42");
    expect(await ev("str(3.14)")).toBe("3.14");
    expect(await ev("str(-0.5)")).toBe("-0.5");
  });
  it("converts boolean to string", async () => {
    expect(await ev("str(true)")).toBe("true");
    expect(await ev("str(false)")).toBe("false");
  });
  it("converts null to empty string", async () => {
    expect(await ev("str(null)")).toBe("");
  });
  it("throws on NaN", async () => await throws("str(0/0)"));
  it("throws on Infinity", async () => await throws("str(1/0)"));
  it("throws on array", async () => await throws("str([1,2])"));
  it("throws on object", async () => await throws('str({"a":1})'));
});

// ── num() ─────────────────────────────────────────────────────────────────────

describe("num()", () => {
  it("passes finite numbers through", async () => {
    expect(await ev("num(42)")).toBe(42);
    expect(await ev("num(-3.5)")).toBe(-3.5);
  });
  it("parses numeric strings", async () => {
    expect(await ev('num("42")')).toBe(42);
    expect(await ev('num("-3.5")')).toBe(-3.5);
    expect(await ev('num("0")')).toBe(0);
  });
  it("throws on NaN input", async () => await throws("num(0/0)"));
  it("throws on Infinity input", async () => await throws("num(1/0)"));
  it("throws on non-numeric string", async () => await throws('num("abc")'));
  it("throws on empty string", async () => await throws('num("")'));
  it("throws on boolean", async () => await throws("num(true)"));
  it("throws on null", async () => await throws("num(null)"));
});

// ── bool() ─────────────────────────────────────────────────────────

describe("bool()", () => {
  it("passes booleans through", async () => {
    expect(await ev("bool(true)")).toBe(true);
    expect(await ev("bool(false)")).toBe(false);
  });
  it("parses 'true'/'false' case-insensitively", async () => {
    expect(await ev('bool("true")')).toBe(true);
    expect(await ev('bool("TRUE")')).toBe(true);
    expect(await ev('bool("False")')).toBe(false);
  });
  it("throws on any other string", async () => await throws('bool("yes")'));
  it("throws on number", async () => await throws("bool(0)"));
  it("throws on null", async () => await throws("bool(null)"));
  it("toBool no longer exists", async () => await throws('toBool("true")'));
});

// ── type() ───────────────────────────────────────────────────────────────────

describe("type()", () => {
  it('returns "string"', async () => {
    expect(await ev('type("hi")')).toBe("string");
  });
  it('returns "number"', async () => {
    expect(await ev("type(42)")).toBe("number");
  });
  it('returns "boolean"', async () => {
    expect(await ev("type(true)")).toBe("boolean");
  });
  it('returns "null"', async () => {
    expect(await ev("type(null)")).toBe("null");
  });
  it('returns "array"', async () => {
    expect(await ev("type([1,2])")).toBe("array");
  });
  it('returns "object"', async () => {
    expect(await ev('type({"a":1})')).toBe("object");
  });
  it("works in conditional dispatch", async () => {
    expect(await ev('type(v) == "array" ? "yes" : "no"', { v: [1, 2, 3] })).toBe("yes");
  });
});

// ── parseBool() ───────────────────────────────────────────────────────────────

describe("parseBool()", () => {
  it("passes booleans through", async () => {
    expect(await ev("parseBool(true)")).toBe(true);
    expect(await ev("parseBool(false)")).toBe(false);
  });
  it("parses true/false strings any case", async () => {
    expect(await ev('parseBool("TRUE")')).toBe(true);
    expect(await ev('parseBool("False")')).toBe(false);
  });
  it("parses yes/no strings any case", async () => {
    expect(await ev('parseBool("yes")')).toBe(true);
    expect(await ev('parseBool("NO")')).toBe(false);
  });
  it('parses "1"/"0"', async () => {
    expect(await ev('parseBool("1")')).toBe(true);
    expect(await ev('parseBool("0")')).toBe(false);
  });
  it("number 0 is false", async () => {
    expect(await ev("parseBool(0)")).toBe(false);
  });
  it("non-zero number is true", async () => {
    expect(await ev("parseBool(42)")).toBe(true);
    expect(await ev("parseBool(-1)")).toBe(true);
  });
  it("null is false", async () => {
    expect(await ev("parseBool(null)")).toBe(false);
  });
  it("throws on unrecognised string", async () => await throws('parseBool("maybe")'));
  it("throws on array", async () => await throws("parseBool([])"));
  it("throws on object", async () => await throws('parseBool({"a":1})'));
  it("throws on non-finite number (Infinity)", async () => await throws("parseBool(1/0)"));
  it("throws on non-finite number (NaN)", async () => await throws("parseBool(0/0)"));
});

// ── parseInteger() ────────────────────────────────────────────────────────────

describe("parseInteger()", () => {
  it("passes integer numbers through", async () => {
    expect(await ev("parseInteger(42)")).toBe(42);
  });
  it("truncates non-integer finite numbers", async () => {
    expect(await ev("parseInteger(3.7)")).toBe(3);
    expect(await ev("parseInteger(-3.7)")).toBe(-3);
  });
  it("parses whole-number strings", async () => {
    expect(await ev('parseInteger("42")')).toBe(42);
    expect(await ev('parseInteger("-7")')).toBe(-7);
  });
  it("throws on decimal string", async () => await throws('parseInteger("3.5")'));
  it("throws on null", async () => await throws("parseInteger(null)"));
  it("throws on boolean", async () => await throws("parseInteger(true)"));
  it("throws on non-numeric string", async () => await throws('parseInteger("abc")'));
  it("throws on array", async () => await throws("parseInteger([1,2])"));
  it("throws on object", async () => await throws('parseInteger({"a":1})'));
  it("throws on non-finite number (Infinity)", async () => await throws("parseInteger(1/0)"));
});

// ── parseFloat() ─────────────────────────────────────────────────────────────

describe("parseFloat()", () => {
  it("passes finite numbers through", async () => {
    expect(await ev("parseFloat(3.14)")).toBe(3.14);
  });
  it("parses float strings", async () => {
    expect(await ev('parseFloat("3.14")')).toBe(3.14);
    expect(await ev('parseFloat("42")')).toBe(42);
    expect(await ev('parseFloat("1.5e2")')).toBe(150);
  });
  it("throws on non-numeric string", async () => await throws('parseFloat("abc")'));
  it("throws on null", async () => await throws("parseFloat(null)"));
  it("throws on boolean", async () => await throws("parseFloat(true)"));
  it("throws on array", async () => await throws("parseFloat([1,2])"));
  it("throws on object", async () => await throws('parseFloat({"a":1})'));
  it("throws on non-finite number (Infinity)", async () => await throws("parseFloat(1/0)"));
});

// ── default() ────────────────────────────────────────────────────────────────

describe("default()", () => {
  it("returns value when not null", async () => {
    expect(await ev("default(v, 99)", { v: 42 })).toBe(42);
  });
  it("returns fallback on null", async () => {
    expect(await ev("default(null, 99)")).toBe(99);
  });
  it("preserves 0 and false", async () => {
    expect(await ev("default(0, 99)")).toBe(0);
    expect(await ev("default(false, true)")).toBe(false);
  });
  it("works via pipe", async () => {
    expect(await ev('v | default("gpt-4.1")', { v: null })).toBe("gpt-4.1");
    expect(await ev('v | default("gpt-4.1")', { v: "my-model" })).toBe("my-model");
  });
});

// ── coalesce() ───────────────────────────────────────────────────────────────

describe("coalesce()", () => {
  it("returns first non-null", async () => {
    expect(await ev("coalesce(null, null, 3)")).toBe(3);
  });
  it("returns first arg when it is non-null", async () => {
    expect(await ev('coalesce("a", "b", "c")')).toBe("a");
  });
  it("returns null when all null", async () => {
    expect(await ev("coalesce(null, null)")).toBe(null);
  });
  it("preserves 0 and false", async () => {
    expect(await ev("coalesce(null, 0, 1)")).toBe(0);
    expect(await ev("coalesce(null, false, true)")).toBe(false);
  });
});

// ── Arithmetic helpers ────────────────────────────────────────────────────────

describe("arithmetic helpers", () => {
  it("the Liquid arithmetic helpers no longer exist", async () => {
    for (const call of ["plus(3, 4)", "minus(10, 3)", "times(3, 4)", "dividedBy(10, 4)", "modulo(10, 3)"]) {
      await throws(call);
    }
  });
  it("toFixed returns string with correct decimal places", async () => {
    expect(await ev("toFixed(19.9, 2)")).toBe("19.90");
    expect(await ev("toFixed(1/3, 4)")).toBe("0.3333");
  });
  it("toFixed pipe form", async () => {
    expect(await ev("price | toFixed(2)", { price: 19.9 })).toBe("19.90");
  });
  it("toFixed throws on non-number value", async () => await throws('toFixed("x", 2)'));
  it("toFixed throws on negative digits", async () => await throws("toFixed(1.5, -1)"));
});

// ── includes / startsWith / endsWith ─────────────────────────────────────────

describe("includes / startsWith / endsWith", () => {
  it("includes", async () => {
    expect(await ev('includes("hello world", "world")')).toBe(true);
    expect(await ev('includes("hello", "xyz")')).toBe(false);
  });
  it("startsWith", async () => {
    expect(await ev('startsWith("hello", "hel")')).toBe(true);
    expect(await ev('startsWith("hello", "ell")')).toBe(false);
  });
  it("endsWith", async () => {
    expect(await ev('endsWith("hello", "llo")')).toBe(true);
    expect(await ev('endsWith("hello", "hel")')).toBe(false);
  });
  it("throws on non-string value", async () => {
    await throws("includes(42, 4)");
  });
  it("throws on non-string substr (number)", async () => {
    await throws('includes("hello", 42)');
  });
  it("throws on non-string substr (null)", async () => {
    await throws('includes("hello", null)');
  });
  it("throws on null value", async () => {
    await throws('includes(null, "x")');
  });
});

// ── split() ───────────────────────────────────────────────────────────────────

describe("split()", () => {
  it("splits on delimiter", async () => {
    expect(await ev('split("a:b:c", ":")')).toEqual(["a", "b", "c"]);
  });
  it("returns individual characters for empty delimiter", async () => {
    expect(await ev('split("hello", "")')).toEqual(["h", "e", "l", "l", "o"]);
  });
  it("returns empty array for empty string", async () => {
    expect(await ev('split("", ":")')).toEqual([]);
  });
  it("returns single-element array when delimiter not found", async () => {
    expect(await ev('split("hello", ":")')).toEqual(["hello"]);
  });
  it("pipe form", async () => {
    expect(await ev('"a:b:c" | split(":")')).toEqual(["a", "b", "c"]);
  });
});

// ── case / whitespace ─────────────────────────────────────────────────────────

describe("case and whitespace", () => {
  it("toUpperCase", async () => {
    expect(await ev('toUpperCase("hello")')).toBe("HELLO");
    await throws('upcase("hello")');
  });
  it("toLowerCase", async () => {
    expect(await ev('toLowerCase("HELLO")')).toBe("hello");
    await throws('downcase("HELLO")');
  });
  it("trim", async () => {
    expect(await ev('trim("  hi  ")')).toBe("hi");
  });
  it("trimStart", async () => {
    expect(await ev('trimStart("  hi  ")')).toBe("hi  ");
  });
  it("trimEnd", async () => {
    expect(await ev('trimEnd("  hi  ")')).toBe("  hi");
  });
  it("squish collapses whitespace runs and trims", async () => {
    expect(await ev('squish("  hello   world  ")')).toBe("hello world");
  });
  it("squish with tabs and newlines", async () => {
    expect(await ev(String.raw`squish("a\t\tb\n\nc")`)).toBe("a b c");
  });
  it(String.raw`stripNewlines removes \n and \r\n`, async () => {
    expect(await ev(String.raw`stripNewlines("a\nb\nc")`)).toBe("abc");
  });
});

// ── pad ───────────────────────────────────────────────────────────────────────

describe("padStart / padEnd", () => {
  it("padStart with explicit fill", async () => {
    expect(await ev('padStart("42", 5, "0")')).toBe("00042");
  });
  it("padStart default fill is space", async () => {
    expect(await ev('padStart("hi", 5)')).toBe("   hi");
  });
  it("padEnd with explicit fill", async () => {
    expect(await ev('padEnd("hi", 5, ".")')).toBe("hi...");
  });
  it("padEnd default fill is space", async () => {
    expect(await ev('padEnd("hi", 5)')).toBe("hi   ");
  });
  it("padStart throws on non-number length (string)", async () => await throws('padStart("x", "5")'));
  it("padStart throws on null length", async () => await throws('padStart("x", null)'));
  it("padEnd throws on non-number length (string)", async () => await throws('padEnd("hi", "5")'));
  it("padEnd throws on null length", async () => await throws('padEnd("hi", null)'));
});

// ── substring / left / right ─────────────────────────────────────────────────

describe("substring / left / right", () => {
  it("substring takes start and optional end", async () => {
    expect(await ev('substring("hello world", 6)')).toBe("world");
    expect(await ev('substring("hello world", 0, 5)')).toBe("hello");
    expect(await ev('substring("hello", 1, 1)')).toBe("");
  });
  it("substring works as a pipe step", async () => {
    expect(await ev('"hello" | substring(1, 3)')).toBe("el");
    expect(await ev('"hello" | left(2) | right(1)')).toBe("e");
  });
  it("substring counts a negative index from the end", async () => {
    expect(await ev('substring("hello", -3)')).toBe("llo");
    expect(await ev('substring("hello", -3, -1)')).toBe("ll");
    expect(await ev('substring("hello", 0, -1)')).toBe("hell");
    expect(await ev('substring("hello", -99, 2)')).toBe("he");
  });
  it("substring returns an empty string out of range", async () => {
    expect(await ev('substring("hello", 9)')).toBe("");
    expect(await ev('substring("hello", 3, 1)')).toBe("");
    expect(await ev('substring("hello", 0, 99)')).toBe("hello");
    expect(await ev('substring("", 0, 3)')).toBe("");
  });
  it("substring truncates non-integers and treats null as the default", async () => {
    expect(await ev('substring("hello", 1.9, 3.9)')).toBe("el");
    expect(await ev('substring("hello", null, 2)')).toBe("he");
    expect(await ev('substring("hello", 1, null)')).toBe("ello");
  });
  it("substring treats NaN as the first index", async () => {
    expect(await ev('substring("hello", start, 2)', { start: Number.NaN })).toBe("he");
  });
  it("substring handles Cyrillic", async () => {
    expect(await ev('substring("Привет, мир", 0, 6)')).toBe("Привет");
    expect(await ev('"Привет, мир" | right(3)')).toBe("мир");
    expect(await ev('"Привет" | left(3)')).toBe("При");
  });
  it("substring, left and right never split a surrogate pair", async () => {
    expect(await ev('substring("a😀b", 0, 2)')).toBe("a");
    expect(await ev('substring("a😀b", 2)')).toBe("b");
    expect(await ev('substring("a😀b", 1, 3)')).toBe("😀");
    expect(await ev('substring("a😀b", 1, 2)')).toBe("");
    expect(await ev('left("a😀b", 2)')).toBe("a");
    expect(await ev('left("a😀b", 3)')).toBe("a😀");
    expect(await ev('right("a😀b", 2)')).toBe("b");
    expect(await ev('right("a😀b", 3)')).toBe("😀b");
    expect(await ev('right("😀", 1)')).toBe("");
  });
  it("left and right take the first and the last n characters", async () => {
    expect(await ev('left("hello", 3)')).toBe("hel");
    expect(await ev('right("hello", 3)')).toBe("llo");
    expect(await ev('"hello" | left(3)')).toBe("hel");
    expect(await ev('"hello" | right(3)')).toBe("llo");
    expect(await ev('left("hello", 3.9)')).toBe("hel");
  });
  it("left and right clamp and give empty for a non-positive n", async () => {
    expect(await ev('left("hi", 10)')).toBe("hi");
    expect(await ev('right("hi", 10)')).toBe("hi");
    expect(await ev('left("hi", 0)')).toBe("");
    expect(await ev('right("hi", 0)')).toBe("");
    expect(await ev('left("hi", -1)')).toBe("");
    expect(await ev('right("hi", -1)')).toBe("");
    expect(await ev('left("", 3)')).toBe("");
    expect(await ev('right("", 3)')).toBe("");
  });
  it("left and right treat NaN as zero", async () => {
    expect(await ev('left("hello", count)', { count: Number.NaN })).toBe("");
    expect(await ev('right("hello", count)', { count: Number.NaN })).toBe("");
  });
  it("throws on a non-string subject", async () => {
    for (const expr of ["substring(1, 0)", "substring(null, 1)", "left(5, 1)", "left(null, 1)", "right(true, 1)", "right([1], 1)"]) {
      await throws(expr);
    }
    await expect(ev("left(5, 1)")).rejects.toThrow("left() requires a string, got number");
    await expect(ev("substring(null, 1)")).rejects.toThrow("substring() requires a string, got null");
  });
  it("throws on a non-number index", async () => {
    await throws('substring("hello", "1")');
    await throws('substring("hello", 1, "2")');
    await throws('left("hello", "2")');
    await throws('left("hello", null)');
    await throws('right("hello", "2")');
    await throws('right("hello", null)');
    await expect(ev('substring("hello", "1")')).rejects.toThrow("substring() requires a number for start, got string");
    await expect(ev('right("hello", null)')).rejects.toThrow("right() requires a number, got null");
  });
});

// ── replace / replaceAll / remove / append / truncate / indent ────────────────

describe("replace / replaceAll / remove / append / truncate / indent", () => {
  it("replace replaces first occurrence", async () => {
    expect(await ev('replace("aabbcc", "b", "x")')).toBe("aaxbcc");
  });
  it("replaceAll replaces all occurrences", async () => {
    expect(await ev('replaceAll("aabbcc", "b", "x")')).toBe("aaxxcc");
  });
  it("remove removes all occurrences", async () => {
    expect(await ev('remove("aabbcc", "b")')).toBe("aacc");
  });
  it("append concatenates", async () => {
    expect(await ev('append("hello", " world")')).toBe("hello world");
  });
  it("truncate limits length", async () => {
    expect(await ev('truncate("hello world", 5)')).toBe("hello");
  });
  it("truncate on string shorter than n returns full string", async () => {
    expect(await ev('truncate("hi", 10)')).toBe("hi");
  });
  // A cut inside a surrogate pair used to return a lone surrogate: "\ud83d"
  // alone is ill-formed Unicode, and jsonb rejects it as a JSON string.
  it("truncate does not split a surrogate pair", async () => {
    expect(await ev('truncate("a😀b", 2)')).toBe("a");
    expect(await ev('truncate("a😀b", 3)')).toBe("a😀");
    expect(await ev('truncate("😀", 1)')).toBe("");
    expect(await ev('truncate("😀😀😀", 5)')).toBe("😀😀");
  });
  it("truncate with a negative n does not split a surrogate pair either", async () => {
    expect(await ev('truncate("a😀", -1)')).toBe("a");
  });
  it("indent prepends spaces to each line", async () => {
    expect(await ev(String.raw`indent("a\nb", 2)`)).toBe("  a\n  b");
  });
  it("indent with 0 does nothing", async () => {
    expect(await ev(String.raw`indent("a\nb", 0)`)).toBe("a\nb");
  });
  it("truncate throws on non-number n (string)", async () => await throws('truncate("hello", "5")'));
  it("truncate throws on null n", async () => await throws('truncate("hello", null)'));
  it("indent throws on non-number n (string)", async () => await throws('indent("hi", "2")'));
  it("indent throws on null n", async () => await throws('indent("hi", null)'));
});

// ── matches() ────────────────────────────────────────────────────────────────

describe("matches()", () => {
  it("returns true on matching pattern", async () => {
    expect(await ev('matches("user@example.com", "[^@]+@[^@]+")')).toBe(true);
  });
  it("returns false on non-matching pattern", async () => {
    expect(await ev(String.raw`matches("hello", "^\\d+$")`)).toBe(false);
  });
  it("throws on invalid RE2 pattern", async () => {
    await throws('matches("x", "(?P<invalid")');
  });
  it("rejects catastrophically backtracking pattern in native mode", async () => {
    const longStr = "a".repeat(30);
    const engine = createEngine({ timeoutMs: 2000, regex: "native" });
    // safe-regex2 detects nested unbounded quantifiers and throws before execution
    await expect(
      engine.evaluate('matches(s, "(a+)+b")', { s: longStr }),
    ).rejects.toThrow("Potentially unsafe regular expression");
  });
  it("runs the same pattern in linear mode, without backtracking", async () => {
    expect(await ev('matches(s, "(a+)+b")', { s: "a".repeat(30) })).toBe(false);
  });
  it("throws on syntactically invalid but structurally safe pattern", async () => {
    // [z-a] passes safe-regex2 (no catastrophic backtracking) but new RegExp("[z-a]") throws
    await expect(createEngine({ regex: "native" }).evaluate('"abc" | matches("[z-a]")')).rejects.toThrow(/Invalid regular expression/);
    await throws('"abc" | matches("[z-a]")');
  });
});

describe("capture() and captures() in native mode", () => {
  const nativeEv = (expr: string) => createEngine({ regex: "native" }).evaluate(expr);
  it("return the groups, empty for a group that did not take part", async () => {
    expect(await nativeEv('capture("a", "(a)(b)?", 2)')).toBe("");
    expect(await nativeEv('capture("2024-01", "(\\d+)-(\\d+)", 2)')).toBe("01");
    expect(await nativeEv('capture("a", "(a)", 3)')).toBe("");
    expect(await nativeEv('capture("x", "(a)", 1)')).toBe("");
    expect(await nativeEv('captures("a", "(a)(b)?")')).toEqual(["a", ""]);
    expect(await nativeEv('captures("x", "(a)")')).toBeNull();
  });
});

// ── captures() ───────────────────────────────────────────────────────────────

describe("captures()", () => {
  it("returns every capture group of the first match", async () => {
    expect(await ev(String.raw`captures("2024-01-15", "(\d{4})-(\d{2})-(\d{2})")`)).toEqual([
      "2024",
      "01",
      "15",
    ]);
  });
  it("returns null when there is no match", async () => {
    expect(await ev(String.raw`captures("hello", "(\d+)")`)).toBeNull();
  });
  it("returns an empty array for a pattern without groups", async () => {
    expect(await ev('captures("abc", "b")')).toEqual([]);
  });
  it("returns \"\" for a group that did not take part", async () => {
    expect(await ev('captures("a", "(a)(b)?")')).toEqual(["a", ""]);
  });
  it("throws on an unsafe pattern in native mode", async () => {
    await expect(createEngine({ regex: "native" }).evaluate('captures("x", "(a+)+")')).rejects.toBeInstanceOf(ExpressionError);
  });
  it("throws on a non-string pattern", async () => {
    await throws('captures("x", 1)');
  });
});

// ── capture() ────────────────────────────────────────────────────────────────

describe("capture()", () => {
  it("returns the specified capture group", async () => {
    expect(
      await ev(String.raw`capture("2024-01-15", "(\d{4})-(\d{2})-(\d{2})", 1)`),
    ).toBe("2024");
    expect(
      await ev(String.raw`capture("2024-01-15", "(\d{4})-(\d{2})-(\d{2})", 2)`),
    ).toBe("01");
  });
  it("returns empty string when no match", async () => {
    expect(await ev(String.raw`capture("hello", "(\d+)", 1)`)).toBe("");
  });
  it("throws on invalid pattern", async () => {
    await throws('capture("x", "(?P<bad", 1)');
  });
  it("throws on non-number group", async () => {
    await throws('capture("x", ".(.).", "1")');
  });
  it("throws on null group", async () => {
    await throws('capture("x", ".(.).", null)');
  });
  it("returns empty string for out-of-range group", async () => {
    expect(await ev('capture("abc", "(a)(b)", 5)')).toBe("");
  });
  it("returns empty string for optional unmatched group", async () => {
    expect(await ev('capture("a", "(a)(b)?", 2)')).toBe("");
  });
});

// ── chunks() ─────────────────────────────────────────────────────────────────

describe("chunks()", () => {
  it("returns single-element array when string fits", async () => {
    expect(await ev('chunks("hello", 10)')).toEqual(["hello"]);
  });
  it("returns single-element array when string is exactly maxLen", async () => {
    expect(await ev('chunks("hello", 5)')).toEqual(["hello"]);
  });
  it("splits on double newline by default", async () => {
    expect(await ev(String.raw`chunks("aaa\n\nbbb", 5)`)).toEqual(["aaa", "bbb"]);
  });
  it("falls back to single newline when no double newline fits", async () => {
    // \n\n not found; \n at index 2 (last before limit 5-1=4), splits "aa" / "bb\ncc"
    expect(await ev(String.raw`chunks("aa\nbb\ncc", 5)`)).toEqual(["aa", "bb\ncc"]);
  });
  it("hard-splits when no separator fits within maxLen", async () => {
    expect(await ev('chunks("abcdef", 3)')).toEqual(["abc", "def"]);
  });
  it("hard-splits leaves remainder", async () => {
    expect(await ev('chunks("abcdefg", 3)')).toEqual(["abc", "def", "g"]);
  });
  it("uses custom separators in priority order", async () => {
    // separator ". " found at index 3 (last before limit 8-2=6), splits "aaa" / "bbb. ccc"
    expect(
      await ev('chunks("aaa. bbb. ccc", 8, [". "])'),
    ).toEqual(["aaa", "bbb. ccc"]);
  });
  it("custom separators — first separator wins over later", async () => {
    expect(
      await ev(String.raw`chunks("a\n\nb\nc", 5, ["\n\n", "\n"])`),
    ).toEqual(["a", "b\nc"]);
  });
  it("returns empty array for empty string", async () => {
    expect(await ev('chunks("", 10)')).toEqual([]);
  });
  it("pipe syntax works", async () => {
    expect(await ev(String.raw`"aaa\n\nbbb" | chunks(5)`)).toEqual(["aaa", "bbb"]);
  });
  it("throws on non-number maxLen", async () => await throws('chunks("x", "5")'));
  it("throws on null maxLen", async () => await throws('chunks("x", null)'));
  it("throws on zero maxLen", async () => await throws('chunks("x", 0)'));
  it("throws when separators is not an array", async () => await throws('chunks("x", 5, "\\n")'));
  it("throws when separators contains non-string", async () => await throws('chunks("x", 5, [1])'));
});

// ── Integration: builtins in expressions ─────────────────────────────────────

describe("builtins in expressions", () => {
  it("pipe chain with str and toUpperCase", async () => {
    expect(await ev("42 | str | toUpperCase")).toBe("42");
  });
  it("pipe chain: default then bool", async () => {
    expect(
      await ev('v | default("false") | bool', { v: null }),
    ).toBe(false);
  });
  it("arithmetic chain via pipe", async () => {
    expect(
      await ev("price / (lessons ?? 1) | toFixed(1)", { price: 100, lessons: 4 }),
    ).toBe("25.0");
  });
  it("str then parseInteger round-trip", async () => {
    expect(await ev("n | str | parseInteger", { n: 42 })).toBe(42);
  });
  it("toFixed result via evaluate", async () => {
    expect(await ev("price | toFixed(2)", { price: 19.9 })).toBe("19.90");
  });
  it("custom filter shadows builtin", async () => {
    const custom = createEngine({
      filters: { str: () => "OVERRIDDEN" },
    });
    expect(await custom.evaluate('str("x")')).toBe("OVERRIDDEN");
  });
});

// ── Collection builtins ──────────────────────────────────────────────────────

// ── size() ───────────────────────────────────────────────────────────────────

describe("size()", () => {
  it("returns array length", async () => {
    expect(await ev("size([1,2,3])")).toBe(3);
    expect(await ev("size([])")).toBe(0);
  });
  it("returns string length", async () => {
    expect(await ev('size("hello")')).toBe(5);
    expect(await ev('size("")')).toBe(0);
  });
  it("returns object key count", async () => {
    expect(await ev('size({"a":1,"b":2})')).toBe(2);
    expect(await ev("size({})")).toBe(0);
  });
  it("pipe form", async () => {
    expect(await ev("[1,2,3] | size")).toBe(3);
  });
  it("returns 0 for null", async () => {
    expect(await ev("size(null)")).toBe(0);
  });
  it("throws on number", async () => await throws("size(42)"));
  it("throws on boolean", async () => await throws("size(true)"));
});

// ── first() / last() ─────────────────────────────────────────────────────────

describe("first()", () => {
  it("returns first element", async () => {
    expect(await ev("first([10,20,30])")).toBe(10);
  });
  it("returns null for empty array", async () => {
    expect(await ev("first([])")).toBeNull();
  });
  it("throws on non-array", async () => await throws("first(42)"));
});

describe("last()", () => {
  it("returns last element", async () => {
    expect(await ev("last([10,20,30])")).toBe(30);
  });
  it("returns null for empty array", async () => {
    expect(await ev("last([])")).toBeNull();
  });
  it("throws on non-array", async () => await throws('last("oops")'));
});

// ── slice() ──────────────────────────────────────────────────────────────────

describe("slice()", () => {
  it("slices with from and to", async () => {
    expect(await ev("slice([1,2,3,4,5], 1, 3)")).toEqual([2, 3]);
  });
  it("slice from start when from is 0", async () => {
    expect(await ev("slice([1,2,3], 0, 2)")).toEqual([1, 2]);
  });
  it("slice to end when to is beyond length", async () => {
    expect(await ev("slice([1,2,3], 1, 99)")).toEqual([2, 3]);
  });
  it("pipe form", async () => {
    expect(await ev("[1,2,3,4,5] | slice(2, 4)")).toEqual([3, 4]);
  });
  it("returns empty for out-of-range", async () => {
    expect(await ev("slice([1,2,3], 5, 10)")).toEqual([]);
  });
  it("uses 0 as default from when omitted", async () => {
    expect(await ev("[1,2,3,4] | slice(null, 2)")).toEqual([1, 2]);
  });
  it("uses arr.length as default to when omitted", async () => {
    expect(await ev("[1,2,3,4] | slice(2, null)")).toEqual([3, 4]);
  });
  it("throws on non-array", async () => await throws("slice(42, 0, 1)"));
});

// ── chunk() ──────────────────────────────────────────────────────────────────

describe("chunk()", () => {
  it("splits into fixed-size chunks", async () => {
    expect(await ev("chunk([1,2,3,4,5], 2)")).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("chunk size equal to array length yields one chunk", async () => {
    expect(await ev("chunk([1,2,3], 3)")).toEqual([[1, 2, 3]]);
  });
  it("chunk size larger than array length yields one short chunk", async () => {
    expect(await ev("chunk([1,2,3], 10)")).toEqual([[1, 2, 3]]);
  });
  it("empty array yields empty array of chunks", async () => {
    expect(await ev("chunk([], 2)")).toEqual([]);
  });
  it("pipe form", async () => {
    expect(await ev("[1,2,3,4,5] | chunk(2)")).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("truncates a fractional size", async () => {
    expect(await ev("chunk([1,2,3,4], 2.9)")).toEqual([[1, 2], [3, 4]]);
  });
  it("throws on non-array", async () => await throws("chunk(42, 2)"));
  it("throws when size is missing", async () => await throws("chunk([1,2,3])"));
  it("throws when size is zero", async () => await throws("chunk([1,2,3], 0)"));
  it("throws when size is negative", async () => await throws("chunk([1,2,3], -1)"));
});

// ── reverse() ────────────────────────────────────────────────────────────────

describe("reverse()", () => {
  it("reverses an array", async () => {
    expect(await ev("reverse([1,2,3])")).toEqual([3, 2, 1]);
  });
  it("returns a new array (original unchanged)", async () => {
    expect(await ev("reverse([1,2,3])")).toEqual([3, 2, 1]);
  });
  it("empty array stays empty", async () => {
    expect(await ev("reverse([])")).toEqual([]);
  });
  it("throws on non-array", async () => await throws('reverse("no")'));
});

// ── join() ───────────────────────────────────────────────────────────────────

describe("join()", () => {
  it("joins with separator", async () => {
    expect(await ev('join(["a","b","c"], ",")')).toBe("a,b,c");
  });
  it("joins with multi-char separator", async () => {
    expect(await ev('join(["a","b"], " | ")')).toBe("a | b");
  });
  it("null elements become empty strings", async () => {
    expect(await ev('join([null,"b",null], ",")')).toBe(",b,");
  });
  it("pipe form", async () => {
    expect(await ev('["x","y"] | join("-")')).toBe("x-y");
  });
  it("empty array produces empty string", async () => {
    expect(await ev('join([], ",")')).toBe("");
  });
  it("uses comma as default separator when none provided", async () => {
    expect(await ev('join(["a","b","c"])')).toBe("a,b,c");
  });
  it("stringifies object elements as JSON", async () => {
    expect(await ev('join([{"a":1},"x"], ",")')).toBe('{"a":1},x');
  });
  it("throws on non-array", async () => await throws('join("nope", ",")'));
  it("throws when separator is not a string", async () => await throws("join([1,2], 42)"));
});

// ── concat() ─────────────────────────────────────────────────────────────────

describe("concat()", () => {
  it("concatenates two arrays", async () => {
    expect(await ev("concat([1,2],[3,4])")).toEqual([1, 2, 3, 4]);
  });
  it("empty arrays", async () => {
    expect(await ev("concat([],[1])")).toEqual([1]);
    expect(await ev("concat([1],[])")).toEqual([1]);
  });
  it("pipe form", async () => {
    expect(await ev("[1,2] | concat([3,4])")).toEqual([1, 2, 3, 4]);
  });
  it("throws on non-array first arg", async () => await throws("concat(42,[1])"));
  it("null second arg is treated as empty array (default param branch)", async () => {
    // `other ?? []` converts the default null to [] before ensureArray is called
    expect(await ev("[1,2] | concat(null)")).toEqual([1, 2]);
  });
});

// ── compact() ────────────────────────────────────────────────────────────────

describe("compact()", () => {
  it("removes null values", async () => {
    expect(await ev("compact([1, null, 2, null, 3])")).toEqual([1, 2, 3]);
  });
  it("returns same array when no nulls present", async () => {
    expect(await ev('compact(["a","b","c"])')).toEqual(["a", "b", "c"]);
  });
  it("returns empty array when all nulls", async () => {
    expect(await ev("compact([null, null])")).toEqual([]);
  });
  it("returns empty array unchanged", async () => {
    expect(await ev("compact([])")).toEqual([]);
  });
  it("preserves falsy non-null values (0, false, empty string)", async () => {
    expect(await ev('compact([0, false, "", null])')).toEqual([0, false, ""]);
  });
  it("pipe form", async () => {
    expect(await ev("[1, null, 2] | compact")).toEqual([1, 2]);
  });
  it("idiomatic nullable field composition", async () => {
    expect(
      await ev('let a = "x" in let b = null in let c = "z" in [a, b, c] | compact | join(" ")'),
    ).toBe("x z");
  });
  it("throws on non-array", async () => await throws("compact(42)"));
  it("throws on null", async () => await throws("compact(null)"));
});

// ── indexOf() ────────────────────────────────────────────────────────────────

describe("indexOf()", () => {
  it("finds element in array by strict equality", async () => {
    expect(await ev('indexOf(["a","b","c"], "b")')).toBe(1);
  });
  it("returns -1 when not found in array", async () => {
    expect(await ev("indexOf([1,2,3], 99)")).toBe(-1);
  });
  it("returns first occurrence index", async () => {
    expect(await ev("indexOf([1,2,1,3], 1)")).toBe(0);
  });
  it("finds substring in string", async () => {
    expect(await ev('indexOf("hello world", "world")')).toBe(6);
  });
  it("returns -1 for missing substring", async () => {
    expect(await ev('indexOf("hello", "xyz")')).toBe(-1);
  });
  it("pipe form on array", async () => {
    expect(await ev('["a","b","c"] | indexOf("c")')).toBe(2);
  });
  it("throws when string indexOf gets non-string needle (number)", async () => {
    await throws('indexOf("hello", 42)');
  });
  it("throws when string indexOf gets null needle", async () => {
    await throws('indexOf("hello", null)');
  });
  it("throws on non-array/non-string input", async () => await throws("indexOf(42, 1)"));
  it("throws on null input", async () => await throws("indexOf(null, 1)"));
});

// ── flatten() ────────────────────────────────────────────────────────────────

describe("flatten()", () => {
  it("flattens all levels by default", async () => {
    expect(await ev("flatten([[1,2],[3,[4,5]]])")).toEqual([1, 2, 3, 4, 5]);
  });
  it("flattens to specified depth", async () => {
    expect(await ev("flatten([[1,2],[3,[4,5]]], 1)")).toEqual([1, 2, 3, [4, 5]]);
  });
  it("depth 0 returns shallow copy", async () => {
    expect(await ev("flatten([[1,2],[3]], 0)")).toEqual([[1, 2], [3]]);
  });
  it("empty array stays empty", async () => {
    expect(await ev("flatten([])")).toEqual([]);
  });
  it("pipe form", async () => {
    expect(await ev("[[1],[2,3]] | flatten")).toEqual([1, 2, 3]);
  });
  it("throws when depth is not a number", async () => await throws('flatten([[1,2]], "deep")'));
  it("throws on non-array", async () => await throws("flatten(42)"));
});

// ── sort() natural order ──────────────────────────────────────────────────────

describe("sort()", () => {
  it("sorts numbers ascending", async () => {
    expect(await ev("sort([3,1,2])")).toEqual([1, 2, 3]);
  });
  it("sorts negative numbers", async () => {
    expect(await ev("sort([0,-1,5,-3])")).toEqual([-3, -1, 0, 5]);
  });
  it("sorts strings lexicographically", async () => {
    expect(await ev('sort(["banana","apple","cherry"])')).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
  });
  it("returns a new array", async () => {
    expect(await ev("sort([3,1,2])")).toEqual([1, 2, 3]);
  });
  it("empty array stays empty", async () => {
    expect(await ev("sort([])")).toEqual([]);
  });
  it("pipe form", async () => {
    expect(await ev("[3,1,2] | sort")).toEqual([1, 2, 3]);
  });
  it("handles equal numbers (stable — return 0 path)", async () => {
    expect(await ev("sort([2,2,1])")).toEqual([1, 2, 2]);
  });
  it("handles equal strings (return 0 path)", async () => {
    expect(await ev('sort(["b","a","b"])')).toEqual(["a", "b", "b"]);
  });
  it("sorts array containing null (null → 'null' string key)", async () => {
    const result = await ev("sort([1, null, 2])");
    expect(Array.isArray(result)).toBe(true);
  });
  it("sorts arrays containing objects using JSON key fallback", async () => {
    const result = await ev('sort([{"z":1},{"a":2}])');
    expect(Array.isArray(result)).toBe(true);
  });
  it("throws when fn argument is not callable", async () => {
    await throws('sort([1,2,3], "notAFn")');
  });
  it("throws on non-array", async () => await throws("sort(42)"));
});

// ── Higher-order built-ins given a non-function ──────────────────────────────

describe("map() — non-function argument", () => {
  it("throws when fn is not a function value", async () => {
    await throws('map([1,2,3], "str")');
  });
  it("throws when fn is an array", async () => await throws("map([1,2,3], [1,2])"));
  it("throws on non-array first arg (number)", async () => await throws("map(42, null)"));
  it("throws on null first arg", async () => await throws("map(null, null)"));
});

describe("filter() — non-function argument", () => {
  it("throws when fn is not a function value", async () => {
    await throws("filter([1,2], null)");
  });
});

describe("find() — non-function argument", () => {
  it("throws when fn is not a function value", async () => {
    await throws("find([1,2], null)");
  });
});

describe("some() — non-function argument", () => {
  it("throws when fn is not a function value", async () => {
    await throws("some([1,2], null)");
  });
});

describe("every() — non-function argument", () => {
  it("throws when fn is not a function value", async () => {
    await throws("every([1,2], null)");
  });
});

describe("reduce() — non-function argument", () => {
  it("throws when fn is not a function value", async () => {
    await throws("reduce([1,2,3], null, 0)");
  });
});

describe("flatMap() — non-function argument", () => {
  it("throws when fn is not a function value", async () => {
    await throws('flatMap([1,2], "str")');
  });
});

describe("uniqBy() — non-function argument", () => {
  it("throws when fn is not a function value", async () => {
    await throws("uniqBy([1,2], null)");
  });
});

describe("groupBy() — non-function argument", () => {
  it("throws when fn is not a function value", async () => {
    await throws("groupBy([1,2], null)");
  });
});

// ── maxIterations budget ──────────────────────────────────────────────────────

describe("maxIterations budget", () => {
  it("exhausted by sort over a large array", async () => {
    const small = createEngine({ maxIterations: 100 });
    const big = Array.from({ length: 101 }, (_, i) => i);
    await expect(
      small.evaluate("sort(arr)", { arr: big }),
    ).rejects.toBeInstanceOf(ExpressionError);
  });
  it("is cumulative — exhausted across concat chain", async () => {
    // Each concat charges a.length + b.length; chain of two concats
    const small = createEngine({ maxIterations: 10 });
    const a = [1, 2, 3, 4, 5, 6];
    await expect(
      small.evaluate("concat(concat(a, a), a)", { a }),
    ).rejects.toBeInstanceOf(ExpressionError);
  });
  it("passes within budget", async () => {
    const eng2 = createEngine({ maxIterations: 100 });
    expect(await eng2.evaluate("sort([3,1,2])")).toEqual([1, 2, 3]);
  });
});

// ── pick() ────────────────────────────────────────────────────────────────────

describe("pick()", () => {
  it("returns only the listed keys", async () => {
    expect(await ev('pick({"a":1,"b":2,"c":3}, "a", "c")')).toEqual({ a: 1, c: 3 });
  });
  it("ignores keys not in the object", async () => {
    expect(await ev('pick({"a":1}, "a", "missing")')).toEqual({ a: 1 });
  });
  it("returns empty object when no keys listed", async () => {
    expect(await ev('pick({"a":1})')).toEqual({});
  });
  it("throws on non-object input", async () => await throws('pick("str", "a")'));
  it("throws on null input", async () => await throws('pick(null, "a")'));
  it("throws on array input", async () => await throws('pick([1,2], "a")'));
});

// ── omit() ────────────────────────────────────────────────────────────────────

describe("omit()", () => {
  it("returns object without the listed keys", async () => {
    expect(await ev('omit({"a":1,"b":2,"c":3}, "b")')).toEqual({ a: 1, c: 3 });
  });
  it("ignores keys not in the object", async () => {
    expect(await ev('omit({"a":1,"b":2}, "missing")')).toEqual({ a: 1, b: 2 });
  });
  it("omits multiple keys", async () => {
    expect(await ev('omit({"a":1,"b":2,"c":3}, "a", "c")')).toEqual({ b: 2 });
  });
  it("returns full object when no keys listed", async () => {
    expect(await ev('omit({"a":1,"b":2})')).toEqual({ a: 1, b: 2 });
  });
  it("throws on non-object input", async () => await throws('omit(42, "a")'));
  it("throws on null input", async () => await throws('omit(null, "a")'));
});

// ── keys() ────────────────────────────────────────────────────────────────────

describe("keys()", () => {
  it("returns own enumerable keys", async () => {
    expect(await ev('keys({"a":1,"b":2})')).toEqual(["a", "b"]);
  });
  it("returns empty array for empty object", async () => {
    expect(await ev("keys({})")).toEqual([]);
  });
  it("throws on non-object", async () => await throws("keys(42)"));
  it("throws on null", async () => await throws("keys(null)"));
  it("throws on array", async () => await throws("keys([1,2])"));
});

// ── values() ──────────────────────────────────────────────────────────────────

describe("values()", () => {
  it("returns own enumerable values", async () => {
    expect(await ev('values({"a":1,"b":2})')).toEqual([1, 2]);
  });
  it("returns empty array for empty object", async () => {
    expect(await ev("values({})")).toEqual([]);
  });
  it("throws on non-object", async () => await throws("values(42)"));
  it("throws on null", async () => await throws("values(null)"));
});

// ── path() ────────────────────────────────────────────────────────────────────

describe("path()", () => {
  it("resolves a simple dotPath", async () => {
    expect(await ev('path(obj, "a")', { obj: { a: 42 } })).toBe(42);
  });
  it("resolves a nested dotPath", async () => {
    expect(await ev('path(obj, "a.b.c")', { obj: { a: { b: { c: 99 } } } })).toBe(99);
  });
  it("returns null for a missing key", async () => {
    expect(await ev('path(obj, "x.y")', { obj: { a: 1 } })).toBeNull();
  });
  it("returns null when intermediate value is not an object", async () => {
    expect(await ev('path(obj, "a.b")', { obj: { a: 42 } })).toBeNull();
  });
  it("throws on a reserved name segment", async () => {
    await throws('path(obj, "constructor.prototype")', { obj: {} });
  });
  it("throws on __proto__ segment", async () => {
    await throws('path(obj, "a.__proto__")', { obj: { a: {} } });
  });
  it("throws on non-object first argument", async () => {
    await throws('path(42, "a")');
  });
  it("throws on non-string dotPath (number)", async () => {
    await throws('path({}, 42)');
  });
  it("throws on null dotPath", async () => {
    await throws('path({}, null)');
  });
});

// ── json() ────────────────────────────────────────────────────────────────────

describe("json()", () => {
  it("serialises an object", async () => {
    expect(await ev('json({"a":1,"b":true})')).toBe('{"a":1,"b":true}');
  });
  it("serialises an array", async () => {
    expect(await ev("json([1,2,3])")).toBe("[1,2,3]");
  });
  it("serialises null", async () => {
    expect(await ev("json(null)")).toBe("null");
  });
  it("serialises a number", async () => {
    expect(await ev("json(42)")).toBe("42");
  });
  it("serialises a string", async () => {
    expect(await ev('json("hello")')).toBe('"hello"');
  });
  it("round-trips object through json", async () => {
    const obj = { x: 1, y: [2, 3] };
    const result = await ev("json(obj)", { obj });
    expect(JSON.parse(result as string)).toEqual(obj);
  });
});

// ── yaml() ────────────────────────────────────────────────────────────────────

describe("yaml()", () => {
  it("serialises an object to YAML", async () => {
    const result = await ev('yaml({"a":1,"b":true})');
    expect(result).toContain("a: 1");
    expect(result).toContain("b: true");
  });
  it("serialises an array to YAML", async () => {
    const result = await ev("yaml([1,2,3])");
    expect(result).toContain("- 1");
  });
  it("serialises null", async () => {
    const result = await ev("yaml(null)");
    expect(result).toContain("null");
  });
});

// ── btoa() / atob() ───────────────────────────────────────────────────────────

describe("btoa()", () => {
  it("encodes ASCII string to base64", async () => {
    expect(await ev('btoa("hello")')).toBe("aGVsbG8=");
  });
  it("throws on non-string", async () => await throws("btoa(42)"));
  it("throws on null", async () => await throws("btoa(null)"));
  it("throws on non-Latin-1 character", async () => await throws('btoa("€")'));
});

describe("atob()", () => {
  it("decodes base64 to string", async () => {
    expect(await ev('atob("aGVsbG8=")')).toBe("hello");
  });
  it("round-trips with btoa", async () => {
    expect(await ev('atob(btoa("world"))')).toBe("world");
  });
  it("throws on invalid base64", async () => await throws('atob("!!!")'));
  it("throws on non-string", async () => await throws("atob(42)"));
});

// ── base64urlEncode() ─────────────────────────────────────────────────────────

describe("base64urlEncode()", () => {
  it("encodes a plain string to base64url without padding", async () => {
    // "hello" in base64url = "aGVsbG8" (no padding, same chars as base64 for ASCII)
    expect(await ev('base64urlEncode("hello")')).toBe("aGVsbG8");
  });
  it("uses - and _ instead of + and /", async () => {
    // A string that would normally produce + or / in standard base64
    const result = await ev('base64urlEncode("Man")');
    expect(result).not.toMatch(/[+/]/);
  });
  it("encodes a 64-char hex string as its UTF-8 text, not as a digest", async () => {
    const hex = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(await ev(`base64urlEncode("${hex}")`)).toBe(Buffer.from(hex, "utf8").toString("base64url"));
  });
  it("encodes non-ASCII text as UTF-8", async () => {
    expect(await ev('base64urlEncode("Привет")')).toBe(Buffer.from("Привет", "utf8").toString("base64url"));
  });
  it("throws on non-string", async () => await throws("base64urlEncode(42)"));
});

// ── encodeURIComponent() / decodeURIComponent() ───────────────────────────────

describe("encodeURIComponent()", () => {
  it("percent-encodes a URI component", async () => {
    expect(await ev('encodeURIComponent("hello world")')).toBe("hello%20world");
  });
  it("encodes special chars", async () => {
    expect(await ev('encodeURIComponent("a=b&c=d")')).toBe("a%3Db%26c%3Dd");
  });
  it("throws on non-string", async () => await throws("encodeURIComponent(42)"));
});

describe("decodeURIComponent()", () => {
  it("decodes a percent-encoded string", async () => {
    expect(await ev('decodeURIComponent("hello%20world")')).toBe("hello world");
  });
  it("round-trips with encodeURIComponent", async () => {
    expect(await ev('decodeURIComponent(encodeURIComponent("a=b&c=d"))')).toBe("a=b&c=d");
  });
  it("throws on invalid percent-encoding", async () => await throws('decodeURIComponent("%ZZ")'));
  it("throws on non-string", async () => await throws("decodeURIComponent(42)"));
});

// ── sha256() ──────────────────────────────────────────────────────────────────

describe("sha256()", () => {
  it('produces correct hex digest for "abc"', async () => {
    // known sha256("abc") — verified against system shasum -a 256
    expect(await ev('sha256("abc")')).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it('produces correct hex digest for empty string', async () => {
    expect(await ev('sha256("")')).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it("returns lowercase hex", async () => {
    const result = await ev('sha256("test")');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
  it("throws on non-string", async () => await throws("sha256(42)"));
  it("throws on null", async () => await throws("sha256(null)"));
});

// ── hmacSha256() ─────────────────────────────────────────────────────────────

describe("hmacSha256()", () => {
  it("produces the known RFC-style vector for key/message", async () => {
    // verified against node crypto.createHmac("sha256", "key")
    expect(
      await ev(
        'hmacSha256("key", "The quick brown fox jumps over the lazy dog")',
      ),
    ).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
  it("handles empty key and empty message", async () => {
    expect(await ev('hmacSha256("", "")')).toBe(
      "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad",
    );
  });
  it("returns lowercase hex", async () => {
    expect(await ev('hmacSha256("k", "m")')).toMatch(/^[0-9a-f]{64}$/);
  });
  it("key order matters (not symmetric)", async () => {
    const a = await ev('hmacSha256("a", "b")');
    const b = await ev('hmacSha256("b", "a")');
    expect(a).not.toBe(b);
  });
  it("throws on non-string key", async () => await throws('hmacSha256(42, "m")'));
  it("throws on null key", async () => await throws('hmacSha256(null, "m")'));
  it("throws on non-string message", async () => await throws('hmacSha256("k", 42)'));
  it("throws on null message", async () => await throws('hmacSha256("k", null)'));
});

describe("timingSafeEqualHex()", () => {
  it("compares decoded hex bytes without case sensitivity", async () => {
    expect(await ev('timingSafeEqualHex("aB00", "Ab00")')).toBe(true);
    expect(await ev('timingSafeEqualHex("ab00", "ab01")')).toBe(false);
  });
  it("rejects malformed or differently sized input", async () => {
    for (const received of ['""', '"ab"', '"zz00"', '"ab0g"', '"ab0"']) {
      expect(await ev(`timingSafeEqualHex("ab00", ${received})`)).toBe(false);
    }
  });
  it("requires strings", async () => {
    await throws('timingSafeEqualHex(42, "ab")');
    await throws('timingSafeEqualHex("ab", null)');
  });
});

// ── uuid() ────────────────────────────────────────────────────────────────────

describe("uuid()", () => {
  it("returns a UUID v4 string", async () => {
    const result = await ev("uuid()");
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it("returns a different value each call", async () => {
    const a = await ev("uuid()");
    const b = await ev("uuid()");
    expect(a).not.toBe(b);
  });
});

// ── ulid() ───────────────────────────────────────────────────────────────────

describe("ulid()", () => {
  it("returns a 26-char Crockford base32 string", async () => {
    const result = await ev("ulid()") as string;
    expect(result).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
  it("returns a different value each call", async () => {
    const a = await ev("ulid()");
    const b = await ev("ulid()");
    expect(a).not.toBe(b);
  });
  it("is monotonically increasing across rapid successive calls", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push(await ev("ulid()") as string);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("encodes the current time in the 10-char prefix (sorts after an older ulid)", async () => {
    // Build a ULID whose timestamp is ~1 year in the past.
    const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let t = Date.now() - 365 * 24 * 3600 * 1000;
    let prefix = "";
    for (let i = 0; i < 10; i++) { prefix = CROCK[t % 32] + prefix; t = Math.floor(t / 32); }
    const old = `${prefix}0000000000000000`;
    const fresh = await ev("ulid()") as string;
    expect(fresh > old).toBe(true);
  });
});


// ── Async arrow bodies (Resolver-backed context) ──────────────────────────────

describe("collection builtins with Resolver-backed context in arrow bodies", () => {
  const store: Record<string, unknown> = { threshold: 5, prefix: "x-", factor: 2 };
  const state = resolve(async (key) => (store[key] ?? null) as never);
  const asyncEng = createEngine({ timeoutMs: 5000 });

  it("filter: keeps elements matching Resolver condition", async () => {
    const result = await asyncEng.evaluate("[1, 6, 3, 8] | filter(x => x > state.threshold)", { state });
    expect(result).toEqual([6, 8]);
  });

  it("map: transforms elements using Resolver value", async () => {
    const result = await asyncEng.evaluate('["a","b"] | map(x => state.prefix + x)', { state });
    expect(result).toEqual(["x-a", "x-b"]);
  });

  it("find: finds first element matching Resolver condition", async () => {
    const result = await asyncEng.evaluate("[1, 6, 3, 8] | find(x => x > state.threshold)", { state });
    expect(result).toBe(6);
  });

  it("some: returns true when any element matches Resolver condition", async () => {
    expect(await asyncEng.evaluate("[1, 3] | some(x => x > state.threshold)", { state })).toBe(false);
    expect(await asyncEng.evaluate("[1, 6] | some(x => x > state.threshold)", { state })).toBe(true);
  });

  it("every: returns true when all elements match Resolver condition", async () => {
    expect(await asyncEng.evaluate("[6, 8] | every(x => x > state.threshold)", { state })).toBe(true);
    expect(await asyncEng.evaluate("[6, 3] | every(x => x > state.threshold)", { state })).toBe(false);
  });

  it("reduce: accumulates using Resolver value", async () => {
    const result = await asyncEng.evaluate("[1, 2, 3] | reduce(acc => acc + state.factor, 0)", { state });
    expect(result).toBe(6);
  });

  it("sort: sorts by Resolver-derived key (1-param extractor)", async () => {
    const items = [{ n: 7 }, { n: 1 }, { n: 4 }];
    const result = await asyncEng.evaluate("items | sort(x => x.n * state.factor)", { state, items });
    expect(result).toEqual([{ n: 1 }, { n: 4 }, { n: 7 }]);
  });

  it("sort: sorts with async 2-param comparator", async () => {
    const result = await asyncEng.evaluate("[3, 1, 4, 1, 5] | sort((a, b) => a - b + state.threshold - state.threshold)", { state });
    expect(result).toEqual([1, 1, 3, 4, 5]);
  });

  it("sort: async 2-param comparator throws when returning non-number", async () => {
    await expect(
      asyncEng.evaluate('[3, 1, 2] | sort((a, b) => "wrong")', { state }),
    ).rejects.toBeInstanceOf(ExpressionError);
  });

  it("find: returns null when no element matches in async mode", async () => {
    const result = await asyncEng.evaluate("[1, 2, 3] | find(x => x > 10)", { state });
    expect(result).toBeNull();
  });

  it("flatMap: maps and flattens arrays in async mode", async () => {
    const result = await asyncEng.evaluate("[1, 2] | flatMap(x => [x, x * state.factor])", { state });
    expect(result).toEqual([1, 2, 2, 4]);
  });

  it("flatMap: handles non-array mapped values in async mode", async () => {
    const result = await asyncEng.evaluate("[1, 2] | flatMap(x => x * state.factor)", { state });
    expect(result).toEqual([2, 4]);
  });
});

// ── blank() / filled() / isEmpty() / firstFilled() / joinFilled() ────────────

describe("blank() / filled()", () => {
  it("treats null, empty and whitespace-only strings and empty collections as blank", async () => {
    for (const v of ["null", '""', '"  \\n\\t"', "[]", "{}"]) {
      expect(await ev(`blank(${v})`)).toBe(true);
      expect(await ev(`filled(${v})`)).toBe(false);
    }
  });
  it("treats everything else as filled, including 0 and false", async () => {
    for (const v of ['"a"', '" a "', "0", "false", "[0]", "[null]", '{"a": null}']) {
      expect(await ev(`blank(${v})`)).toBe(false);
      expect(await ev(`filled(${v})`)).toBe(true);
    }
  });
  it("reads a missing name as blank and pipes", async () => {
    expect(await lenientEng.evaluate("missing | blank", {})).toBe(true);
    expect(await ev("name | filled", { name: "x" })).toBe(true);
    expect(await ev("name?.first | blank", { name: null })).toBe(true);
  });
  it("treats dates and functions as filled", async () => {
    expect(await ev("now() | blank")).toBe(false);
    expect(await ev("today() | filled")).toBe(true);
  });
});

describe("isEmpty()", () => {
  it("is true for null, empty string, array and object", async () => {
    for (const v of ["null", '""', "[]", "{}"]) expect(await ev(`isEmpty(${v})`)).toBe(true);
  });
  it("does not trim and ignores scalars", async () => {
    for (const v of ['" "', "0", "false", "[null]", '{"a": 1}']) expect(await ev(`isEmpty(${v})`)).toBe(false);
    expect(await ev("[] | isEmpty")).toBe(true);
  });
});

describe("firstFilled()", () => {
  it("returns the first non-blank argument", async () => {
    expect(await ev('firstFilled(null, "", "  ", "a", "b")')).toBe("a");
    expect(await ev('firstFilled(a, b, "none")', { a: null, b: " " })).toBe("none");
    expect(await ev("firstFilled(0, 5)")).toBe(0);
    expect(await ev("firstFilled(false, true)")).toBe(false);
  });
  it("returns null when every argument is blank, and pipes", async () => {
    expect(await ev('firstFilled(null, "", [])')).toBe(null);
    expect(await ev("firstFilled()")).toBe(null);
    expect(await ev('a | firstFilled(b, "z")', { a: "", b: "y" })).toBe("y");
  });
});

describe("joinFilled()", () => {
  it("drops blank items and joins the rest", async () => {
    expect(await ev('joinFilled(["a", null, "", "  ", "b"], " · ")')).toBe("a · b");
    expect(await ev("joinFilled([1, 0, null, 2], ',')")).toBe("1,0,2");
    expect(await ev("parts | joinFilled('-')", { parts: ["x", "", "y"] })).toBe("x-y");
  });
  it("defaults the separator to a comma and accepts null and empty input", async () => {
    expect(await ev('joinFilled(["a", "b"])')).toBe("a,b");
    expect(await ev("joinFilled(null, ',')")).toBe("");
    expect(await ev("joinFilled([], ',')")).toBe("");
    expect(await ev("joinFilled([null], ',')")).toBe("");
  });
  it("rejects a non-array and a non-string separator", async () => {
    await throws('joinFilled("abc", ",")');
    await throws("joinFilled([1], 2)");
  });
  it("counts items against the iteration budget", async () => {
    const small = createEngine({ maxIterations: 2 });
    await expect(small.evaluate("joinFilled([1,2,3], ',')", {})).rejects.toBeInstanceOf(ExpressionError);
  });
});

// ── randomString() ────────────────────────────────────────────────────────────

describe("randomString()", () => {
  it("returns a string of the requested length", async () => {
    expect(await ev("randomString(43)")).toMatch(/^[A-Za-z0-9\-._~]{43}$/);
  });
  it("uses a custom charset", async () => {
    expect(await ev('randomString(16, "ab")')).toMatch(/^[ab]{16}$/);
  });
  it("throws on null length, an empty charset and an out-of-range length", async () => {
    await throws("randomString(null)");
    await throws('randomString(10, "")');
    await throws("randomString(257)");
  });
  it("random_string no longer exists", async () => {
    await throws("random_string(8)");
    await expect(ev("randomString(0)")).rejects.toThrow(/randomString\(\) length must be between/);
  });
});

// ── round / floor / ceil / abs ────────────────────────────────────────────────

describe("round()", () => {
  it("rounds to an integer, halves away from zero", async () => {
    expect(await ev("round(2.4)")).toBe(2);
    expect(await ev("round(2.5)")).toBe(3);
    expect(await ev("round(-2.5)")).toBe(-3);
    expect(await ev("round(-0.2)")).toBe(0);
    expect(Object.is(await ev("round(-0.2)"), -0)).toBe(false);
  });
  it("rounds to digits", async () => {
    expect(await ev("round(1.005, 2)")).toBe(1.01);
    expect(await ev("round(7.12345, 3)")).toBe(7.123);
    expect(await ev("round(-1.005, 2)")).toBe(-1.01);
    expect(await ev("7.12345 | round(0)")).toBe(7);
    expect(await ev("round(1e-7, 2)")).toBe(0);
    expect(await ev("round(1e21, 2)")).toBe(1e21);
  });
  it("passes Infinity through", async () => {
    expect(await infEng.evaluate("round(1/0)", {})).toBe(Infinity);
  });
  it("throws on null and non-number input", async () => {
    await throws("round(null)");
    await throws('round("1.5")');
    await throws("round([1])");
  });
  it("throws on invalid digits", async () => {
    await throws("round(1.5, 1.5)");
    await throws("round(1.5, -1)");
    await throws("round(1.5, 101)");
    await throws('round(1.5, "2")');
  });
  it("names the function in the error", async () => {
    await expect(ev("round(null)")).rejects.toThrow("round() requires a number, got null");
  });
});

describe("floor(), ceil(), abs()", () => {
  it("compute", async () => {
    expect(await ev("floor(7.9)")).toBe(7);
    expect(await ev("floor(-7.1)")).toBe(-8);
    expect(await ev("ceil(7.1)")).toBe(8);
    expect(await ev("ceil(-7.9)")).toBe(-7);
    expect(await ev("abs(-3)")).toBe(3);
    expect(await ev("-3.5 | abs")).toBe(3.5);
  });
  it("throw on null and non-number input", async () => {
    for (const fn of ["floor", "ceil", "abs"]) {
      await throws(`${fn}(null)`);
      await throws(`${fn}("1")`);
    }
    await expect(ev("abs(null)")).rejects.toThrow("abs() requires a number, got null");
  });
});

// ── sum / min / max / range ───────────────────────────────────────────────────

describe("sum(), min(), max()", () => {
  it("compute over an array of numbers", async () => {
    expect(await ev("sum([1, 2, 3.5])")).toBe(6.5);
    expect(await ev("[3, 1, 2] | min")).toBe(1);
    expect(await ev("[3, 1, 2] | max")).toBe(3);
    expect(await ev("[-1, -5] | max")).toBe(-1);
  });
  it("sum of an empty array is 0; min and max are null", async () => {
    expect(await ev("sum([])")).toBe(0);
    expect(await ev("min([])")).toBeNull();
    expect(await ev("max([])")).toBeNull();
  });
  it("work after map", async () => {
    expect(await ev("items | map(x => x.p) | sum", { items: [{ p: 2 }, { p: 5 }] })).toBe(7);
  });
  it("throw on null, non-array and non-number elements", async () => {
    for (const fn of ["sum", "min", "max"]) {
      await throws(`${fn}(null)`);
      await throws(`${fn}(3)`);
      await throws(`${fn}([1, null])`);
      await throws(`${fn}(["1"])`);
    }
    await expect(ev("sum([1, null])")).rejects.toThrow(
      "sum() requires an array of numbers, got null at index 1",
    );
  });
  it("count against the iteration budget", async () => {
    const small = createEngine({ maxIterations: 3 });
    await expect(small.evaluate("sum([1, 2, 3, 4])")).rejects.toThrow();
  });
});

describe("range()", () => {
  it("counts up from 0, from start, and by step", async () => {
    expect(await ev("range(4)")).toEqual([0, 1, 2, 3]);
    expect(await ev("range(2, 5)")).toEqual([2, 3, 4]);
    expect(await ev("range(0, 10, 5)")).toEqual([0, 5]);
    expect(await ev("range(10, 0, -5)")).toEqual([10, 5]);
    expect(await ev("range(0, 1, 0.5)")).toEqual([0, 0.5]);
  });
  it("is empty when the range is empty or the step runs away from the end", async () => {
    expect(await ev("range(0)")).toEqual([]);
    expect(await ev("range(-3)")).toEqual([]);
    expect(await ev("range(0, 5, -1)")).toEqual([]);
  });
  it("throws on a zero step, null and non-number arguments", async () => {
    await throws("range(0, 5, 0)");
    await throws("range(null)");
    await throws('range("3")');
    await throws("range(0, 5, 1/0)");
    await throws("range(0, 1/0)");
  });
  it("is bounded by the iteration budget before it allocates", async () => {
    await expect(ev("range(1000000000)")).rejects.toThrow();
    const small = createEngine({ maxIterations: 5 });
    expect(await small.evaluate("range(5)")).toHaveLength(5);
    await expect(small.evaluate("range(6)")).rejects.toThrow();
  });
});

// ── deepEquals() ──────────────────────────────────────────────────────────────

describe("deepEquals()", () => {
  it("compares arrays and objects by content", async () => {
    expect(await ev("deepEquals([1, { a: [2] }], [1, { a: [2] }])")).toBe(true);
    expect(await ev("deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 })")).toBe(true);
    expect(await ev("deepEquals([1, 2], [2, 1])")).toBe(false);
    expect(await ev("deepEquals({ a: 1 }, { a: 1, b: 2 })")).toBe(false);
    expect(await ev("deepEquals({ a: 1 }, { b: 1 })")).toBe(false);
    expect(await ev("deepEquals([1], [1, 2])")).toBe(false);
  });
  it("does not coerce and tells arrays from objects", async () => {
    expect(await ev('deepEquals([1], ["1"])')).toBe(false);
    expect(await ev("deepEquals(1, true)")).toBe(false);
    expect(await ev("deepEquals([], {})")).toBe(false);
    expect(await ev("deepEquals(null, [])")).toBe(false);
    expect(await ev("deepEquals(null, null)")).toBe(true);
    expect(await ev("deepEquals(null, 0)")).toBe(false);
  });
  it("treats NaN as equal to itself", async () => {
    expect(await infEng.evaluate("deepEquals(0/0, 0/0)", {})).toBe(true);
  });
  it("compares dates by value and type", async () => {
    expect(await ev('deepEquals(plainDate("2026-01-02"), plainDate("2026-01-02"))')).toBe(true);
    expect(await ev('deepEquals(plainDate("2026-01-02"), plainDate("2026-01-03"))')).toBe(false);
    expect(await ev('deepEquals(plainDate("2026-01-02"), "2026-01-02")')).toBe(false);
  });
  it("treats functions as equal only by reference", async () => {
    expect(await ev("deepEquals(x => x, x => x)")).toBe(false);
    expect(await ev("let f = x => x in deepEquals(f, f)")).toBe(true);
  });
  it("leaves == by reference", async () => {
    expect(await ev("[1] == [1]")).toBe(false);
    expect(await ev("1 == '1'")).toBe(false);
  });
  it("throws past the nesting limit", async () => {
    const nest = (): Value => {
      let deep: Value = [];
      for (let i = 0; i < 250; i++) deep = [deep];
      return deep;
    };
    await expect(ev("deepEquals(a, a)", { a: nest() })).resolves.toBe(true);
    await expect(ev("deepEquals(a, b)", { a: nest(), b: nest() })).rejects.toThrow(/nesting limit/);
  });
});

// ── sort with a locale ────────────────────────────────────────────────────────

describe("sort() with a locale", () => {
  const letters = ["ё", "е", "я", "а"];
  it("orders Cyrillic by code point without a locale", async () => {
    expect(await ev("a | sort", { a: letters })).toEqual(["а", "е", "я", "ё"]);
  });
  it("orders Cyrillic by the language with a locale", async () => {
    expect(await ev('a | sort({ locale: "ru" })', { a: letters })).toEqual(["а", "е", "ё", "я"]);
    expect(await ev('a | sort(null, { locale: "ru" })', { a: letters })).toEqual(["а", "е", "ё", "я"]);
  });
  it("applies to a key extractor", async () => {
    const users = letters.map((name) => ({ name }));
    expect(
      await ev('users | sort(u => u.name, { locale: "ru" }) | map(u => u.name)', { users }),
    ).toEqual(["а", "е", "ё", "я"]);
  });
  it("keeps numbers numeric and a null locale natural", async () => {
    expect(await ev('[10, 9, 1] | sort({ locale: "ru" })')).toEqual([1, 9, 10]);
    expect(await ev("a | sort({ locale: null })", { a: letters })).toEqual(["а", "е", "я", "ё"]);
  });
  it("sorts in the async path", async () => {
    const root = resolve(async () => letters);
    expect(await ev('r.list | sort(x => x, { locale: "ru" })', { r: root })).toEqual(["а", "е", "ё", "я"]);
  });
  it("throws on an invalid locale, option, option type and comparator", async () => {
    await throws('a | sort({ locale: "not a locale" })', { a: letters });
    await throws("a | sort({ locale: 5 })", { a: letters });
    await throws("a | sort({ sensitivity: 1 })", { a: letters });
    await throws("a | sort(null, 5)", { a: letters });
    await throws('a | sort((x, y) => 0, { locale: "ru" })', { a: letters });
    await throws("a | sort([1])", { a: letters });
  });
  it("keeps working after the collator cache fills", async () => {
    for (let i = 0; i < 70; i++) {
      const tag = `${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
      await ev(`a | sort({ locale: "${tag}" })`, { a: letters });
    }
    expect(await ev('a | sort({ locale: "ru" })', { a: letters })).toEqual(["а", "е", "ё", "я"]);
  });
});

// ── ** and exponent literals ──────────────────────────────────────────────────

describe("** and exponent literals", () => {
  it("raises to a power, right-associative", async () => {
    expect(await ev("2 ** 10")).toBe(1024);
    expect(await ev("2 ** 3 ** 2")).toBe(512);
    expect(await ev("(2 ** 3) ** 2")).toBe(64);
    expect(await ev("2 ** 0.5")).toBeCloseTo(Math.SQRT2);
  });
  it("binds tighter than * and unary minus, looser than postfix", async () => {
    await expect(ev("-2 ** 2")).rejects.toThrow("cannot be the left operand of '**'");
    expect(await ev("(-2) ** 2")).toBe(4);
    expect(await ev("-(2 ** 2)")).toBe(-4);
    expect(await ev("2 ** -1")).toBe(0.5);
    expect(await ev("2 * 3 ** 2")).toBe(18);
    expect(await ev("-2 * 3")).toBe(-6);
    expect(await ev("a.b ** 2", { a: { b: 3 } })).toBe(9);
    expect(await ev("2 ** 3 | toFixed(1)")).toBe("8.0");
  });
  it("throws on non-numbers", async () => {
    await throws('"2" ** 2');
    await throws("null ** 2");
    await throws("2 ** [1]");
  });
  it("reads exponent literals", async () => {
    expect(await ev("1e3")).toBe(1000);
    expect(await ev("1.5e-3")).toBe(0.0015);
    expect(await ev("2E+2")).toBe(200);
    expect(await ev("1e0")).toBe(1);
    expect(await ev("1e308")).toBe(1e308);
  });
  it("rejects an overflowing exponent literal and leaves a bare e alone", async () => {
    await throws("1e999");
    await throws("1e");
    await throws("1e+");
  });
});

describe("base64urlEncodeHex()", () => {
  it("encodes the bytes of a hex string (PKCE path)", async () => {
    const hex = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(await ev(`base64urlEncodeHex("${hex}")`)).toBe(Buffer.from(hex, "hex").toString("base64url"));
  });
  it("accepts upper case and the empty string", async () => {
    expect(await ev('base64urlEncodeHex("FFfe")')).toBe("__4");
    expect(await ev('base64urlEncodeHex("")')).toBe("");
  });
  it("pipes a sha256 digest", async () => {
    const expected = createHash("sha256").update("abc").digest("base64url");
    expect(await ev('"abc" | sha256 | base64urlEncodeHex')).toBe(expected);
  });
  it("throws TAV_TYPE on an odd length or a non-hex character", async () => {
    for (const bad of ["abc", "zz", "ab cd"]) {
      await expect(ev(`base64urlEncodeHex("${bad}")`)).rejects.toMatchObject({ errors: [{ code: "TAV_TYPE" }] });
    }
  });
  it("throws on non-string", async () => await throws("base64urlEncodeHex(42)"));
});
