/**
 * Guards the skill's reference files: every example in
 * `docs/skills/tavnit/references/*.md` that a reader can copy must run as written,
 * and every fenced YAML sample must parse.
 *
 * The assertions here are the documentation's own claims — when a claim is
 * wrong, this file fails rather than the reader. Examples that legitimately
 * need a custom filter or a placeholder context are marked `skip` in the case
 * lists below; anything not listed is not guarded.
 *
 * The references ship in the package, so this also runs from a published
 * install; it skips itself only if the directory is absent.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { Value } from "../index.js";
import { createEngine, ExpressionError } from "../index.js";
import { ERROR_CODES, extractSpans, parse } from "../internal.js";

const refsDir = join(import.meta.dirname, "../../docs/skills/tavnit/references");
const referenceFiles = existsSync(refsDir)
  ? readdirSync(refsDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
  : [];
const readReference = (file: string): string => readFileSync(join(refsDir, file), "utf8");

// ── document examples ─────────────────────────────────────────────────────────

describe.skipIf(referenceFiles.length === 0)("skill references — documented examples", () => {
  const engine = createEngine();
  // The lenient reading (`strict: false`) for the examples that document a missing name as null.
  const lenient = createEngine({ strict: false });
  const evaluateLenient = (source: string, context: Record<string, Value> = {}): Promise<Value> =>
    lenient.evaluate(source, context);

  /** Evaluate and return the value, for cases with a concrete expected result. */
  const evaluate = (source: string, context: Record<string, Value> = {}): Promise<Value> =>
    engine.evaluate(source, context);

  it("embedding: pipe precedence examples", async () => {
    // Operators after a pipe apply to the pipe's result.
    expect(await evaluate("now() | toEpochSeconds() + 1")).toBeTypeOf("number");
    expect(await evaluate("-5 + 2 | abs()")).toBe(3);
    expect(await evaluate("2 | abs() + 1")).toBe(3);
  });

  it("language: exponent, equality and number rules", async () => {
    expect(await evaluate("(-2) ** 2")).toBe(4);
    expect(await evaluate("-(2 ** 2)")).toBe(-4);
    expect(await evaluate("2 ** -1")).toBe(0.5);
    expect(await evaluate("2 ** 3 ** 2")).toBe(512);
    expect(await evaluate("1e3")).toBe(1000);
    expect(await evaluate("1.5e-3")).toBe(0.0015);
    await expect(evaluate("1e999")).rejects.toThrow(/Number literal is too large/);
    expect(await evaluate("9007199254740993")).toBe(9007199254740992);
    expect(await evaluate("1 == '1'")).toBe(false);
    expect(await evaluate("0 == false")).toBe(false);
    expect(await evaluate("[1] == [1]")).toBe(false);
    expect(await evaluate("items == items", { items: [1] })).toBe(true);
    expect(await evaluate("deepEquals([1, { a: 2 }], [1, { a: 2 }])")).toBe(true);
    expect(await evaluate("deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 })")).toBe(true);
    expect(await evaluate('"3" + 2')).toBe("32");
    await expect(evaluate('"3" * 2')).rejects.toThrow(/requires/);
  });

  it("builtins: rounding, aggregation and range examples", async () => {
    expect(await evaluate("2.5 | round")).toBe(3);
    expect(await evaluate("-2.5 | round")).toBe(-3);
    expect(await evaluate("1.005 | round(2)")).toBe(1.01);
    expect(await evaluate("7.2 | floor")).toBe(7);
    expect(await evaluate("7.2 | ceil")).toBe(8);
    expect(await evaluate("-3 | abs")).toBe(3);
    expect(await evaluate("[3, 1, 2] | sum")).toBe(6);
    expect(await evaluate("[3, 1, 2] | min")).toBe(1);
    expect(await evaluate("sum([1, null])").catch((e: Error) => e.message)).toBe(
      "sum() requires an array of numbers, got null at index 1",
    );
    expect(await evaluate("range(4)")).toEqual([0, 1, 2, 3]);
    expect(await evaluate("range(2, 5)")).toEqual([2, 3, 4]);
    expect(await evaluate("range(10, 0, -5)")).toEqual([10, 5]);
    expect(await evaluate("range(3) | map(i => i * i)")).toEqual([0, 1, 4]);
    expect(await evaluate('["ё", "е", "я", "а"] | sort')).toEqual(["а", "е", "я", "ё"]);
    expect(await evaluate('["ё", "е", "я", "а"] | sort({ locale: "ru" })')).toEqual([
      "а", "е", "ё", "я",
    ]);
    expect(await evaluate("randomString(5)")).toHaveLength(5);
  });

  it("embedding: a } before the terminator closes the object literal", async () => {
    expect(extractSpans("${{ { id: 1 } }}")).toEqual([
      { kind: "expression", source: " { id: 1 } ", offset: 0 },
    ]);
    expect(extractSpans("${{ { id: 1 }}}")).toEqual([
      { kind: "expression", source: " { id: 1 }", offset: 0 },
    ]);
    expect(await engine.render("${{ { id: 1 }}}")).toBe('{"id":1}');
    expect(await engine.render('${{ "}}" }}')).toBe("}}");
    expect(await engine.render("${{ { id: 1 } }}")).toBe('{"id":1}');
  });

  it("language: numbers take .5 and 1_000, strings order with < and >", async () => {
    expect(await evaluate(".5 + 1")).toBe(1.5);
    expect(await evaluate("1_000_000 * 2")).toBe(2_000_000);
    expect(await evaluate("[1, 2][0]")).toBe(1);
    expect(await evaluate("a ?.5 : 1", { a: true })).toBe(0.5);
    await expect(evaluate("a.5", { a: {} })).rejects.toThrow();
    await expect(evaluate("0x10")).rejects.toThrow(/Hexadecimal, binary and octal/);
    expect(await evaluate('"a" < "b"')).toBe(true);
    expect(await evaluate('"10" < "9"')).toBe(true);
    expect(await evaluate('"2026-01-05" < "2026-02-01"')).toBe(true);
    expect(await evaluate('"b" >= "b"')).toBe(true);
    await expect(evaluate('1 < "a"')).rejects.toThrow(/requires two numbers or two strings/);
  });

  it("embedding: object literal inside a span needs no let-binding", async () => {
    const context = { args: { customer: { id: 1, name: "N" } } };
    expect(await evaluate("let c = args.customer in { id: c.id, name: c.name }", context)).toEqual({
      id: 1,
      name: "N",
    });
    // The documented let-out rewrite works too, and is not required.
    expect(await evaluate("let c = args.customer, out = { id: c.id } in out", context)).toEqual({
      id: 1,
    });
  });

  it("embedding: a ternary as the last let binding swallows `in`", async () => {
    await expect(evaluate('let k = c.a ? "x" : "y" in { k: k }', { c: { a: true } })).rejects.toThrow(
      /Expected In/,
    );
    expect(await evaluate('let k = (c.a ? "x" : "y") in { k: k }', { c: { a: true } })).toEqual({
      k: "x",
    });
  });

  it("embedding: array membership is not includes()", async () => {
    await expect(evaluate('notes | includes("done")', { notes: ["done"] })).rejects.toThrow(
      /includes\(\) requires a string/,
    );
    expect(await evaluate('some(notes, x => x == "done")', { notes: ["done"] })).toBe(true);
  });

  it("value-templates: a spread in a body yields to later keys, a null span drops its key", async () => {
    const template = lenient.parse({
      children: "${{ items | map(t => _) }}",
      _: { "...": "${{ t }}", type: "Row", key: "row-${{ t.id }}", note: "${{ t.note }}" },
    });
    expect(await lenient.evaluate(template, { items: [{ id: 1, key: "old", extra: true }] })).toEqual({
      children: [{ id: 1, key: "row-1", extra: true, type: "Row" }],
    });
  });

  it("value-templates: a null key is the empty key, a null value drops the entry", async () => {
    // A key is rendered as text, so a null key is `""` and the entry stays.
    expect(await lenient.renderObject({ "${{ missing }}": 1 })).toEqual({ "": 1 });
    // A value span that evaluates to null removes the entry — the other rule.
    expect(await lenient.renderObject({ a: "${{ missing }}" })).toEqual({});
    // A literal null is a value, not an expression, so the entry is kept.
    expect(await lenient.renderObject({ a: null })).toEqual({ a: null });
    // The documented remedy: guard the entry so the unaddressable key never lands.
    expect(await lenient.renderObject([{ $if: "${{ missing }}", "${{ missing }}": 1 }, { b: 2 }])).toEqual(
      [{ b: 2 }],
    );
  });

  it("value-templates: the `_` subtree hole splices an array", async () => {
    expect(
      await engine.renderObject(
        {
          children: "${{ items | map(t => _) }}",
          _: { type: "Row", props: { text: "${{ t.name }}" } },
        },
        { items: [{ name: "a" }, { name: "b" }] },
      ),
    ).toEqual({
      children: [
        { type: "Row", props: { text: "a" } },
        { type: "Row", props: { text: "b" } },
      ],
    });
    // A `$_` host key is the element itself, and an array host splices.
    expect(
      await engine.renderObject(
        [
          { type: "Searchbar" },
          { $_: "${{ items | map(t => _) }}", _: { type: "Item", key: "row-${{ t.id }}" } },
        ],
        { items: [{ id: 1 }] },
      ),
    ).toEqual([{ type: "Searchbar" }, { type: "Item", key: "row-1" }]);
  });

  it("language: operators after a pipe apply to the pipe result", async () => {
    const context = { expires_in: 3600, threshold: 1, event: { date: "2099-01-01T00:00:00Z" } };
    expect(await evaluate("now() | toEpochSeconds() + expires_in - 30", context)).toBeGreaterThan(
      1_000_000_000,
    );
    expect(await evaluate("now() | toEpochSeconds() < threshold", context)).toBe(false);
    expect(await evaluate("event.date | toInstant() > now()", context)).toBe(true);
    expect(await evaluate('items | size == 0', { items: [1] })).toBe(false);
  });

  it("language: pipe then optional chaining needs no parentheses", async () => {
    // Same tree in both spellings — only the source offsets differ.
    const bare = parse("items | first?.id");
    const parenthesised = parse("(items | first)?.id");
    expect(bare.kind).toBe("member");
    expect(parenthesised.kind).toBe("member");
    expect(bare.kind === "member" && bare.optional).toBe(true);
    expect(bare.kind === "member" && bare.object.kind).toBe("pipe");
    expect(await evaluate("items | first?.id", { items: [{ id: 1 }] })).toBe(1);
    expect(await evaluate("items | first?.id", { items: [] })).toBe(null);
  });

  it("language: `?.` guards one access and does not short-circuit the chain", async () => {
    const nullUser = { user: null };
    const nullAddress = { user: { address: null } };
    expect(await evaluate("user?.address?.city", nullUser)).toBe(null);
    expect(await evaluate("user?.address?.city", nullAddress)).toBe(null);
    // One guard is not enough: `user?.address` is null, so `.city` throws on it.
    await expect(evaluate("user?.address.city", nullUser)).rejects.toThrow(
      /is null, cannot read `city`/,
    );
    await expect(evaluate("user?.address.city", nullAddress)).rejects.toThrow(
      /is null, cannot read `city`/,
    );
    expect(await evaluate("(items | first)?.id ?? 0", { items: [] })).toBe(0);
  });

  it("language: a per-step contract guarantee decides each `.` separately", async () => {
    // Contract: `customer` is obligatory and non-null — no guard on either step.
    const order = { order: { customer: { name: "Ann" } } };
    expect(await evaluate("order.customer.name", order)).toBe("Ann");
    // Contract: `customer` may be absent — guard it, and coalesce before `.name`.
    expect(await evaluate('order.customer?.name ?? ""', { order: {} })).toBe("");
    // Contract: every element has a non-null id — no guard inside the lambda.
    expect(await evaluate("rows | map(r => r.id)", { rows: [{ id: 1 }, { id: 2 }] })).toEqual([1, 2]);
  });

  it("language: an absent key reads as null and the next `.` throws (strict: false)", async () => {
    expect(await evaluateLenient("totals", {})).toBe(null);
    await expect(evaluateLenient("totals.count", {})).rejects.toThrow(
      /is null, cannot read `count`/,
    );
    expect(await evaluateLenient("state.tracker?.count ?? 0", { state: {} })).toBe(0);
    await expect(evaluateLenient("state.tracker.count", { state: {} })).rejects.toThrow(
      /is null, cannot read `count`/,
    );
  });

  it("language: `&&` / `||` short-circuit, so a leading guard works", async () => {
    expect(await evaluateLenient("state.tracker != null && state.tracker.count > 0", { state: {} })).toBe(
      false,
    );
    expect(await evaluateLenient("state.tracker == null || state.tracker.count > 0", { state: {} })).toBe(
      true,
    );
  });

  it("language: only registered filters are callable by name", async () => {
    await expect(evaluate("let f = x => x + 1 in f(2)")).rejects.toThrow(/Unknown function 'f'/);
    expect(await evaluate("let f = x => x + 1 in [2] | map(f)")).toEqual([3]);
    expect(await evaluate("map([1, 2, 3], str)")).toEqual(["1", "2", "3"]);
  });

  it("language: a lambda as the alternate ternary branch needs parentheses", async () => {
    expect(await evaluate("true ? x => x : 1")).toBeTypeOf("object");
    await expect(evaluate("false ? 1 : x => x")).rejects.toThrow(
      /Arrow function parameter must be a plain identifier/,
    );
    expect(await evaluate("false ? 1 : (x => x)")).toBeTypeOf("object");
  });

  it("language: unary minus is an operator", async () => {
    expect(await evaluate("-0.5")).toBe(-0.5);
  });

  it("language: non-first argument via pipe", async () => {
    expect(await evaluate('replace(tpl, "{name}", args.name | toUpperCase)', {
      tpl: "hi {name}",
      args: { name: "bob" },
    })).toBe("hi BOB");
  });

  it("builtins-types: parseInteger vs parseFloat vs num", async () => {
    await expect(evaluate('parseInteger("1e2")')).rejects.toThrow(/decimal component/);
    expect(await evaluate('parseFloat("3.14abc")')).toBe(3.14);
    await expect(evaluate('num("3.14abc")')).rejects.toThrow(/num\(\) cannot convert/);
    expect(await evaluate("type(map)")).toBe("function");
  });

  it("builtins-collections: documented optional arguments and append", async () => {
    expect(await evaluate('reduce(["a", "b"], (a, b) => b)')).toBe("b");
    expect(await evaluate("join([1, 2, 3])")).toBe("1,2,3");
    expect(await evaluate("concat([1, 2])")).toEqual([1, 2]);
    expect(await evaluate("slice([1, 2, 3])")).toEqual([1, 2, 3]);
    expect(await evaluate("chunk([1, 2, 3, 4, 5], 2.5)")).toEqual([[1, 2], [3, 4], [5]]);
    expect(await evaluate('append("a", "b")')).toBe("ab");
    expect(await evaluate('[{ tags: [["a"]] }] | flatMap(x => x.tags)')).toEqual([["a"]]);
    expect(await evaluate('[{ tags: [["a"]] }] | flatMap(x => x.tags) | flatten()')).toEqual(["a"]);
  });

  it("builtins-strings: matches is a substring test and replace expands $", async () => {
    expect(await evaluate('matches("hello", "ell")')).toBe(true);
    expect(await evaluate('"a" | replace("a", "$&$&")')).toBe("aa");
    expect(await evaluate('"hello" | truncate(-1)')).toBe("hell");
    expect(await evaluate('"a😀b" | truncate(2)')).toBe("a");
    await expect(evaluate('matches("ab", "(?<=a)b")')).rejects.toThrow(/lookbehind/);
    await expect(evaluate('matches("a", "[")')).rejects.toThrow(/Invalid regular expression/);
  });

  it("builtins-objects: date values serialise as tagged wrappers", async () => {
    const json = await evaluate('json(instant("2024-01-15T10:00:00Z"))');
    expect(String(json)).toContain("__tavnit_date__");
    expect(await evaluate('str(instant("2024-01-15T10:00:00Z"))')).toBe("2024-01-15T10:00:00Z");
    await expect(evaluate("str([1])")).rejects.toThrow(/cannot convert array/);
    await expect(evaluate("now() > today()")).rejects.toThrow(/cannot compare instant and plaindate/);
  });

  it("datetime: format() supports six tokens and passes the rest through", async () => {
    expect(await evaluate('today() | format("dd.MM.yyyy")')).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(await evaluate('today() | format("MMMM")')).toMatch(/^\d{4}$/);
    expect(await evaluate('today() | format("EEEE")')).toBe("EEEE");
    expect(await evaluate('instant("2024-01-15T10:00:00.000Z") | format()')).toBe(
      "2024-01-15T10:00:00Z",
    );
    expect(await evaluate('until(toInstant("2024-01-01T00:00:00Z"), now()) | toMillis()')).toBeTypeOf(
      "number",
    );
  });

  it("datetime: comparisons require the same date type", async () => {
    await expect(evaluate("now() > today()")).rejects.toThrow(/cannot compare instant and plaindate/);
    expect(await evaluate('toPlainDate("2024-01-01") < toPlainDate("2024-01-02")')).toBe(true);
  });

  it("typescript-api: async filters need the async path", async () => {
    const eng = createEngine({ filters: { later: async (v: Value): Promise<Value> => v } });
    await expect(eng.evaluate("later(1)")).rejects.toThrow(/is async/);
  });

  it("typescript-api: every Engine method throws ExpressionError", async () => {
    const failures: Array<() => Promise<Value> | Value> = [
      () => engine.render("${% if x %}a"),
      () => engine.render("${% endif %}"),
      () => engine.render("${% foo %}"),
      () => engine.render("${% for x in 5 %}a${% endfor %}"),
      () => engine.renderObject({ "...": "${{ 5 }}" }),
      () => engine.renderObject({ $if: "yes" }),
      () => engine.parse("a +"),
      () => engine.evaluate("null.x"),
      () => engine.compile("x + 1"),
    ];
    for (const fail of failures) {
      await expect(Promise.resolve().then(fail)).rejects.toBeInstanceOf(ExpressionError);
    }
  });
});

