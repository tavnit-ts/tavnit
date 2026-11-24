import { describe, expect, it } from "vitest";
import { createEngine } from "../engine/engine.js";
import type { DataContext } from "../engine/types.js";
import { checkExpressionSource, checkTemplate, TAVNIT_TYPE_CODE as C, type TypeEnvironment } from "./check.js";
import {
  arrayOf, asNonEmpty, formatType, isNonEmptyArray, literalOf, NULL, NUMBER, nullable, objectOf, sameType, STRING, type TavProperty, type TavType,
  UNKNOWN, unionOf,
} from "./types.js";

const required = (type: TavType): TavProperty => ({ type, presence: "required" });
const optional = (type: TavType): TavProperty => ({ type, presence: "optional" });

const row = objectOf({ id: required(NUMBER) }, false);
const names: TypeEnvironment["names"] = {
  args: objectOf({
    name: required(STRING),
    note: optional(STRING),
    nick: required(nullable(STRING)),
    count: required(NUMBER),
    rows: required(arrayOf(row)),
    full: required(arrayOf(row, true)),
    maybe: required(nullable(arrayOf(row))),
    client: required(objectOf({ id: required(NUMBER) }, false)),
    address: optional(objectOf({ city: required(STRING) }, false)),
  }, false),
  nothing: NULL,
  anything: UNKNOWN,
};
const env: TypeEnvironment = { names, redundancy: true };

const codes = (source: string, environment: TypeEnvironment = env): string[] =>
  checkExpressionSource(source, environment).map((finding) => finding.code);

/** What the strict evaluator answers for the same expression: the checker's claims are held against it. */
const engine = createEngine();
const run = (source: string, data: DataContext): unknown => engine.evaluateSync(source, data);

const data = {
  args: { name: "n", note: "x", nick: null, count: 1, rows: [{ id: 7 }], full: [{ id: 7 }], maybe: null, client: { id: 1 } },
  nothing: null,
};
const emptyData = { ...data, args: { ...data.args, rows: [], maybe: [] } };

