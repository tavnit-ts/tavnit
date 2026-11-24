import { describe, expect, it } from "vitest";
import { resolve } from "../evaluator/types.js";
import { createEngine } from "./engine.js";
import { type Diagnostic, ExpressionError, type Value } from "./types.js";

const lenient = createEngine({ strict: false });
const strict = createEngine({ strict: true });

/** The single diagnostic of the ExpressionError `run` rejects with. */
async function diagnosticOf(run: () => Promise<Value | string>): Promise<Diagnostic> {
  const error = await run().then(
    () => { throw new Error("expected a rejection"); },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ExpressionError);
  return (error as ExpressionError).errors[0];
}

describe("the default is strict", () => {
  it("raises on a missing name and a missing field with no options", async () => {
    const engine = createEngine();
    await expect(engine.evaluate("zzz", {})).rejects.toThrow("Unknown name 'zzz'");
    await expect(engine.evaluate("user.name", { user: {} })).rejects.toThrow("has no property 'name'");
    await expect(engine.render("${{ typo }}", {})).rejects.toThrow("Unknown name 'typo'");
  });

  it("raises on division by zero with no options", async () => {
    const engine = createEngine();
    await expect(engine.evaluate("1 / 0")).rejects.toThrow("Division by zero");
    await expect(engine.evaluate("5 % 0")).rejects.toThrow("Modulo by zero");
  });

  it("allows Infinity under the default strict mode with divisionByZero: infinity", async () => {
    const engine = createEngine({ divisionByZero: "infinity" });
    expect(await engine.evaluate("1 / 0")).toBe(Number.POSITIVE_INFINITY);
    await expect(engine.evaluate("typo", {})).rejects.toThrow("Unknown name");
  });

  it("restores the lenient reading with strict: false", async () => {
    const engine = createEngine({ strict: false });
    expect(await engine.evaluate("zzz", {})).toBe(null);
    expect(await engine.evaluate("1 / 0")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("lenient mode (strict: false)", () => {
  it("reads a missing name, a missing field and a property of an array as null", async () => {
    expect(await lenient.evaluate("zzz", {})).toBe(null);
    expect(await lenient.evaluate("user.name", { user: {} })).toBe(null);
    expect(await lenient.evaluate("a.length", { a: [1, 2] })).toBe(null);
    expect(await lenient.evaluate("s.length", { s: "abc" })).toBe(null);
    expect(await lenient.render("${{ typo }}", {})).toBe("");
  });

  it("divides by zero as JavaScript does", async () => {
    expect(await lenient.evaluate("1 / 0")).toBe(Number.POSITIVE_INFINITY);
    expect(await lenient.evaluate("0 / 0")).toBeNaN();
    expect(await lenient.evaluate("5 % 0")).toBeNaN();
  });
});

describe("strict mode: names and fields", () => {
  it("raises on an unknown root name and suggests the nearest", async () => {
    const diagnostic = await diagnosticOf(() => strict.evaluate("custmer.name", { customer: { name: "Ann" } }));
    expect(diagnostic.message).toBe("Unknown name 'custmer'; did you mean 'customer'?");
    expect(diagnostic.code).toBe("TAV_UNKNOWN_NAME");
    expect(diagnostic.access).toBe("custmer");
  });

  it("offers no suggestion when nothing is near", async () => {
    const diagnostic = await diagnosticOf(() => strict.evaluate("zzzzzz", { customer: 1 }));
    expect(diagnostic.message).toBe("Unknown name 'zzzzzz'");
  });

  it("suggests a name in scope: a lambda parameter", async () => {
    const diagnostic = await diagnosticOf(() => strict.evaluate("items | map(item => itme)", { items: [1] }));
    expect(diagnostic.message).toBe("Unknown name 'itme'; did you mean 'item'?");
  });

  it("raises on a field the object does not have and suggests the nearest", async () => {
    const diagnostic = await diagnosticOf(() => strict.evaluate("customer.nmae", { customer: { name: "Ann" } }));
    expect(diagnostic.message).toBe("`customer` has no property 'nmae'; did you mean 'name'?");
    expect(diagnostic.code).toBe("TAV_UNKNOWN_PROPERTY");
    expect(diagnostic.access).toBe("customer.nmae");
  });

  it("raises on a missing key of an indexed object", async () => {
    const diagnostic = await diagnosticOf(() => strict.evaluate('m["zz"]', { m: { aa: 1 } }));
    expect(diagnostic.message).toBe("`m` has no property 'zz'");
  });

  it("raises on a property of an array or a string, and points to size()", async () => {
    expect((await diagnosticOf(() => strict.evaluate("a.length", { a: [1, 2] }))).message)
      .toBe("`a` has no property 'length'; use size(a) to count");
    expect((await diagnosticOf(() => strict.evaluate("s.length", { s: "abc" }))).message)
      .toBe("`s` has no property 'length'; use size(s) to count");
  });

  it("gives no hint for another property of an array", async () => {
    expect((await diagnosticOf(() => strict.evaluate("a.foo", { a: [1] }))).message).toBe("`a` has no property 'foo'");
  });

  it("points to size() for a receiver that is no plain path", async () => {
    expect((await diagnosticOf(() => strict.evaluate("[1, 2].length"))).message).toBe("A value of type array has no property 'length'; use size(value) to count");
  });

  it("raises on a property of a number, a boolean and a date", async () => {
    expect((await diagnosticOf(() => strict.evaluate("n.x", { n: 1 }))).message).toBe("`n` has no property 'x'");
    expect((await diagnosticOf(() => strict.evaluate("now().x"))).message).toBe("A value of type instant has no property 'x'");
  });

  it("raises in a text template, in template coordinates", async () => {
    const diagnostic = await diagnosticOf(() => strict.render("a\nb ${{ typo }}", {}));
    expect(diagnostic.code).toBe("TAV_UNKNOWN_NAME");
    expect(diagnostic.location?.start).toEqual({ line: 2, column: 7 });
  });

  it("raises on the async path as well", async () => {
    const context = { state: resolve(async () => 1), customer: { name: "Ann" } };
    await expect(strict.evaluate("[state.x, custmer]", context)).rejects.toThrow("Unknown name 'custmer'; did you mean 'customer'?");
    await expect(strict.evaluate("[state.x, customer.nmae]", context)).rejects.toThrow("has no property 'nmae'");
    expect(await strict.evaluate("[state.x, customer.name]", context)).toEqual([1, "Ann"]);
  });

  it("raises through a value tree", async () => {
    await expect(strict.renderObject({ a: "${{ typo }}" }, {})).rejects.toThrow("Unknown name 'typo'");
  });
});

describe("strict mode: what stays valid", () => {
  it("reads a name that is present with the value null", async () => {
    expect(await strict.evaluate("nickname", { nickname: null })).toBe(null);
    expect(await strict.evaluate("user.nickname", { user: { nickname: null } })).toBe(null);
  });

  it("reads a name the host passed as undefined as null", async () => {
    expect(await strict.evaluate("nickname", { nickname: undefined as never })).toBe(null);
  });

  it("lets the left side of ?? name its default", async () => {
    expect(await strict.evaluate('nickname ?? "none"', {})).toBe("none");
    expect(await strict.evaluate('user.nickname ?? "none"', { user: {} })).toBe("none");
    expect(await strict.evaluate("m[key] ?? 0", { m: {}, key: "k" })).toBe(0);
    expect(await strict.render('${{ typo ?? "x" }}', {})).toBe("x");
  });

  it("keeps ?? lenient only on its left side", async () => {
    await expect(strict.evaluate("1 ?? typo2", {})).resolves.toBe(1);
    await expect(strict.evaluate("null ?? typo2", {})).rejects.toThrow("Unknown name 'typo2'");
    await expect(strict.evaluate('(a.length ?? 0) + b', { a: [1], b: 1 })).resolves.toBe(1);
    await expect(strict.evaluate("size(typo2) ?? 0", {})).rejects.toThrow("Unknown name 'typo2'");
  });

  it("applies the same rule on the async path", async () => {
    const context = { state: resolve(async () => 1) };
    expect(await strict.evaluate('[state.x, typo ?? "d"]', context)).toEqual([1, "d"]);
  });

  it("reads a missing key, a null receiver and an unknown name through ?. as null", async () => {
    expect(await strict.evaluate("user?.nmae", { user: { name: "Ann" } })).toBe(null);
    expect(await strict.evaluate("user?.[k]", { user: { name: "Ann" }, k: "nmae" })).toBe(null);
    expect(await strict.evaluate("user?.name", { user: null })).toBe(null);
    expect(await strict.evaluate("nobody?.name")).toBe(null);
    expect(await strict.evaluate("a.b?.c", { a: {} })).toBe(null);
  });

  it("treats a context key set to undefined as absent", async () => {
    const context = { present: 1, gone: undefined } as unknown as Record<string, number>;
    const absent = createEngine({ strict: true, undefinedIsAbsent: true });
    await expect(absent.evaluate("gone", context)).rejects.toThrow("Unknown name 'gone'");
    expect(await absent.evaluate("gone ?? 5", context)).toBe(5);
    expect(await absent.evaluate("gone?.x", context)).toBe(null);
    expect(await absent.evaluate("present", context)).toBe(1);
    expect(await createEngine({ strict: false, undefinedIsAbsent: true }).evaluate("gone", context)).toBe(null);
    // The default is the documented reading: the key is a name, and it reads as null.
    expect(await strict.evaluate("gone", context)).toBe(null);
    // derive() inherits the option.
    await expect(absent.derive({}).evaluate("gone", context)).rejects.toThrow("Unknown name 'gone'");
  });

  it("reads ?. on a number or a boolean as null", async () => {
    expect(await strict.evaluate("n?.error", { n: 5 })).toBe(null);
    expect(await strict.evaluate("b?.allow", { b: true })).toBe(null);
    expect(await strict.evaluate("n?.[k]", { n: 5, k: "x" })).toBe(null);
    await expect(strict.evaluate("n.error", { n: 5 })).rejects.toThrow("has no property 'error'");
  });

  it("reads ?. on an array or a string as null, where a plain . points to size()", async () => {
    expect(await strict.evaluate("items?.length", { items: [1] })).toBe(null);
    expect(await strict.evaluate("items?.[5]", { items: [1] })).toBe(null);
    expect(await strict.evaluate("items?.[0]", { items: [7] })).toBe(7);
    expect(await strict.evaluate("s?.size", { s: "abc" })).toBe(null);
    await expect(strict.evaluate("items.length", { items: [1] })).rejects.toThrow("use size(items)");
  });

  it("keeps a plain . strict behind ?.", async () => {
    await expect(strict.evaluate("user?.name.first", { user: { name: {} } })).rejects.toThrow("has no property 'first'");
    expect(await strict.evaluate("user?.name ?? 'none'", { user: {} })).toBe("none");
  });

  it("reads an array index out of range as null", async () => {
    expect(await strict.evaluate("items[5]", { items: [1] })).toBe(null);
  });

  it("resolves a built-in name used as a value", async () => {
    expect(await strict.evaluate("items | map(str)", { items: [1] })).toEqual(["1"]);
  });

  it("still names the path of a null receiver", async () => {
    const diagnostic = await diagnosticOf(() => strict.evaluate("a.b.c", { a: { b: null } }));
    expect(diagnostic.message).toBe("`a.b` is null, cannot read `c`");
  });
});

describe("division by zero", () => {
  it("is an error in strict mode by default", async () => {
    const diagnostic = await diagnosticOf(() => strict.evaluate("1 / 0"));
    expect(diagnostic.message).toBe('Division by zero; set divisionByZero to "infinity" to allow it');
    expect(diagnostic.code).toBe("TAV_DIVISION_BY_ZERO");
    await expect(strict.evaluate("0 / 0")).rejects.toThrow("Division by zero");
    await expect(strict.evaluate("5 % 0")).rejects.toThrow('Modulo by zero; set divisionByZero to "infinity" to allow it');
    await expect(strict.evaluate("n / m", { n: 1, m: 0 })).rejects.toThrow("Division by zero");
  });

  it("is an error in lenient mode with divisionByZero: error", async () => {
    const engine = createEngine({ strict: false, divisionByZero: "error" });
    await expect(engine.evaluate("1 / 0")).rejects.toThrow("Division by zero");
    expect(await engine.evaluate("user.nmae", { user: {} })).toBe(null);
  });

  it("yields Infinity in strict mode with divisionByZero: infinity", async () => {
    const engine = createEngine({ strict: true, divisionByZero: "infinity" });
    expect(await engine.evaluate("1 / 0")).toBe(Number.POSITIVE_INFINITY);
    expect(await engine.evaluate("-1 / 0")).toBe(Number.NEGATIVE_INFINITY);
    expect(await engine.evaluate("0 / 0")).toBeNaN();
    await expect(engine.evaluate("typo", {})).rejects.toThrow("Unknown name");
  });

  it("divides by a non-zero number as before", async () => {
    expect(await strict.evaluate("6 / 4")).toBe(1.5);
    expect(await strict.evaluate("7 % 4")).toBe(3);
  });
});

describe("derive", () => {
  it("inherits strict and divisionByZero", async () => {
    const child = strict.derive({ filters: { one: () => 1 } });
    await expect(child.evaluate("typo", {})).rejects.toThrow("Unknown name");
    await expect(child.evaluate("1 / 0")).rejects.toThrow("Division by zero");
    const infinite = createEngine({ divisionByZero: "infinity", strict: true }).derive();
    expect(await infinite.evaluate("1 / 0")).toBe(Number.POSITIVE_INFINITY);
  });

  it("overrides strict, and divisionByZero follows the new mode unless it was set", async () => {
    const relaxed = strict.derive({ strict: false });
    expect(await relaxed.evaluate("typo", {})).toBe(null);
    expect(await relaxed.evaluate("1 / 0")).toBe(Number.POSITIVE_INFINITY);
    const tightened = lenient.derive({ strict: true });
    await expect(tightened.evaluate("typo", {})).rejects.toThrow("Unknown name");
    await expect(tightened.evaluate("1 / 0")).rejects.toThrow("Division by zero");
  });

  it("overrides divisionByZero alone", async () => {
    const child = strict.derive({ divisionByZero: "infinity" });
    expect(await child.evaluate("1 / 0")).toBe(Number.POSITIVE_INFINITY);
    await expect(child.evaluate("typo", {})).rejects.toThrow("Unknown name");
  });

  it("keeps a lenient parent lenient", async () => {
    expect(await lenient.derive().evaluate("typo", {})).toBe(null);
  });

  it("keeps a default parent strict", async () => {
    await expect(createEngine().derive().evaluate("typo", {})).rejects.toThrow("Unknown name");
  });
});
