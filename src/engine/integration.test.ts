/**
 * End-to-end usage patterns through the public Engine API, many drawn from the
 * skill's examples. They complement the unit tests in engine.test.ts,
 * builtins.test.ts and datetime.test.ts without duplicating them.
 */

import { describe, expect, it } from "vitest";
import type { Value } from "../index.js";
import {
  createCache,
  createEngine,
  ExpressionError,
} from "../index.js";

// ── Quick Start ───────────────────────────────────────────────────────────────

describe("Quick Start examples", () => {
  it("renders Cyrillic context paths", async () => {
    const engine = createEngine();
    expect(await engine.render("${{ пробное.предмет }} — ${{ пробное.дата }}", {
      пробное: { предмет: "Вокал", дата: "28 сентября" },
    })).toBe("Вокал — 28 сентября");
  });

  it("evaluate returns the native type (number)", async () => {
    const engine = createEngine();
    const total = await engine.evaluate("price * qty", { price: 10, qty: 3 });
    expect(total).toBe(30);
    expect(typeof total).toBe("number");
  });

  it("custom filter 'usd' — direct call and pipe", async () => {
    const engine = createEngine({
      filters: {
        usd: (v: Value): Value => `$${Number(v).toFixed(2)}`,
      },
    });
    expect(await engine.evaluate("usd(price)", { price: 19.9 })).toBe("$19.90");
  });
});

// ── Quick Start — render() uses ${{ }} delimiters ─────────────────────────────

describe("Quick Start — render()", () => {
  it("render returns a string with substituted spans", async () => {
    const engine = createEngine();
    const path = await engine.render("/orders/${{ id }}/details", { id: 42 });
    expect(path).toBe("/orders/42/details");
  });

  it("custom filter 'usd' via pipe in render", async () => {
    const engine = createEngine({
      filters: {
        usd: (v: Value): Value => `$${Number(v).toFixed(2)}`,
      },
    });
    const label = await engine.render("Total: ${{ price | usd }}", {
      price: 19.9,
    });
    expect(label).toBe("Total: $19.90");
  });
});

// ── Embedding ─────────────────────────────────────────────────────────────────

describe("Embedding — expression mode", () => {
  it("preserves boolean type", async () => {
    const engine = createEngine();
    const result = await engine.evaluate("enabled", { enabled: true });
    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
  });

  it("preserves number — ?? falls back on null only", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("count ?? 0", { count: null })).toBe(0);
    expect(typeof await engine.evaluate("count ?? 0", { count: null })).toBe("number");
  });

  it("preserves object type", async () => {
    const engine = createEngine();
    const payload = { id: 1, name: "test" };
    const result = await engine.evaluate("payload", { payload });
    expect(result).toEqual(payload);
    expect(typeof result).toBe("object");
  });
});

describe("Embedding — text-embedding mode", () => {
  it("number span stringifies in text context", async () => {
    const engine = createEngine();
    expect(await engine.render("Max: ${{ limit }}", { limit: 200 })).toBe("Max: 200");
  });

  it("multiple independent spans", async () => {
    const engine = createEngine();
    const result = await engine.render(
      "Hello ${{ name }}, you have ${{ size(items) }} items",
      { name: "Alice", items: [1, 2, 3] },
    );
    expect(result).toBe("Hello Alice, you have 3 items");
  });

  it("$\\{{ escape emits literal ${{ without starting a span", async () => {
    const engine = createEngine();
    const result = await engine.render(
      String.raw`Use $\{{ expr }} to embed an expression`,
    );
    expect(result).toBe("Use ${{ expr }} to embed an expression");
  });

  it("span evaluation order does not affect result — independent spans", async () => {
    const engine = createEngine();
    const result = await engine.render("${{ a }} and ${{ b }}", {
      a: "first",
      b: "second",
    });
    expect(result).toBe("first and second");
  });

  it("objects stringify to JSON", async () => {
    const engine = createEngine();
    expect(
      await engine.render("${{ obj }}", { obj: { x: 1, y: 2 } }),
    ).toBe('{"x":1,"y":2}');
  });
});

// ── Operators ─────────────────────────────────────────────────────────────────