describe("schema refinements", () => {
  const refined: TypeEnvironment = { redundancy: true, names: { status: unionOf([literalOf("a"), literalOf("b")]),
    n: { kind: "number", minimum: 0, maximum: 100, integer: true }, name: { kind: "string", nonEmpty: true } } };

  it("finds excluded enum values and narrows the else branch", () => {
    expect(codes('status == "c"', refined)).toEqual([C.constantComparison]);
    expect(codes('status == "a" ? 1 : status == "a"', refined)).toEqual([C.constantComparison]);
    expect(codes('status == "a" ? status == "a" : 0', refined)).toEqual([C.constantComparison]);
    expect(codes('status == "a" ? 1 : status == "b"', refined)).toEqual([C.constantComparison]);
    expect(run('status == "c"', { status: "a" })).toBe(false);
  });

  it("leaves a comparison undecided when the admitted literals straddle it", () => {
    const environment: TypeEnvironment = { names: { n: unionOf([literalOf(1), literalOf(3)]), s: { kind: "string", nonEmpty: true } }, redundancy: true };
    expect(codes("n < 2", environment)).toEqual([]);
    expect(codes("s < 2", environment)).toEqual([]);
    expect(codes("s < 2", { names: { s: STRING }, redundancy: true })).toEqual([]);
    expect(codes("s in 2", environment)).toEqual([]);
    expect(codes('s == "x"', environment)).toEqual([]);
    expect(codes("n.x", { names: { n: literalOf(1) } })).toEqual([C.notAnObject]);
    expect(codes("n == 1 ? 0 : n", { names: { n: literalOf(1) }, redundancy: true })).toEqual([C.constantComparison]);
    expect(codes("n < 2", { names: { n: unionOf([literalOf("x"), literalOf(1)]) }, redundancy: true })).toEqual([]);
    expect(codes("n == 1", { names: { n: objectOf({}, false) }, redundancy: true })).toEqual([]);
    expect(codes('n == "x"', { names: { n: { kind: "number", minimum: 0 } }, redundancy: true })).toEqual([C.constantComparison]);
  });

  it("keeps uncertain range comparisons undecided", () => {
    const environment: TypeEnvironment = { names: { n: { kind: "number", minimum: 0, maximum: 10 } }, redundancy: true };
    for (const op of ["<", "<=", ">", ">="]) expect(codes(`n ${op} 5`, environment)).toEqual([]);
  });

  it("uses numeric limits and string length", () => {
    expect(codes("n < 0", refined)).toEqual([C.constantComparison]);
    expect(codes("n > 100", refined)).toEqual([C.constantComparison]);
    expect(codes("n == 1.5", refined)).toEqual([C.constantComparison]);
    expect(codes('name == ""', refined)).toEqual([C.constantComparison]);
    expect(run("n < 0", { n: 50 })).toBe(false);
    expect(run('name == ""', { name: "x" })).toBe(false);
  });

  it("keeps refinement identity in unions and formats it", () => {
    expect(sameType({ kind: "string", nonEmpty: true }, STRING)).toBe(false);
    expect(sameType({ kind: "string", nonEmpty: true }, { kind: "string", nonEmpty: true })).toBe(true);
    expect(sameType({ kind: "unknown" }, { kind: "unknown" })).toBe(true);
    expect(sameType({ kind: "number", minimum: 0 }, { kind: "number", minimum: 1 })).toBe(false);
    expect(sameType(literalOf("a"), literalOf("b"))).toBe(false);
    expect(formatType({ kind: "number", maximum: 10, exclusiveMaximum: true })).toBe("number[-∞, 10)]");
    expect(unionOf([literalOf("a"), literalOf("a")])).toEqual(literalOf("a"));
  });

  it("widens numeric literals after addition", () => {
    const environment: TypeEnvironment = { names: { n: literalOf(2), m: literalOf(3) }, redundancy: true };
    expect(codes("(n + m) == 4", environment)).toEqual([]);
    expect(codes("(n + 1) == 4", environment)).toEqual([]);
    expect(codes("(1 + n) == 4", environment)).toEqual([]);
    expect(run("n + m", { n: 2, m: 3 })).toBe(5);
  });

  it("checks both comparison directions and inclusive or exclusive endpoints", () => {
    const cases: Array<[TavType, string, boolean]> = [
      [{ kind: "number", minimum: 0 }, "n < 0", false],
      [{ kind: "number", minimum: 0, exclusiveMinimum: true }, "n <= 0", false],
      [{ kind: "number", minimum: 0 }, "n >= 0", true],
      [{ kind: "number", minimum: 0, exclusiveMinimum: true }, "n > 0", true],
      [{ kind: "number", maximum: 10 }, "n > 10", false],
      [{ kind: "number", maximum: 10, exclusiveMaximum: true }, "n >= 10", false],
      [{ kind: "number", maximum: 10 }, "n <= 10", true],
      [{ kind: "number", maximum: 10, exclusiveMaximum: true }, "n < 10", true],
      [{ kind: "number", minimum: 0 }, "0 > n", false],
      [{ kind: "number", maximum: 10 }, "10 < n", false],
      [literalOf(5), "n < 6", true],
      [literalOf(5), "n <= 5", true],
      [literalOf(5), "n > 4", true],
      [literalOf(5), "n >= 5", true],
      [literalOf(5), "5 < n", false],
    ];
    for (const [type, expression, expected] of cases) {
      const environment: TypeEnvironment = { names: { n: type }, redundancy: true };
      expect(codes(expression, environment), expression).toEqual([C.constantComparison]);
      expect(run(expression, { n: 5 }), expression).toBe(expected);
    }
  });
});

describe("redundancy is opt-in", () => {
  it("raises nothing unless the environment asks", () => {
    const quiet: TypeEnvironment = { names };
    for (const source of ["args.name ?? ''", "args.name != null", "args.rows ? 1 : 2", "nothing ?? 1", "args.full | first ?? 1"]) {
      expect(codes(source, quiet), source).toEqual([]);
    }
  });

  it("never repeats a finding that already throws", () => {
    // The plain read of an optional property is TAV101; the type it then has says nothing more.
    expect(codes("args.note == null")).toEqual([C.absentProperty]);
    expect(codes("args.address ? 1 : 2")).toEqual([C.absentProperty]);
    expect(codes("!args.address")).toEqual([C.absentProperty]);
  });
});

