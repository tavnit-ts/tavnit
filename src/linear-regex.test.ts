// The linear regex engine must mean what the JavaScript RegExp means for ordinary text.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileLinear, NOT_SPACE, SPACE, translate } from "./builtins/linear-regex.js";
import { createEngine } from "./engine/engine.js";
import { ExpressionError } from "./engine/types.js";

const linear = createEngine();
const native = createEngine({ regex: "native" });

async function both(source: string, data: Record<string, unknown>) {
  return [await linear.evaluate(source, data), await native.evaluate(source, data)];
}

describe("linear regex: same answer as the JavaScript engine", () => {
  const SPACES = [" ", " ", " ", "﻿", "　", " ", "\t", "\v", "\f", "\r", "\n", " "];

  it.each(SPACES)("\\s takes %j, as JavaScript does", async (space) => {
    expect(await both("s | captures('^(\\\\s)$')", { s: space })).toEqual([[space], [space]]);
    expect(await both("s | matches('\\\\S')", { s: space })).toEqual([false, false]);
    expect(await both("s | matches('[\\\\s]')", { s: space })).toEqual([true, true]);
    expect(await both("s | matches('[^\\\\S]')", { s: space })).toEqual([true, true]);
  });

  it.each(["\n", "\r", " ", " "])(". does not take the line terminator %j", async (terminator) => {
    expect(await both("s | matches('^.$')", { s: terminator })).toEqual([false, false]);
    expect(await both("s | matches('^[^a]$')", { s: terminator })).toEqual([true, true]);
  });

  it.each([
    ["^(\\u0041)(\\u044f)$", "Aя"],
    ["^(\\cJ)$", "\n"],
    ["^(\\0)$", "\0"],
    ["^([[])x$", "[x"],
    ["^([[:alpha:]])]$", "a]"],
    ["^([[:alpha:]])]$", "a"],
    ["([])", "a"],
    ["^([^])$", "\n"],
    ["^a([])b$", "ab"],
    ["x([^])y", "x\ny"],
    ["^([\\u0430-\\u044f]+)$", "привет"],
    ["^([а-яё]+)\\s+([А-ЯЁ]+)$", "привет МИР"],
    ["(\\d+)-(\\d+)", "tel 12-34"],
    ["\\b(слово)\\b", "слово"],
    ["(\\w+)", "привет"],
    ["^(\\s*)$", "  "],
    ["^(?:ab)+(c)$", "ababc"],
    ["(?<year>\\d{4})-(\\d{2})", "2026-11"],
    ["(a.c)", "a c"],
    ["(a.+?c)", "abcbc"],
    ["([\\s\\d]+)", "1 2"],
    ["([^\\s]+)", "ab cd"],
  ])("pattern %s on %j", async (pattern, subject) => {
    const data = { s: subject, p: pattern };
    const [l, n] = await both("captures(s, p)", data);
    expect(l).toEqual(n);
    const [lm, nm] = await both("matches(s, p)", data);
    expect(lm).toEqual(nm);
    const [lc, nc] = await both("capture(s, p, 1)", data);
    expect(lc).toEqual(nc);
  });

  const TOKENS = ["a", "b", "x", "1", "[ab]", "[^a]", "\\s", "\\S", ".", "\\d", "\\w", "\\W", "\\b", "-", "я", "[а-я]", "[\\s-]", "[^\\s]", "[^]"];
  const QUANTIFIERS = ["", "", "?", "*", "+", "{1,2}", "*?", "+?"];
  const patternArb = fc
    .array(fc.tuple(fc.constantFrom(...TOKENS), fc.constantFrom(...QUANTIFIERS)), { minLength: 1, maxLength: 5 })
    .chain((parts) =>
      fc.tuple(fc.boolean(), fc.boolean()).map(
        ([start, end]) => (start ? "^" : "") + parts.map(([t, q]) => (t === "\\b" ? t : t + q)).join("") + (end ? "$" : ""),
      ),
    );
  const subjectArb = fc
    .array(fc.constantFrom("a", "b", "x", "1", " ", " ", "\n", "\r", " ", "я", "Я", "﻿", "-", "\t"), { maxLength: 12 })
    .map((a) => a.join(""));

  it("agrees with the JavaScript engine on generated patterns", async () => {
    await fc.assert(
      fc.asyncProperty(patternArb, subjectArb, async (pattern, subject) => {
        const data = { p: `(${pattern})`, s: subject };
        expect(await linear.evaluate("captures(s, p)", data)).toEqual(await native.evaluate("captures(s, p)", data));
        expect(await linear.evaluate("matches(s, p)", data)).toEqual(await native.evaluate("matches(s, p)", data));
      }),
      { numRuns: 2000 },
    );
  });
});