describe("Arithmetic operators", () => {
  it("price * qty", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("price * qty", { price: 10, qty: 3 })).toBe(30);
  });

  it("string concatenation with +", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate('firstName + " " + lastName', {
        firstName: "Jane",
        lastName: "Doe",
      }),
    ).toBe("Jane Doe");
  });

  it("grouped arithmetic (a + b) * c", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("(a + b) * c", { a: 2, b: 3, c: 4 })).toBe(20);
  });
});

describe("Comparison operators — strict equality", () => {
  it("== number equals number", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("count == 1", { count: 1 })).toBe(true);
  });

  it("== strict — string does not equal number", async () => {
    const engine = createEngine();
    expect(await engine.evaluate('count == "1"', { count: 1 })).toBe(false);
  });

  it("!= with 0 is not null", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("x != null", { x: 0 })).toBe(true);
  });
});

describe("Logical && / || / ?? operators", () => {
  it("&& short-circuits on falsy left operand", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("false && notDefined")).toBe(false);
  });

  it("|| falls back when left is falsy (0)", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("count || 200", { count: 0 })).toBe(200);
  });

  it("?? preserves 0 — falls back only on null", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("limit ?? 200", { limit: 0 })).toBe(0);
  });

  it("?? falls back on null", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("limit ?? 200", { limit: null })).toBe(200);
  });

  it("chained ?? — label ?? name ?? 'unknown'", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate('label ?? name ?? "unknown"', {
        label: null,
        name: null,
      }),
    ).toBe("unknown");
  });

  it("?? mixed with && without parens is rejected at parse time", () => {
    const engine = createEngine();
    expect(() => engine.parse("a ?? b && c")).toThrow(ExpressionError);
  });

  it("?? mixed with || without parens is rejected at parse time", () => {
    const engine = createEngine();
    expect(() => engine.parse("a ?? b || c")).toThrow(ExpressionError);
  });

  it("?? mixed with && with parens is accepted", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate("(a ?? false) && b", { a: true, b: true }),
    ).toBe(true);
  });
});

describe("Membership operator 'in'", () => {
  it('"urgent" in tags — found', async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate('"urgent" in tags', { tags: ["urgent", "new"] }),
    ).toBe(true);
  });

  it('"urgent" in tags — not found', async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate('"urgent" in tags', { tags: ["normal"] }),
    ).toBe(false);
  });

  it("id in allowedIds", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate("id in allowedIds", {
        id: 3,
        allowedIds: [1, 2, 3],
      }),
    ).toBe(true);
  });
});

describe("Ternary ? :", () => {
  it('enabled ? "on" : "off"', async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate('enabled ? "on" : "off"', { enabled: true }),
    ).toBe("on");
    expect(
      await engine.evaluate('enabled ? "on" : "off"', { enabled: false }),
    ).toBe("off");
  });

  it('count == 1 ? "item" : "items"', async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate('count == 1 ? "item" : "items"', { count: 1 }),
    ).toBe("item");
    expect(
      await engine.evaluate('count == 1 ? "item" : "items"', { count: 2 }),
    ).toBe("items");
  });
});

describe("Unary NOT", () => {
  it("!disabled", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("!disabled", { disabled: false })).toBe(true);
  });

  it("not disabled (keyword alias)", async () => {
    const engine = createEngine();
    expect(await engine.evaluate("not disabled", { disabled: true })).toBe(false);
  });

  it("keyword and symbolic forms mixed: active and not paused", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate("active and not paused", {
        active: true,
        paused: false,
      }),
    ).toBe(true);
  });
});

describe("Pipe operator", () => {
  it("value | fn(arg) is equivalent to fn(value, arg)", async () => {
    const engine = createEngine();
    const pipe = await engine.evaluate('config.model | default("gpt-4.1")', {
      config: { model: null },
    });
    const call = await engine.evaluate('default(config.model, "gpt-4.1")', {
      config: { model: null },
    });
    expect(pipe).toBe(call);
    expect(pipe).toBe("gpt-4.1");
  });

  it("multi-step pipe chain: filter → map → join", async () => {
    const engine = createEngine();
    const result = await engine.evaluate(
      'items | filter(x => x.active) | map(x => x.id) | join(",")',
      {
        items: [
          { id: 1, active: true },
          { id: 2, active: false },
          { id: 3, active: true },
        ],
      },
    );
    expect(result).toBe("1,3");
  });

  it("value | fn (no args) desugars to fn(value)", async () => {
    const engine = createEngine();
    expect(await engine.evaluate('"hello" | toUpperCase')).toBe("HELLO");
  });
});