describe("TAV201: a '??' whose left side is never null", () => {
  it("reports a required, non-null property and points at the fallback", () => {
    const [finding] = checkExpressionSource("args.name ?? ''", env);
    expect(finding).toMatchObject({ code: C.redundantCoalesce, severity: "warning", access: "args.name", receiverType: "string" });
    expect(finding.start).toEqual({ line: 1, column: 14 });
    expect(finding.message).toContain("'args.name' is string");
    expect(finding.hint).toBe("args.name");
  });

  it("accepts every left side that can be null or absent", () => {
    expect(codes("args.note ?? ''")).toEqual([]);
    expect(codes("args.nick ?? ''")).toEqual([]);
    expect(codes("args.maybe ?? []")).toEqual([]);
    expect(codes("args.address?.city ?? ''")).toEqual([]);
    expect(codes("args.rows | first ?? 0")).toEqual([]);
    expect(codes("args.rows[0] ?? 0")).toEqual([]);
    expect(codes("anything ?? 1")).toEqual([]);
    expect(codes("args.nope ?? 1")).toEqual([C.nullCoalesce]);
  });

  it("reports a literal, a call result and a chained second fallback", () => {
    expect(codes("1 ?? 2")).toEqual([C.redundantCoalesce]);
    expect(codes("args.rows | size ?? 0")).toEqual([C.redundantCoalesce]);
    expect(codes("(args.note ?? '') ?? 'x'")).toEqual([C.redundantCoalesce]);
    expect(codes("args.note ?? args.name ?? ''")).toEqual([C.redundantCoalesce]);
  });

  it("reports a value a guard proved present", () => {
    expect(codes("args.nick ? (args.nick ?? '') : ''")).toEqual([C.redundantCoalesce]);
    expect(codes("args.nick != null ? (args.nick ?? '') : ''")).toEqual([C.redundantCoalesce]);
    expect(codes("args.nick ? 1 : (args.nick ?? '')")).toEqual([]);
  });

  it("reports the first element of an array known to be non-empty, and only that", () => {
    expect(codes("args.full | first ?? 0")).toEqual([C.redundantCoalesce]);
    expect(codes("args.full[0] ?? 0")).toEqual([C.redundantCoalesce]);
    expect(codes("args.full | last ?? 0")).toEqual([C.redundantCoalesce]);
    expect(codes("args.full[1] ?? 0")).toEqual([]);
    expect(codes("args.full | filter(r => r.id > 1) | first ?? 0")).toEqual([]);
    expect(codes("size(args.rows) > 0 ? (args.rows | first ?? 0) : 0")).toEqual([C.redundantCoalesce]);
  });

  it("agrees with the strict evaluator: the fallback is never what comes out", () => {
    expect(run("args.name ?? 'fallback'", data)).toBe("n");
    expect(run("args.full | first ?? 'fallback'", data)).toEqual({ id: 7 });
  });
});

describe("TAV202: a '??' whose left side is always null", () => {
  it("reports null, a null-typed name and a key the object never has", () => {
    expect(codes("nothing ?? 1")).toEqual([C.nullCoalesce]);
    expect(codes("null ?? 1")).toEqual([C.nullCoalesce]);
    expect(codes("args.client.nope ?? 1")).toEqual([C.nullCoalesce]);
    expect(run("nothing ?? 'fallback'", data)).toBe("fallback");
  });

  it("says which side is dead", () => {
    const [finding] = checkExpressionSource("nothing ?? 1", env);
    expect(finding.message).toBe("'nothing' is always null, so '??' always takes the right side.");
    expect(finding.start).toEqual({ line: 1, column: 1 });
  });
});