// ── YAML fence guard ──────────────────────────────────────────────────────────

/** Mapping keys (at any depth) that contain an expression span. */
function mangledKeys(value: Value, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => mangledKeys(item, `${path}[${i}]`));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    return [...(key.includes("${{") ? [here] : []), ...mangledKeys(child as Value, here)];
  });
}

describe.skipIf(referenceFiles.length === 0)("skill references — YAML fences", () => {
  it("parses every fenced YAML example except the marked bad ones", () => {
    const failures: string[] = [];
    let fences = 0;
    let exempted = 0;

    for (const file of referenceFiles) {
      const lines = readReference(file).split("\n");
      let inFence = false;
      let skip = false;
      let start = 0;
      let buffer: string[] = [];

      lines.forEach((line, index) => {
        if (!inFence && /^ {0,8}```ya?ml\s*$/.test(line)) {
          inFence = true;
          start = index + 2;
          buffer = [];
          skip = /yaml-example:\s*invalid/.test(lines[index + 1] ?? "");
          if (skip) buffer.push(lines[index + 1]);
          return;
        }
        if (inFence && line.trimStart().startsWith("```")) {
          inFence = false;
          if (skip) {
            exempted++;
            return;
          }
          fences++;
          const source = buffer.join("\n");
          try {
            const parsed = parseYaml(source, { logLevel: "silent" }) as Value;
            // An unquoted ": " inside a plain scalar silently becomes a nested
            // mapping whose key holds the expression — the failure mode the
            // embedding reference warns about, and one YAML accepts happily.
            const mangled = mangledKeys(parsed);
            if (mangled.length > 0) {
              failures.push(`${file}:${start} — unquoted ": " mangled ${mangled.join(", ")}`);
            }
          } catch (error) {
            failures.push(`${file}:${start} — ${String(error).split("\n")[0]}`);
          }
          return;
        }
        if (inFence) buffer.push(line);
      });
    }

    expect(failures).toEqual([]);
    // Guards against the extraction silently matching nothing.
    expect(fences).toBeGreaterThan(10);
    expect(exempted).toBeGreaterThan(0);
  });
});