describe("Optional chaining", () => {
  it("user?.contact?.email returns null when contact is null", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate("user?.contact?.email", {
        user: { contact: null },
      }),
    ).toBeNull();
  });

  it("user?.contact?.email ?? 'unknown' falls through", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate('user?.contact?.email ?? "unknown"', {
        user: { contact: null },
      }),
    ).toBe("unknown");
  });

  it("non-optional access on null throws ExpressionError", async () => {
    const engine = createEngine();
    await expect(
      engine.evaluate("user.contact", { user: null }),
    ).rejects.toThrow(ExpressionError);
  });
});

// ── let … in ─────────────────────────────────────────────────────────────────

describe("let … in — skill examples", () => {
  it("names a predicate and uses it twice without repeating", async () => {
    const engine = createEngine();
    const result = await engine.evaluate(
      "let eligible = x => x.active && x.balance > 0 in some(tariffs, eligible) && !every(tariffs, eligible)",
      {
        tariffs: [
          { active: true, balance: 100 },
          { active: false, balance: 0 },
          { active: true, balance: 50 },
        ],
      },
    );
    expect(result).toBe(true);
  });

  it("names an intermediate value to avoid recomputing", async () => {
    const engine = createEngine();
    const result = await engine.evaluate(
      "let subtotal = price * qty in subtotal > 0 ? subtotal : 0",
      { price: 5, qty: 3 },
    );
    expect(result).toBe(15);
  });

  it("multiple bindings — later bindings reference earlier ones", async () => {
    const engine = createEngine();
    // let base = price ?? 0, tax = base * 0.2 in base + tax
    const result = await engine.evaluate(
      "let base = price ?? 0, tax = base * 0.2 in base + tax",
      { price: 100 },
    );
    expect(result).toBeCloseTo(120);
  });
});

// ── Date comparison and arithmetic ────────────────────────────────────────────

describe("Date comparison and arithmetic — skill examples", () => {
  it("now() | subtract({ days: 3 }) produces an Instant", async () => {
    const engine = createEngine();
    const result = await engine.evaluate("now() | subtract({ days: 3 })");
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("today() | add({ days: 1 }) produces a PlainDate", async () => {
    const engine = createEngine();
    const result = await engine.evaluate("today() | add({ days: 1 })");
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("instant comparison: toInstant(a) > toInstant(b)", async () => {
    const engine = createEngine();
    // Use function-call form to avoid > vs | precedence ambiguity
    expect(
      await engine.evaluate(
        "toInstant(event_date) > toInstant(cutoff)",
        {
          event_date: "2030-01-01T00:00:00Z",
          cutoff: "2020-01-01T00:00:00Z",
        },
      ),
    ).toBe(true);
  });

  it("PlainDate comparison: tariff.startDate | toPlainDate() <= today", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate(
        'tariff.startDate | toPlainDate() <= plainDate("2099-12-31")',
        { tariff: { startDate: "2020-01-01" } },
      ),
    ).toBe(true);
  });

  it("format() with CLDR pattern dd.MM.yyyy", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate('plainDate("2024-01-15") | format("dd.MM.yyyy")'),
    ).toBe("15.01.2024");
  });

  it("parsePlainDate with dd.MM.yyyy pattern", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate(
        'parsePlainDate("15.03.2024", "dd.MM.yyyy") | format("yyyy-MM-dd")',
      ),
    ).toBe("2024-03-15");
  });

  it("toEpochSeconds vs toEpochMs differ by exactly 1000×", async () => {
    const engine = createEngine();
    const ms = (await engine.evaluate(
      'instant("2024-01-15T00:00:00Z") | toEpochMs()',
    )) as number;
    const secs = (await engine.evaluate(
      'instant("2024-01-15T00:00:00Z") | toEpochSeconds()',
    )) as number;
    expect(ms / secs).toBeCloseTo(1000);
  });

  it("fromEpochSeconds round-trips with toEpochSeconds", async () => {
    const engine = createEngine();
    expect(
      await engine.evaluate(
        'instant("2024-01-15T10:30:00Z") | toEpochSeconds() | fromEpochSeconds() | format()',
      ),
    ).toBe("2024-01-15T10:30:00Z");
  });

  it("filter messages newer than 3 days — skill pattern (function-call form)", async () => {
    // The skill shows:
    //   messages | filter(x => toInstant(x.date) > now() | subtract({ days: 3 }))
    // In Tavnit, > (lbp 40) binds tighter than | (lbp 5), so the correct form uses
    // subtract(now(), ...) or parentheses: toInstant(x.date) > (now() | subtract(...))
    const engine = createEngine();
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    const result = (await engine.evaluate(
      "messages | filter(x => toInstant(x.date) > subtract(now(), { days: 3 }))",
      {
        messages: [
          { id: 1, date: recent },
          { id: 2, date: cutoff },
          { id: 3, date: old },
        ],
      },
    )) as Array<{ id: number; date: string }>;

    expect(Array.isArray(result)).toBe(true);
    expect(result.map((m) => m.id)).toContain(1);
    expect(result.map((m) => m.id)).not.toContain(3);
  });
});