describe("TAV203: a null test the types decide", () => {
  it("reports == and != on a value that is never null", () => {
    expect(codes("args.name != null")).toEqual([C.constantNullTest]);
    expect(codes("args.name == null")).toEqual([C.constantNullTest]);
    expect(codes("null != args.count")).toEqual([C.constantNullTest]);
    expect(codes("args.rows != null")).toEqual([C.constantNullTest]);
  });

  it("states the fixed answer, and the strict evaluator agrees", () => {
    const messages = (source: string): string[] => checkExpressionSource(source, env).map((finding) => finding.message);
    expect(messages("args.name != null")).toEqual(["'args.name' is string and is never null, so this comparison is always true."]);
    expect(messages("args.name == null")).toEqual(["'args.name' is string and is never null, so this comparison is always false."]);
    expect(run("args.name != null", data)).toBe(true);
    expect(run("args.name == null", data)).toBe(false);
  });

  it("reports a value that is always null", () => {
    expect(messagesOf("nothing == null")).toEqual(["'nothing' is always null, so this comparison is always true."]);
    expect(messagesOf("nothing != null")).toEqual(["'nothing' is always null, so this comparison is always false."]);
    expect(run("nothing == null", data)).toBe(true);
  });

  it("leaves a value that can be null, an unknown one and a null-to-null comparison alone", () => {
    expect(codes("args.nick != null")).toEqual([]);
    expect(codes("args.maybe == null")).toEqual([]);
    expect(codes("args.rows[0] != null")).toEqual([]);
    expect(codes("args.address?.city != null")).toEqual([]);
    expect(codes("anything != null")).toEqual([]);
    expect(codes("null == null")).toEqual([]);
    expect(codes("args.name == args.count")).toEqual([]);
    expect(codes("args.name == 'x'")).toEqual([]);
  });

  it("reports the test once a guard has made the value present", () => {
    expect(codes("args.nick != null ? args.nick != null : false")).toEqual([C.constantNullTest]);
    expect(codes("args.nick == null ? 0 : (args.nick == null ? 1 : 2)")).toEqual([C.constantNullTest]);
  });

  it("reports the head of an array known to be non-empty", () => {
    expect(codes("args.full | first != null")).toEqual([C.constantNullTest]);
    expect(codes("args.rows | first != null")).toEqual([]);
  });
});

describe("TAV204: a condition the type decides", () => {
  it("reports an array: always truthy, even when empty, and the strict evaluator agrees", () => {
    const [finding] = checkExpressionSource("args.rows ? 1 : 2", env);
    expect(finding.code).toBe(C.constantCondition);
    expect(finding.message).toBe("'args.rows' is { id: number }[], which is always truthy, even when empty, so this condition never varies.");
    expect(finding.hint).toBe("size(args.rows) > 0");
    expect(run("args.rows ? 1 : 2", emptyData)).toBe(1);
  });

  it("reports an object, a null and each operator that tests a truth value", () => {
    expect(codes("args.client ? 1 : 2")).toEqual([C.constantCondition]);
    expect(codes("nothing ? 1 : 2")).toEqual([C.constantCondition]);
    expect(codes("args.rows && args.count")).toEqual([C.constantCondition]);
    expect(codes("args.rows || args.count")).toEqual([C.constantCondition]);
    expect(codes("!args.rows")).toEqual([C.constantCondition]);
    expect(codes("!nothing")).toEqual([C.constantCondition]);
    expect(codes("[1] ? 1 : 2")).toEqual([C.constantCondition]);
    expect(codes("{ 'a': 1 } ? 1 : 2")).toEqual([C.constantCondition]);
  });

  it("describes null apart from the always-truthy kinds", () => {
    const [finding] = checkExpressionSource("nothing ? 1 : 2", env);
    expect(finding.message).toBe("'nothing' is always null, so this condition is always false.");
    expect(finding.hint).toBeUndefined();
  });

  it("leaves a condition whose truth varies", () => {
    expect(codes("args.name ? 1 : 2")).toEqual([]);
    expect(codes("args.count ? 1 : 2")).toEqual([]);
    expect(codes("args.nick ? 1 : 2")).toEqual([]);
    expect(codes("args.maybe ? 1 : 2")).toEqual([]);
    expect(codes("args.address?.city ? 1 : 2")).toEqual([]);
    expect(codes("anything ? 1 : 2")).toEqual([]);
    expect(codes("size(args.rows) > 0 ? 1 : 2")).toEqual([]);
    expect(codes("args.name == 'x' && args.count > 1")).toEqual([]);
  });

  it("reports a function as always truthy, without the 'even when empty' remark", () => {
    const [finding] = checkExpressionSource("(x => x) ? 1 : 2", env);
    expect(finding.code).toBe(C.constantCondition);
    expect(finding.message).toBe("'value' is function, which is always truthy, so this condition never varies.");
  });

  it("reports the condition and not the branches", () => {
    expect(codes("args.rows ? (args.note ?? 'a') : 'b'")).toEqual([C.constantCondition]);
  });
});

