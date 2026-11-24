import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createEngine } from "./engine/engine.js";
import { ExpressionError } from "./engine/types.js";
import { deserialiseValue, serialiseValue } from "./serialisation.js";
import { Temporal } from "./temporal-polyfill.js";
import { TavnitInstant, TavnitPlainDate, TavnitDuration } from "./evaluator/types.js";

const engine = createEngine();

/** Source text biased towards the characters the grammar actually uses. */
const sourceArb = fc.oneof(
  fc.string({ maxLength: 60 }),
  fc.stringMatching(/^[a-z0-9_.[\]()|+\-*/%<>=!&?:,'" {}$]{0,60}$/),
);

describe("properties", () => {
  it("parse() throws only ExpressionError", () => {
    fc.assert(
      fc.property(sourceArb, (src) => {
        try {
          engine.parse(src);
        } catch (e) {
          expect(e).toBeInstanceOf(ExpressionError);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("evaluate() rejects only with ExpressionError", async () => {
    await fc.assert(
      fc.asyncProperty(sourceArb, async (src) => {
        try {
          await engine.evaluate(src, { a: 1, b: "x", c: [1, 2, 3], d: { e: null } });
        } catch (e) {
          expect(e).toBeInstanceOf(ExpressionError);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("render() of arbitrary text throws only ExpressionError", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 60 }), async (tpl) => {
        try {
          await engine.render(tpl, {});
        } catch (e) {
          expect(e).toBeInstanceOf(ExpressionError);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("text without `${` renders unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 60 }).filter((s) => !s.includes("${")),
        async (text) => {
          expect(await engine.render(text, {})).toBe(text);
        },
      ),
    );
  });

  it("integer arithmetic matches JS", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -1e6, max: 1e6 }), fc.integer({ min: -1e6, max: 1e6 }), async (a, b) => {
        expect(await engine.evaluate("a + b", { a, b })).toBe(a + b);
        expect(await engine.evaluate("a - b", { a, b })).toBe(a - b);
        expect(await engine.evaluate("a * b", { a, b })).toBe(a * b);
      }),
    );
  });

  it("a string literal evaluates to itself", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), async (s) => {
        expect(await engine.evaluate("s", { s })).toBe(s);
      }),
    );
  });

  it("date/time wrappers survive serialise → JSON → deserialise", () => {
    const instant = fc
      .integer({ min: 0, max: 4e12 })
      .map((ms) => new TavnitInstant(Temporal.Instant.fromEpochMilliseconds(ms)));
    const date = fc
      .date({ min: new Date("1900-01-01"), max: new Date("2200-01-01"), noInvalidDate: true })
      .map((d) => new TavnitPlainDate(Temporal.PlainDate.from(d.toISOString().slice(0, 10))));
    const duration = fc
      .integer({ min: 0, max: 1e6 })
      .map((s) => new TavnitDuration(Temporal.Duration.from({ seconds: s })));
    fc.assert(
      fc.property(fc.oneof(instant, date, duration), (v) => {
        const wire = JSON.parse(JSON.stringify(serialiseValue(v)));
        const back = deserialiseValue(wire);
        expect(back).toBeInstanceOf(v.constructor);
        expect(JSON.stringify(serialiseValue(back))).toBe(JSON.stringify(serialiseValue(v)));
      }),
    );
  });

  it("reserved names are unreachable through any access form", async () => {
    const reserved = ["constructor", "__proto__", "prototype", "hasOwnProperty"];
    const targets = [{ x: 1 }, [1], "s"];
    for (const name of reserved) {
      for (const [i, access] of [`v.${name}`, `v['${name}']`, `v?.${name}`, `v.${name}.${name}`].entries()) {
        for (const v of targets) {
          await expect(engine.evaluate(access, { v }), `${access} #${i}`).rejects.toBeInstanceOf(ExpressionError);
        }
      }
    }
  });
});

describe("bounded work", () => {
  // Hostile text must end in a verdict inside the limit; a regular expression runs to the end, so these draw patterns too.
  const fast = createEngine({ timeoutMs: 200, maxIterations: 100_000 });
  const hostileArb = fc.oneof(
    sourceArb,
    fc.stringMatching(/^[()|+*?a-b]{1,12}$/).map((pattern) => `s | matches('${pattern}')`),
    fc.nat({ max: 3000 }).map((n) => `${"(".repeat(n)}1${")".repeat(n)}`),
    fc.nat({ max: 3000 }).map((n) => `1${"+1".repeat(n)}`),
  );

  it("any source ends in a value or an ExpressionError within the budget", async () => {
    await fc.assert(
      fc.asyncProperty(hostileArb, async (src) => {
        const started = performance.now();
        try {
          await fast.evaluate(src, { s: `${"a".repeat(30)}!`, a: 1 });
        } catch (e) {
          expect(e).toBeInstanceOf(ExpressionError);
        }
        expect(performance.now() - started).toBeLessThan(1000);
      }),
      { numRuns: 1000 },
    );
  });
});