// ── Shared cache and parse() ──────────────────────────────────────────────────

describe("Shared expression cache", () => {
  it("parse() populates cache so subsequent evaluate() skips parsing", async () => {
    const engine = createEngine();
    engine.parse("price * qty");
    const result = await engine.evaluate("price * qty", { price: 7, qty: 6 });
    expect(result).toBe(42);
  });

  it("shared createCache() is hit across multiple engines", async () => {
    const cache = createCache();
    const engineA = createEngine({ cache });
    const engineB = createEngine({
      cache,
      filters: { double: (v) => (v as number) * 2 },
    });
    engineA.parse("double(x)");
    const result = await engineB.evaluate("double(x)", { x: 21 });
    expect(result).toBe(42);
  });
});

// ── Error location reporting ──────────────────────────────────────────────────

describe("Error location reporting", () => {
  it("evaluate() runtime error — location.line is 1 when present", async () => {
    const engine = createEngine();
    try {
      await engine.evaluate("null.prop");
      expect.fail("Should have thrown");
    } catch (e) {
      const err = e as ExpressionError;
      if (err.errors[0].location) {
        expect(err.errors[0].location.start.line).toBe(1);
      }
    }
  });

  it("render() error in a span on line 2 reports line >= 2", async () => {
    const engine = createEngine();
    try {
      await engine.render("first line\n${{ 1 + }}");
      expect.fail("Should have thrown");
    } catch (e) {
      const err = e as ExpressionError;
      expect(err.errors[0].location?.start.line).toBeGreaterThanOrEqual(2);
    }
  });

  it("render() error source is the full template string", async () => {
    const engine = createEngine();
    const template = "prefix ${{ 1 + }} suffix";
    try {
      await engine.render(template);
      expect.fail("Should have thrown");
    } catch (e) {
      const err = e as ExpressionError;
      expect(err.errors[0].location?.source).toBe(template);
    }
  });
});

// ── Exported types contract ───────────────────────────────────────────────────

describe("Exported public types", () => {
  it("ExpressionError is importable and instantiable from the package root", () => {
    const err = new ExpressionError([{ message: "test" }]);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("test");
    expect(err.errors).toHaveLength(1);
  });

  it("createEngine and createCache are importable from the package root", () => {
    expect(typeof createEngine).toBe("function");
    expect(typeof createCache).toBe("function");
  });

  it("createEngine() returns an object with the full Engine interface", () => {
    const engine = createEngine();
    expect(typeof engine.evaluate).toBe("function");
    expect(typeof engine.render).toBe("function");
    expect(typeof engine.parse).toBe("function");
    expect(typeof engine.compile).toBe("function");
    expect(typeof engine.derive).toBe("function");
  });
});