describe("non-empty arrays: where the checker learns them", () => {
  const head = (source: string): string[] => codes(source, { names, redundancy: false });

  it("takes a non-empty array from the type of the name or from a literal", () => {
    expect(head("args.full | first | str")).toEqual([]);
    expect(head("args.full[0].id")).toEqual([]);
    expect(head("(args.full | first).id")).toEqual([]);
    expect(head("[args.client][0].id")).toEqual([]);
    expect(head("(args.rows | first).id")).toEqual([C.nullReceiver]);
    expect(head("args.rows[0].id")).toEqual([C.nullReceiver]);
  });

  it("knows only the first index", () => {
    expect(head("args.full[1].id")).toEqual([C.nullReceiver]);
    expect(head("args.full[args.count].id")).toEqual([C.nullReceiver]);
  });

  it.each([
    "size(args.rows) > 0",
    "size(args.rows) >= 1",
    "size(args.rows) != 0",
    "size(args.rows) == 1",
    "size(args.rows) > 2",
    "0 < size(args.rows)",
    "1 <= size(args.rows)",
    "0 != size(args.rows)",
    "(args.rows | size) > 0",
    "args.rows | filled",
    "filled(args.rows)",
    "!isEmpty(args.rows)",
    "!blank(args.rows)",
    "!(size(args.rows) == 0)",
    "!(size(args.rows) <= 0)",
    "size(args.rows) > 0 && args.count > 0",
  ])("narrows to non-empty under %s", (guard) => {
    expect(head(`${guard} ? first(args.rows).id : 0`)).toEqual([]);
    expect(head(`${guard} ? args.rows[0].id : 0`)).toEqual([]);
    expect(head(`${guard} ? 0 : first(args.rows).id`)).toEqual([C.nullReceiver]);
    expect(run(`${guard} ? first(args.rows).id : 0`, emptyData)).toBe(0);
    expect(run(`${guard} ? first(args.rows).id : 0`, data)).toBe(run(guard, data) ? 7 : 0);
  });

  it.each([
    "size(args.rows) == 0",
    "size(args.rows) <= 0",
    "size(args.rows) < 1",
    "size(args.rows) <= 3",
    "size(args.rows) < 3",
    "size(args.rows) >= 0",
    "size(args.rows) != 1",
    "size(args.rows) > 0 || args.count > 0",
    "isEmpty(args.rows)",
    "blank(args.rows)",
    "!filled(args.rows)",
  ])("learns nothing from %s in the branch it names", (guard) => {
    expect(head(`${guard} ? first(args.rows).id : 0`)).toEqual([C.nullReceiver]);
  });

  it.each([
    "size(args.rows) == 0",
    "size(args.rows) <= 0",
    "size(args.rows) < 1",
    "isEmpty(args.rows)",
    "blank(args.rows)",
    "!filled(args.rows)",
    "args.count > 1 && size(args.rows) == 0",
  ])("learns the other branch of %s", (guard) => {
    if (guard.includes("&&")) return;
    expect(head(`${guard} ? 0 : first(args.rows).id`)).toEqual([]);
    expect(run(`${guard} ? 0 : first(args.rows).id`, emptyData)).toBe(0);
  });

  it("reads a null array as empty: size(null) is 0, so a size above 0 proves it is there", () => {
    expect(head("size(args.maybe) > 0 ? first(args.maybe).id : 0")).toEqual([]);
    expect(head("size(args.maybe) > 0 ? args.maybe[0].id : 0")).toEqual([]);
    expect(head("first(args.maybe).id")).toEqual([C.nullArgument, C.nullReceiver]);
    expect(run("size(args.maybe) > 0 ? 1 : 0", data)).toBe(0);
    expect(run("filled(args.maybe)", data)).toBe(false);
    expect(run("isEmpty(args.maybe)", data)).toBe(true);
  });

  it("follows a guard through && and a nested ternary", () => {
    expect(head("size(args.rows) > 0 && first(args.rows).id > 1")).toEqual([]);
    expect(head("args.count > 0 ? (size(args.rows) > 0 ? first(args.rows).id : 1) : 2")).toEqual([]);
    expect(head("size(args.rows) > 0 || first(args.rows).id > 1")).toEqual([C.nullReceiver]);
  });

  it("follows a size bound to a name, and drops it when the array is rebound", () => {
    expect(head("let n = size(args.rows) in n > 0 ? first(args.rows).id : 0")).toEqual([]);
    expect(head("let n = args.rows | size in n != 0 ? first(args.rows).id : 0")).toEqual([]);
    expect(head("let n = size(args.rows) in 0 < n ? args.rows[0].id : 0")).toEqual([]);
    expect(head("let n = size(args.rows), args = { 'rows': args.rows } in n > 0 ? first(args.rows).id : 0")).toEqual([C.nullReceiver]);
    expect(head("let n = size(args.rows) in n > 1 ? first(args.rows).id : 0")).toEqual([]);
    expect(head("let n = args.count in n > 0 ? first(args.rows).id : 0")).toEqual([C.nullReceiver]);
  });

  it("follows a head bound to a name only through the size beside it", () => {
    expect(head("let h = args.rows | first, n = args.rows | size in n == 0 ? 0 : h.id")).toEqual([]);
    expect(head("let h = first(args.rows), n = size(args.rows) in n == 0 ? 0 : h.id")).toEqual([]);
    expect(head("let h = args.rows | first in h.id")).toEqual([C.nullReceiver]);
  });

  it("reads emptiness tests only in their one-argument form over a lookup", () => {
    expect(head("filled(args.rows, 1) ? first(args.rows).id : 0")).toEqual([C.nullReceiver]);
    expect(head("(args.rows | filled(1)) ? first(args.rows).id : 0")).toEqual([C.nullReceiver]);
    expect(head("filled(args.count + 1) ? first(args.rows).id : 0")).toEqual([C.nullReceiver]);
    expect(head("(args.rows | size) ? first(args.rows).id : 0")).toEqual([C.nullReceiver]);
  });

  it("reads a null fallback, a reversed zero test and a relation that is not a size", () => {
    expect(head("(args.note ?? null) != null ? args.note : ''")).toEqual([]);
    expect(head("null != (args.note ?? null) ? args.note : ''")).toEqual([]);
    expect(head("(args.note ?? '') ? 1 : 2")).toEqual([]);
    expect(head("let h = first(args.rows), n = size(args.rows) in 0 != n ? h.id : 0")).toEqual([]);
    expect(head("let h = first(args.rows), m = 3 in m == 0 ? 0 : h.id")).toEqual([C.nullReceiver]);
  });

  it("leaves a lookup that names no path alone: a variable subscript has nothing to refine", () => {
    const grid: TypeEnvironment = { names: { rows: arrayOf(arrayOf(row)), i: NUMBER }, redundancy: true };
    const found = (source: string): string[] => checkExpressionSource(source, grid).map((finding) => finding.code);
    expect(found("size(rows[i]) > 0 ? 1 : 0")).toEqual([]);
    expect(found("filled(rows[i]) ? 1 : 0")).toEqual([]);
    // Nothing is refined, so `rows[i]` stays nullable for the call that rejects null.
    expect(found("!isEmpty(rows[i]) ? first(rows[i]) : 0")).toEqual([C.nullArgument]);
    expect(found("let n = size(rows[i]) in n > 0 ? 1 : 0")).toEqual([]);
  });

  it("leaves a size of something that is not a lookup alone", () => {
    expect(head("size(args.rows | filter(r => r.id > 1)) > 0 ? first(args.rows).id : 0")).toEqual([C.nullReceiver]);
    expect(head("size(args.count) > 0 ? first(args.rows).id : 0")).toEqual([C.nullReceiver]);
    expect(head("size(args.rows) > args.count ? first(args.rows).id : 0")).toEqual([C.nullReceiver]);
  });

  it("does not turn a string or an object into an array", () => {
    const strings: TypeEnvironment = { names: { text: STRING, bag: objectOf({ a: required(NUMBER) }, false) } };
    expect(checkExpressionSource("size(text) > 0 ? text.length : 0", strings).map((f) => f.code)).toEqual([C.notAnObject]);
    expect(checkExpressionSource("size(bag) > 0 ? bag.a : 0", strings)).toEqual([]);
  });

  it("keeps the narrowed array in a later read of the same path", () => {
    const probe = (source: string): string | undefined => checkExpressionSource(`(${source}).probe`, env)[0]?.receiverType;
    expect(probe("size(args.rows) > 0 ? args.rows : args.full")).toBe("[{ id: number }, ...{ id: number }[]]");
  });
});