describe("linear regex: documented differences", () => {
  it("reads an astral character as one character, where JavaScript reads two units", async () => {
    expect(await linear.evaluate("matches('😀', '^.$')", {})).toBe(true);
    expect(await native.evaluate("matches('😀', '^.$')", {})).toBe(false);
    expect(await linear.evaluate("captures('😀', '(.)')", {})).toEqual(["😀"]);
  });

  it("takes \\p{…} as a Unicode class, and an inline flag as a flag", async () => {
    expect(await linear.evaluate("captures('привет', '(\\\\p{Cyrillic}+)')", {})).toEqual(["привет"]);
    expect(await linear.evaluate("matches('Ё', '(?i)ё')", {})).toBe(true);
  });
});

describe("linear regex: what it refuses", () => {
  const message = async (pattern: string, call = "matches"): Promise<string> => {
    const source = call === "capture" ? "capture('abc', p, 1)" : "matches('abc', p)";
    try {
      await linear.evaluate(source, { p: pattern });
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      return (e as ExpressionError).message;
    }
    throw new Error("expected a failure");
  };

  it.each([
    ["(?=a)a", "a lookahead"],
    ["(?!a)a", "a lookahead"],
    ["(a)\\1", "a backreference"],
    ["(?<n>a)\\k<n>", "a backreference"],
  ])("%s says it needs %s and how to get it", async (pattern, feature) => {
    expect(await message(pattern)).toContain(
      `matches() pattern uses ${feature}, which the linear regex engine does not support; set regex: 'native' on the engine`,
    );
    expect(await message(pattern, "capture")).toContain("capture() pattern uses");
  });

  it.each(["(?<=a)b", "(?<!a)b"])("%s is refused in both modes, and says so", async (pattern) => {
    expect(await message(pattern)).toContain("a lookbehind, which the linear regex engine does not support and the native engine refuses");
    expect(await message(pattern, "capture")).toContain("capture() pattern uses a lookbehind");
    await expect(native.evaluate("matches('ab', p)", { p: pattern })).rejects.toThrow(/unsafe/);
  });

  it.each(["[", "(", "a{2,1}", "(?P<bad"])("%s is an invalid pattern", async (pattern) => {
    expect(await message(pattern)).toContain(`Invalid regular expression: ${pattern}`);
  });

  it("native mode still runs lookaround and backreferences", async () => {
    expect(await native.evaluate("matches('ab', '(?=a)ab')", {})).toBe(true);
    expect(await native.evaluate("matches('aa', '(a)\\\\1')", {})).toBe(true);
  });
});

describe("the compiled-pattern cache", () => {
  it("returns one compiled pattern for one source", () => {
    expect(compileLinear("a+b", "matches")).toBe(compileLinear("a+b", "matches"));
  });

  it("keeps a recently used pattern and drops the least recently used past 256", () => {
    const first = compileLinear("^first$", "matches");
    for (let i = 0; i < 255; i++) compileLinear(`p${i}`, "matches");
    expect(compileLinear("^first$", "matches")).toBe(first);
    for (let i = 0; i < 10; i++) compileLinear(`q${i}`, "matches");
    expect(compileLinear("^first$", "matches")).toBe(first);
    const evicted = compileLinear("p0", "matches");
    for (let i = 0; i < 300; i++) compileLinear(`r${i}`, "matches");
    expect(compileLinear("p0", "matches")).not.toBe(evicted);
  });
});

describe("the whitespace tables", () => {
  it("split every scalar value exactly as JavaScript \\s does", () => {
    const inside = (ranges: ReadonlyArray<readonly [number, number]>, cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b);
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const space = /\s/.test(String.fromCodePoint(cp));
      if (inside(SPACE, cp) !== space || inside(NOT_SPACE, cp) === space) throw new Error(`U+${cp.toString(16)}`);
    }
  });
});

describe("translate", () => {
  it("leaves a plain pattern as it is", () => {
    expect(translate("^ab+c?$")).toBe("^ab+c?$");
  });

  it("keeps a non-escape \\c and a short \\u as they are", () => {
    expect(translate("\\c1")).toBe("\\c1");
    expect(translate("\\u12")).toBe("\\u12");
  });
});