// ── error codes and context rules ─────────────────────────────────────────────

describe.skipIf(referenceFiles.length === 0)("skill references — error codes, strict mode and limits", () => {
  const catalog = readReference("errors.md");

  it("errors.md lists every error code, and only error codes", () => {
    for (const code of ERROR_CODES) expect(catalog, code).toContain(`\`${code}\``);
    const listed = [...catalog.matchAll(/`(TAV_[A-Z_]+)`/g)].map((m) => m[1]);
    for (const code of listed) expect(ERROR_CODES, code).toContain(code);
  });

  it("errors.md quotes the message of every limit and every context problem", () => {
    const limits = [
      "Recursion depth limit 50 exceeded; raise maxDepth",
      "Iteration limit 1000000 exceeded; raise maxIterations",
      "Step limit 10000000 exceeded; raise maxSteps",
      "Evaluation timed out after 100 ms; raise timeoutMs",
      "Output size limit of 1048576 bytes exceeded; raise maxOutputBytes",
      "result exceeds 10000000 characters; raise maxStringLength",
    ];
    for (const message of limits) expect(catalog).toContain(message);
    const problems = [
      "is a function; Tavnit does not call functions from data (register a filter instead)",
      "is a BigInt; convert it to a number or a string",
      "is a symbol",
      "is an invalid Date",
      "Cannot serialise a value that contains a cycle; a context must be a tree",
      "is a Map; convert it with Object.fromEntries()",
      "is a Set; convert it with Array.from()",
      "is a Promise; await it before the call, or pass a resolve() root",
      "is an instance of Foo; pass a plain object, array, string, number, boolean, null or Date",
    ];
    for (const message of problems) expect(catalog).toContain(message);
  });

  it("errors.md quotes the null-access and strict messages the engine produces", async () => {
    const strict = createEngine({ strict: true });
    const message = async (source: string, context: Record<string, Value>): Promise<string> =>
      strict.evaluate(source, context).then(() => "", (e: ExpressionError) => e.message);
    expect(await message("a.b.c", { a: { b: null } })).toBe("`a.b` is null, cannot read `c`");
    expect(catalog).toContain("`a.b` is null, cannot read `c`");
    expect(await message("a[0]", { a: null })).toBe("`a` is null, cannot read an index");
    expect(catalog).toContain("`a.b` is null, cannot read an index");
    expect(await message("custmer", { customer: 1 })).toBe("Unknown name 'custmer'; did you mean 'customer'?");
    expect(catalog).toContain("Unknown name 'custmer'; did you mean 'customer'?");
    expect(await message("user.nmae", { user: { name: "A" } })).toBe("`user` has no property 'nmae'; did you mean 'name'?");
    expect(catalog).toContain("`user` has no property 'nmae'; did you mean 'name'?");
    expect(await message("items.length", { items: [] })).toBe("`items` has no property 'length'; use size(items) to count");
    expect(catalog).toContain("`items` has no property 'length'; use size(items) to count");
    expect(await message("1 / 0", {})).toBe('Division by zero; set divisionByZero to "infinity" to allow it');
    expect(catalog).toContain('Division by zero; set divisionByZero to "infinity" to allow it');
  });

  it("language: the strict-mode examples raise the documented errors", async () => {
    const strict = createEngine({ strict: true });
    await expect(strict.evaluate("custmer.name", { customer: { name: "Ann" } })).rejects.toThrow("Unknown name 'custmer'; did you mean 'customer'?");
    await expect(strict.evaluate("customer.nmae", { customer: { name: "Ann" } })).rejects.toThrow("`customer` has no property 'nmae'; did you mean 'name'?");
    await expect(strict.evaluate("items.length", { items: [1, 2] })).rejects.toThrow("`items` has no property 'length'; use size(items) to count");
    expect(await strict.evaluate("nickname", { nickname: null })).toBe(null);
    expect(await strict.evaluate('nickname ?? "none"', {})).toBe("none");
    expect(await strict.evaluate("items[5]", { items: [1] })).toBe(null);
    expect(await strict.evaluate("user?.nmae", { user: { name: "Ann" } })).toBe(null);
  });

  it("language: a Date in the context is an instant", async () => {
    const engine = createEngine();
    expect(await engine.render("${{ d }}", { d: new Date(Date.UTC(2026, 0, 2, 3, 4)) })).toBe("2026-01-02T03:04:00Z");
  });

  it("security: one budget per engine call, sized for 100 000 items", async () => {
    const engine = createEngine();
    const items = Array.from({ length: 100_000 }, (_, i) => i);
    expect(await engine.evaluate("a | map(x => x) | size", { a: items })).toBe(100_000);
    const shared = createEngine({ maxIterations: 10 });
    await expect(shared.render("${{ a | map(x => x) | size }}${{ a | map(x => x) | size }}", { a: items.slice(0, 6) })).rejects.toThrow("Iteration limit 10 exceeded");
  });

  it("security names both budgets and the opt-in timeout", () => {
    const security = readReference("security.md");
    expect(security).toContain("| `maxIterations` | 1 000 000 |");
    expect(security).toContain("| `maxSteps` | 10 000 000 |");
    expect(security).toContain("| `timeoutMs` | off |");
    expect(security).toContain("The unit of `maxIterations` is the engine call, not the loop.");
  });
});