describe("non-empty arrays: which built-ins keep them", () => {
  const typeOf = (source: string): string => {
    const [finding] = checkExpressionSource(`(${source}).probe`, { names });
    return finding?.receiverType ?? "none";
  };
  const rowsType = "[{ id: number }, ...{ id: number }[]]";

  it("keeps the length of map, sort, reverse and uniqBy", () => {
    expect(typeOf("args.full | map(r => r.id)")).toBe("[number, ...number[]]");
    expect(typeOf("args.full | sort(r => r.id)")).toBe(rowsType);
    expect(typeOf("args.full | reverse")).toBe(rowsType);
    expect(typeOf("args.full | uniqBy(r => r.id)")).toBe(rowsType);
    expect(typeOf("args.rows | map(r => r.id)")).toBe("number[]");
    expect(typeOf("args.rows | reverse")).toBe("{ id: number }[]");
  });

  it("is empty-able after filter, slice and compact", () => {
    expect(typeOf("args.full | filter(r => r.id > 1)")).toBe("{ id: number }[]");
    expect(typeOf("args.full | slice(1)")).toBe("{ id: number }[]");
    expect(typeOf("args.full | compact")).toBe("{ id: number }[]");
  });

  it("makes concat non-empty when either side is", () => {
    expect(typeOf("args.rows | concat([1])")).toBe("[unknown, ...unknown[]]");
    expect(typeOf("args.full | concat([])")).toBe("[unknown, ...unknown[]]");
    expect(typeOf("args.rows | concat([])")).toBe("unknown[]");
  });

  it("matches the evaluator on a non-empty input", () => {
    const sample = { xs: [{ id: 2 }, { id: 1 }] };
    for (const source of ["xs | map(r => r.id)", "xs | sort(r => r.id)", "xs | reverse", "xs | uniqBy(r => r.id)", "xs | concat([])"]) {
      expect((run(source, sample) as unknown[]).length, source).toBeGreaterThan(0);
    }
    // And the built-ins the checker does not keep are the ones that can come out empty.
    expect(run("xs | filter(r => r.id > 5)", sample)).toEqual([]);
    expect(run("xs | slice(5)", sample)).toEqual([]);
    expect(run("[null] | compact", {})).toEqual([]);
  });

  it("types first and last as the element, without null, over a non-empty array", () => {
    expect(typeOf("args.full | first")).toBe("{ id: number }");
    expect(typeOf("args.full | last")).toBe("{ id: number }");
    expect(typeOf("args.rows | first")).toBe("{ id: number } | null");
    expect(typeOf("args.full | map(r => r.id) | first")).toBe("number");
    expect(typeOf("args.full | filter(r => r.id > 1) | first")).toBe("{ id: number } | null");
    expect(typeOf("[1, 2] | first")).toBe("number");
    // The element of an empty literal is unknown, which asserts nothing.
    expect(typeOf("[] | first")).toBe("none");
  });

  it("keeps the element null when the array holds nulls", () => {
    const withNulls: TypeEnvironment = { names: { xs: arrayOf(nullable(NUMBER), true) } };
    const [finding] = checkExpressionSource("(xs | first).probe", withNulls);
    expect(finding.receiverType).toBe("number | null");
  });
});

describe("the type itself", () => {
  const rows = arrayOf(NUMBER);
  const full = arrayOf(NUMBER, true);

  it("tells a non-empty array from an array", () => {
    expect(sameType(rows, full)).toBe(false);
    expect(sameType(full, arrayOf(NUMBER, true))).toBe(true);
    expect(sameType(rows, arrayOf(NUMBER, false))).toBe(true);
    expect(unionOf([rows, full])).toMatchObject({ kind: "union" });
    expect(unionOf([full, arrayOf(NUMBER, true)])).toBe(full);
  });

  it("answers isNonEmptyArray for every member of a union and for null", () => {
    expect(isNonEmptyArray(full)).toBe(true);
    expect(isNonEmptyArray(rows)).toBe(false);
    expect(isNonEmptyArray(nullable(full))).toBe(true);
    expect(isNonEmptyArray(unionOf([full, rows]))).toBe(false);
    expect(isNonEmptyArray(unionOf([full, STRING]))).toBe(false);
    expect(isNonEmptyArray(NULL)).toBe(false);
    expect(isNonEmptyArray(UNKNOWN)).toBe(false);
    expect(isNonEmptyArray(undefined)).toBe(false);
  });

  it("marks only the array members non-empty", () => {
    expect(asNonEmpty(rows)).toEqual(full);
    expect(asNonEmpty(unionOf([rows, STRING]))).toEqual(unionOf([full, STRING]));
    expect(asNonEmpty(STRING)).toBe(STRING);
  });

  it("prints a non-empty array as a tuple head and a rest", () => {
    expect(formatType(full)).toBe("[number, ...number[]]");
    expect(formatType(arrayOf(unionOf([NUMBER, STRING]), true))).toBe("[number | string, ...(number | string)[]]");
    expect(formatType(rows)).toBe("number[]");
  });
});

describe("in a template", () => {
  it("positions a finding inside the template text", () => {
    const template = "Hello, ${{ args.name ?? 'guest' }}!\n${{ args.rows ? 'rows' : 'none' }}";
    const found = checkTemplate(template, env);
    expect(found.map((finding) => finding.code)).toEqual([C.redundantCoalesce, C.constantCondition]);
    expect(found[0].start).toEqual({ line: 1, column: 25 });
    expect(found[1].start.line).toBe(2);
  });

  it("raises no redundancy finding inside a block tag, where no fix can address it", () => {
    expect(checkTemplate("${% if true %}${{ args.name ?? 'x' }}${% endif %}", env)).toEqual([]);
    expect(checkTemplate("${% if args.rows %}a${% endif %}", env)).toEqual([]);
  });
});

describe("a comparison with a literal other than null", () => {
  it("does not make the other side present when it is false", () => {
    const environment: TypeEnvironment = {
      redundancy: true,
      names: { args: objectOf({ action: required(nullable(objectOf({ type: required(STRING) }, false))) }, false) },
    };
    const found = (source: string): string[] => checkExpressionSource(source, environment).map((finding) => finding.code);
    expect(found("args.action?.type == 'G' ? 1 : (args.action == null ? 0 : 2)")).toEqual([]);
    expect(found("args.action?.type != 'G' ? (args.action == null ? 0 : 2) : 1")).toEqual([]);
    expect(found("args.action?.type == 'G' ? (args.action == null ? 0 : 2) : 1")).toEqual([C.constantNullTest]);
  });
});


function messagesOf(source: string): string[] {
  return checkExpressionSource(source, env).map((finding) => finding.message);
}
