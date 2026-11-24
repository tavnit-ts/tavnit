import { describe, expect, it } from "vitest";
import { createEngine } from "../engine/engine.js";
import { parse } from "../parser/parse.js";
import type { Value } from "../engine/types.js";
import { BUILTIN_SIGNATURES } from "./builtins.js";
import { checkExpressionSource, checkTemplate, TAVNIT_TYPE_CODE, type TypeEnvironment } from "./check.js";
import {
  arrayOf, BOOLEAN, formatType, NULL, NUMBER, nullable, objectOf, sameType, STRING, type TavProperty, type TavType, UNKNOWN, unionOf,
  withoutNull,
} from "./types.js";

const required = (type: TavType): TavProperty => ({ type, presence: "required" });
const optional = (type: TavType): TavProperty => ({ type, presence: "optional" });

const address = objectOf({ city: required(STRING), zip: optional(STRING) }, false);
const client = objectOf({
  name: required(STRING),
  nick: required(nullable(STRING)),
  address: optional(address),
  tags: optional(arrayOf(STRING)),
}, false);
const environment: TypeEnvironment = {
  names: {
    args: objectOf({
      client: required(client),
      note: optional(STRING),
      rows: required(arrayOf(objectOf({ id: required(NUMBER), label: optional(STRING) }, false))),
      free: required(objectOf({ known: required(STRING) }, true)),
      blob: required(objectOf({}, true)),
      count: required(NUMBER),
    }, false),
    flag: BOOLEAN,
    nothing: NULL,
    anything: UNKNOWN,
  },
};

const codes = (source: string, env: TypeEnvironment = environment): string[] =>
  checkExpressionSource(source, env).map((finding) => `${finding.code}:${finding.severity}`);

describe("reading a property", () => {
  it("accepts a required property, nested", () => {
    expect(codes("args.client.name")).toEqual([]);
    expect(codes("args.count + 1")).toEqual([]);
  });

  it("reports a plain read of an optional property as an error", () => {
    expect(codes("args.note")).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
    expect(codes("args.client.address")).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
  });

  it("reports a `.` on an optional object, at both steps under `??`", () => {
    expect(codes("args.client.address.city")).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
    // `??` reads the absent `address` as null; the `.city` on that null still throws.
    expect(codes('args.client.address.city ?? ""')).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
  });

  it("accepts each guard", () => {
    expect(codes("args.note ?? ''")).toEqual([]);
    expect(codes("args.note?.length")).toEqual([]);
    expect(codes('args.client.address?.city ?? ""')).toEqual([]);
    expect(codes('args.client.address?.zip?.length ?? 0')).toEqual([]);
  });

  it("reports a `.` on a required but nullable value", () => {
    expect(codes("args.client.nick.length")).toEqual([
      `${TAVNIT_TYPE_CODE.nullReceiver}:error`,
      `${TAVNIT_TYPE_CODE.notAnObject}:error`,
    ]);
    expect(codes("args.client.nick")).toEqual([]);
    expect(codes("args.client.nick?.length")).toEqual([]);
  });

  it("reports an undeclared property of a closed object as an error and of an open object as a warning", () => {
    const env: TypeEnvironment = { names: { v: objectOf({ known: required(STRING) }, true) } };
    expect(codes("args.client.nik")).toEqual([`${TAVNIT_TYPE_CODE.undeclaredProperty}:error`]);
    expect(codes("v.anything", env)).toEqual([`${TAVNIT_TYPE_CODE.openProperty}:warning`]);
    expect(codes("v?.anything", env)).toEqual([]);
    expect(codes("v.anything ?? 1", env)).toEqual([]);
  });

  it("treats an open object that declares nothing as free-form", () => {
    expect(codes("args.blob.anything")).toEqual([]);
    expect(codes("args.blob.anything.deeper.still")).toEqual([]);
  });

  it("gives an unknown receiver no finding", () => {
    expect(codes("anything.a.b.c")).toEqual([]);
  });

  it("reports a property of a primitive or an array", () => {
    expect(codes("args.rows.length")).toEqual([`${TAVNIT_TYPE_CODE.notAnObject}:error`]);
    expect(codes("args.client.name.length")).toEqual([`${TAVNIT_TYPE_CODE.notAnObject}:error`]);
  });

  it("leaves a union of an object and a primitive to a type test", () => {
    const env: TypeEnvironment = { names: { either: unionOf([STRING, objectOf({ a: required(NUMBER) }, false)]) } };
    expect(codes("either.a", env)).toEqual([]);
    expect(codes("either.b", env)).toEqual([`${TAVNIT_TYPE_CODE.undeclaredProperty}:error`]);
  });

  it("reports a null receiver", () => {
    expect(codes("nothing.a")).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
  });
});

describe("indexes", () => {
  it("reads an array element as the element type or null", () => {
    expect(codes("args.rows[0].id")).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    expect(codes("args.rows[0]?.id")).toEqual([]);
    expect(codes("(args.rows | first)?.id")).toEqual([]);
    expect(codes("(args.rows | first).id")).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
  });

  it("treats a string key like a property", () => {
    expect(codes('args.client["name"]')).toEqual([]);
    expect(codes('args.client["address"]')).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
  });

  it("reports a subscript that can be null", () => {
    const env: TypeEnvironment = { names: { index: objectOf({}, true), id: nullable(STRING) } };
    expect(codes("index[id]", env)).toEqual([`${TAVNIT_TYPE_CODE.nullKey}:error`]);
    expect(codes('index[id ?? ""]', env)).toEqual([]);
  });
});

describe("narrowing", () => {
  it("recognizes a false fallback in a truthy guard", () => {
    expect(codes("(args.note ?? null) && args.note")).toEqual([]);
    expect(codes("(args.note ?? 'yes') && args.note")).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
  });

  it("recognizes a nonempty trim result after an empty fallback", () => {
    expect(codes("trim(args.note ?? '') == '' ? '' : trim(args.note)")).toEqual([]);
    expect(codes("trim(args.note ?? 'default') == '' ? '' : trim(args.note)")).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
  });

  it("recognizes a positive number after a nonpositive fallback", () => {
    expect(codes("num(args.count ?? 0) > 0 ? num(args.count) : 0")).toEqual([]);
    expect(codes("num(args.note ?? 0) > 0 ? num(args.note) : 0")).toEqual([]);
    expect(codes("num(args.note ?? 1) > 0 ? num(args.note) : 0")).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
  });

  it("recognizes a first element after a size check", () => {
    const env: TypeEnvironment = { names: { rows: arrayOf(objectOf({ id: required(NUMBER) }, false)) } };
    expect(codes("let head = first(rows), n = size(rows) in n == 0 ? 0 : head.id", env)).toEqual([]);
    expect(codes("let head = first(rows), n = size(rows) in n != 0 ? head.id : 0", env)).toEqual([]);
    expect(codes("let head = first(rows), n = size(rows) in n == 0 ? head.id : 0", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    const nullableRows: TypeEnvironment = { names: { rows: arrayOf(nullable(objectOf({ id: required(NUMBER) }, false))) } };
    expect(codes("let head = first(rows), n = size(rows) in n == 0 ? 0 : head.id", nullableRows)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
  });
  it("narrows the branches of a ternary", () => {
    expect(codes("args.client.nick ? args.client.nick.length : 0")).toEqual([`${TAVNIT_TYPE_CODE.notAnObject}:error`]);
    expect(codes("args.client.nick != null ? args.client.nick : ''")).toEqual([]);
    expect(codes("args.client.nick == null ? '' : args.client.nick | trim")).toEqual([]);
  });

  it("narrows an optional chain used as a guard", () => {
    expect(codes('args.client.address?.zip ? args.client.address.zip : ""')).toEqual([]);
    expect(codes('args.client.address ? 1 : 0')).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
  });

  it("narrows the right side of `&&` and `||`", () => {
    expect(codes("args.client.nick && (args.client.nick | trim)")).toEqual([]);
    expect(codes("!args.client.nick || (args.client.nick | trim)")).toEqual([]);
    expect(codes("args.client.nick | trim")).toEqual([`${TAVNIT_TYPE_CODE.nullArgument}:error`]);
  });

  it("ends narrowing when a lambda rebinds the root", () => {
    const env: TypeEnvironment = { names: { x: nullable(objectOf({ a: required(NUMBER) })), list: arrayOf(nullable(objectOf({ a: required(NUMBER) }))) } };
    expect(codes("x ? list | map(x => x.a) : []", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    expect(codes("x ? x.a : 0", env)).toEqual([]);
  });
});

describe("built-ins and callbacks", () => {
  it("reports a null argument of a built-in that rejects it", () => {
    expect(codes("args.client.nick | trim")).toEqual([`${TAVNIT_TYPE_CODE.nullArgument}:error`]);
    expect(codes('(args.client.nick ?? "") | trim')).toEqual([]);
    expect(codes("args.client.nick | str")).toEqual([]);
    expect(codes("args.client.nick | size")).toEqual([]);
  });

  it("passes the element type into a callback", () => {
    expect(codes("args.rows | map(r => r.id)")).toEqual([]);
    expect(codes("args.rows | map(r => r.label)")).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
    expect(codes('args.rows | map(r => r.label ?? "")')).toEqual([]);
    expect(codes("args.rows | filter(r => r.id > 1) | map(r => r.nope)")).toEqual([`${TAVNIT_TYPE_CODE.undeclaredProperty}:error`]);
  });

  it("types a built-in result", () => {
    expect(codes("(args.client.name | toUpperCase).length")).toEqual([`${TAVNIT_TYPE_CODE.notAnObject}:error`]);
    expect(codes("(args.rows | map(r => r.id))[0] + 1")).toEqual([]);
  });

  it("uses a host function result and leaves an unknown function unknown", () => {
    const env: TypeEnvironment = { ...environment, functions: { lookup: { result: nullable(objectOf({ a: required(STRING) })) } } };
    expect(codes("lookup(1).a", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    expect(codes("lookup(1)?.a", env)).toEqual([]);
    expect(codes("mystery(1).a.b")).toEqual([]);
  });
});

describe("names and let", () => {
  it("reports a missing name only in a closed environment", () => {
    expect(codes("missing.a")).toEqual([]);
    expect(codes("missing.a", { ...environment, closed: true })).toEqual([`${TAVNIT_TYPE_CODE.unknownName}:error`]);
    expect(codes("missing ?? 1", { ...environment, closed: true })).toEqual([]);
  });

  it("types a let binding by its value", () => {
    expect(codes("let a = args.client.address in a.city")).toEqual([`${TAVNIT_TYPE_CODE.absentProperty}:error`]);
    expect(codes("let a = args.client.address ?? null in a?.city")).toEqual([]);
  });
});

describe("templates", () => {
  it("maps a finding to template positions", () => {
    const template = "Hi ${{ args.client.name }}, ${{ args.note }}!";
    const [finding] = checkTemplate(template, environment);
    expect(finding.code).toBe(TAVNIT_TYPE_CODE.absentProperty);
    expect(template.slice(finding.start.column - 1, finding.end.column - 1)).toBe("note");
  });

  const blockCodes = (template: string): string[] => checkTemplate(template, environment).map((finding) => finding.code);

  it("checks the condition of an if and an elif block", () => {
    const template = "${% if args.note %}a${% endif %}";
    const [finding] = checkTemplate(template, environment);
    expect(finding.code).toBe(TAVNIT_TYPE_CODE.absentProperty);
    expect(template.slice(finding.start.column - 1, finding.end.column - 1)).toBe("note");
    expect(blockCodes("${% if args.count %}a${% elif args.note %}b${% endif %}")).toEqual([TAVNIT_TYPE_CODE.absentProperty]);
    expect(blockCodes("${% if args?.note %}a${% endif %}")).toEqual([]);
    expect(blockCodes("${% if (args.note ?? null) %}a${% endif %}")).toEqual([]);
  });

  it("agrees with the strict evaluator on a block condition", async () => {
    const engine = createEngine();
    await expect(engine.render("${% if args.note %}a${% endif %}", { args: {} })).rejects.toThrow("no property 'note'");
    await expect(engine.render("${% if args?.note %}a${% endif %}", { args: {} })).resolves.toBe("");
    await expect(engine.render("${% if (args.note ?? null) %}a${% endif %}", { args: {} })).resolves.toBe("");
  });

  it("checks the iterable of a for block", () => {
    expect(blockCodes("${% for tag in args.client.tags %}${{ tag }}${% endfor %}")).toEqual([TAVNIT_TYPE_CODE.absentProperty]);
    expect(blockCodes("${% for tag in args.client.tags ?? [] %}${{ tag }}${% endfor %}")).toEqual([]);
  });

  it("checks a block body under the block's condition", () => {
    expect(blockCodes("${% if args.count %}${{ args.note }}${% endif %}")).toEqual([TAVNIT_TYPE_CODE.absentProperty]);
    expect(blockCodes("${% if args?.note %}${{ args.note }}${% endif %}")).toEqual([]);
    expect(blockCodes("${% if args?.note %}a${% else %}${{ args.note }}${% endif %}")).toEqual([TAVNIT_TYPE_CODE.absentProperty]);
  });

  it("reads a for variable and forloop as unknown inside the body", () => {
    expect(blockCodes("${% for row in args.rows %}${{ row.anything }} ${{ forloop.index1 }}${% endfor %}")).toEqual([]);
    expect(checkTemplate("${% for x in args.rows %}${{ x.a }}${% endfor %}", { ...environment, closed: true })).toEqual([]);
    expect(blockCodes("${% if args?.note %}${% for args in args.rows %}${{ args.note }}${% endfor %}${% endif %}")).toEqual([]);
  });

  it("yields no findings for a template that does not parse", () => {
    expect(checkTemplate("${{ a + }}", environment)).toEqual([]);
  });
});

// The checker mirrors the evaluator. These cases run the strict evaluator on data the contract permits
// and require the checker to agree: an error where the data throws, none where it does not.
describe("agreement with the strict evaluator", () => {
  const engine = createEngine();
  const cases: Array<[string, Value, boolean]> = [
    ["args.note", { args: {} }, true],
    ["args.note", { args: { note: "x" } }, false],
    ["args.note ?? ''", { args: {} }, false],
    ["args.client.address.city ?? ''", { args: { client: {} } }, true],
    ["args.client.address?.city ?? ''", { args: { client: {} } }, false],
    ["args.client.address?.city ?? ''", { args: { client: { address: { city: "x" } } } }, false],
    ["args.free.k", { args: { free: {} } }, true],
    ["args.free?.k", { args: { free: {} } }, false],
    ["args.rows[0].id", { args: { rows: [] } }, true],
    ["args.rows[0]?.id", { args: { rows: [] } }, false],
  ];
  for (const [source, data, throws] of cases) {
    it(`${source} on ${JSON.stringify(data)}`, async () => {
      const outcome = await engine.evaluate(source, data).then(() => false, () => true);
      expect(outcome).toBe(throws);
      // The checker looks at the contract, not at the data: it reports when some permitted value throws.
      const contract = checkExpressionSource(source, environment).length > 0;
      if (throws) expect(contract).toBe(true);
    });
  }
});

describe("built-in signatures", () => {
  const engine = createEngine();
  const sample: Record<string, string> = {
    includes: '"a"', startsWith: '"a"', endsWith: '"a"', split: '"a"', replace: '"a", "b"', replaceAll: '"a", "b"',
    remove: '"a"', append: '"a"', padStart: "3", padEnd: "3", truncate: "3", join: '","', joinFilled: '","',
    map: "x => x", filter: "x => x", find: "x => x", some: "x => x", every: "x => x", flatMap: "x => x",
    groupBy: "x => x", keyBy: "x => x", uniqBy: "x => x", slice: "0", concat: "[1]", pick: '["a"]', omit: '["a"]',
  };
  for (const [name, signature] of Object.entries(BUILTIN_SIGNATURES)) {
    if (signature.rejectsNull !== true) continue;
    it(`${name}() rejects a null first argument`, async () => {
      const call = `n | ${name}(${sample[name] ?? ""})`;
      await expect(engine.evaluate(call, { n: null })).rejects.toThrow();
    });
  }
  for (const [name, signature] of Object.entries(BUILTIN_SIGNATURES)) {
    if (signature.rejectsNull === true) continue;
    it(`${name}() accepts a null first argument`, async () => {
      await expect(engine.evaluate(`n | ${name}`, { n: null })).resolves.not.toBeUndefined();
    });
  }
});

describe("value shapes", () => {
  const typeOf = (source: string, env: TypeEnvironment = environment): string => {
    // A probe: reading a property of the value reports its type as the receiver type.
    const [finding] = checkExpressionSource(`(${source}).probe`, env);
    return finding?.receiverType ?? "none";
  };

  it("types literals, array and object literals", () => {
    expect(typeOf("1")).toBe("number");
    expect(typeOf("'a'")).toBe("string");
    expect(typeOf("true")).toBe("boolean");
    expect(typeOf("[1, 2]")).toBe("[number, ...number[]]");
    expect(typeOf("[]")).toBe("unknown[]");
    expect(typeOf("[1, 'a']")).toBe("[number | string, ...(number | string)[]]");
    expect(typeOf("{ 'a': 1, 'b': 'x' }")).toBe("{ a: number, b: string }");
    expect(typeOf("{}")).toBe("{}");
  });

  it("types operators", () => {
    expect(typeOf("1 + 1")).toBe("number");
    expect(typeOf("'a' + 1")).toBe("none"); // unknown: no finding
    expect(typeOf("2 * 3 - 1")).toBe("number");
    expect(typeOf("1 < 2")).toBe("boolean");
    expect(typeOf("!flag")).toBe("boolean");
    expect(typeOf("-args.count")).toBe("number");
    expect(typeOf("flag && 1")).toBe("none"); // a union of primitives is left to a type test
    expect(typeOf("flag || 'a'")).toBe("none");
    expect(typeOf("flag ? 1 : 'a'")).toBe("none");
    expect(typeOf("x => 1")).toBe("none");
  });

  it("formats optional, undecided and open properties", () => {
    const env: TypeEnvironment = {
      names: {
        v: objectOf({ a: optional(NUMBER), b: { type: STRING, presence: "unknown" } }, true),
        e: arrayOf(nullable(STRING)),
      },
    };
    expect(typeOf("v", env)).toBe("{ a?: number, b??: string, ... }");
    expect(typeOf("e", env)).toBe("(string | null)[]");
  });

  it("sees through a union of objects and treats equal unions as equal", () => {
    const one = objectOf({ a: required(NUMBER) }, false);
    const env: TypeEnvironment = { names: { u: unionOf([one, objectOf({ b: required(NUMBER) }, false)]), w: unionOf([one, one]) } };
    expect(codes("u.a", env)).toEqual([`${TAVNIT_TYPE_CODE.undeclaredProperty}:error`]);
    expect(codes("w.a", env)).toEqual([]);
    expect(sameType(unionOf([NUMBER, STRING]), unionOf([STRING, NUMBER]))).toBe(true);
    expect(sameType(arrayOf(NUMBER), arrayOf(STRING))).toBe(false);
    expect(sameType(objectOf({ a: required(NUMBER) }), objectOf({ a: optional(NUMBER) }))).toBe(false);
    expect(sameType(objectOf({ a: required(NUMBER) }), objectOf({ b: required(NUMBER) }))).toBe(false);
    expect(sameType({ kind: "function", result: NUMBER }, { kind: "function", result: NUMBER })).toBe(true);
    expect(unionOf([])).toEqual(UNKNOWN);
    expect(unionOf([NUMBER, UNKNOWN])).toEqual(UNKNOWN);
    expect(withoutNull(NULL)).toEqual(UNKNOWN);
    expect(formatType({ kind: "function", result: NUMBER })).toBe("function");
  });

  it("reads past an index on a nullable array and on an unknown receiver", () => {
    const env: TypeEnvironment = { names: { list: nullable(arrayOf(NUMBER)), any: UNKNOWN, text: STRING } };
    expect(codes("list[0]", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    expect(codes("list?.[0]", env)).toEqual([]);
    expect(codes("any[0].a", env)).toEqual([]);
    expect(codes("text[0]", env)).toEqual([]);
    expect(codes("(args.rows)[0].id", env)).toEqual([]);
  });

  it("makes a lenient read of an undeclared or optional property null", () => {
    expect(codes("args.client.address?.city", environment)).toEqual([]);
    expect(codes("(args.client.nik) ?? 1", environment)).toEqual([]);
    expect(codes("args.client.name?.size", environment)).toEqual([]);
    expect(codes("(args.client.tags ?? [])[0]", environment)).toEqual([]);
  });

  it("warns on a property of undecided presence, and not under a guard", () => {
    const env: TypeEnvironment = { names: { v: objectOf({ b: { type: STRING, presence: "unknown" } }, false) } };
    expect(codes("v.b", env)).toEqual([`${TAVNIT_TYPE_CODE.unknownPresence}:warning`]);
    expect(codes("v.b ?? ''", env)).toEqual([]);
  });

  it("narrows with == against a literal and with a swapped comparison", () => {
    const env: TypeEnvironment = { names: { n: nullable(objectOf({ a: required(NUMBER) })) } };
    expect(codes("n == 1 ? n.a : 0", env)).toEqual([]);
    expect(codes("1 == n ? n.a : 0", env)).toEqual([]);
    expect(codes("null != n ? n.a : 0", env)).toEqual([]);
    expect(codes("n == null ? 0 : n.a", env)).toEqual([]);
    expect(codes("n == null ? n.a : 0", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    expect(codes("n != flag ? n.a : 0", { names: { ...env.names, flag: BOOLEAN } })).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    expect(codes("n > 1 ? n.a : 0", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    expect(codes("-n ? n.a : 0", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    expect(codes("n and n.a", env)).toEqual([]);
    expect(codes("not n or n.a", env)).toEqual([]);
    expect(codes("(1 + 1) ? n.a : 0", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
  });

  it("narrows through a conjunction and a disjunction of several guards", () => {
    const env: TypeEnvironment = { names: { a: nullable(objectOf({ x: required(NUMBER) })), b: nullable(objectOf({ y: required(NUMBER) })) } };
    expect(codes("a && b ? a.x + b.y : 0", env)).toEqual([]);
    expect(codes("!a || !b ? 0 : a.x + b.y", env)).toEqual([]);
    expect(codes("a || b ? a.x : 0", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
    expect(codes("!(a && b) ? a.x : 0", env)).toEqual([`${TAVNIT_TYPE_CODE.nullReceiver}:error`]);
  });

  it("narrows an index path with a string key", () => {
    const env: TypeEnvironment = { names: { m: objectOf({ k: required(nullable(objectOf({ a: required(NUMBER) }))) }, false) } };
    expect(codes('m["k"] ? m["k"].a : 0', env)).toEqual([]);
    expect(codes("m.k ? m.k.a : 0", env)).toEqual([]);
    expect(codes("(m | str) ? 1 : 0", env)).toEqual([]);
  });

  it("types every built-in result", () => {
    const rows = arrayOf(objectOf({ id: required(NUMBER) }, false));
    const env: TypeEnvironment = { names: { rows, text: STRING, bag: objectOf({}, true), nums: arrayOf(NUMBER) } };
    const results: Array<[string, string]> = [
      ["rows | first", "{ id: number } | null"], ["rows | last", "{ id: number } | null"],
      ["rows | find(r => r.id > 1)", "{ id: number } | null"],
      ["rows | map(r => r.id)", "number[]"], ["rows | filter(r => r.id > 1)", "{ id: number }[]"],
      ["rows | sort", "{ id: number }[]"], ["rows | reverse", "{ id: number }[]"], ["rows | compact", "{ id: number }[]"],
      ["rows | slice(1)", "{ id: number }[]"], ["rows | uniqBy(r => r.id)", "{ id: number }[]"],
      ["rows | some(r => r.id > 1)", "boolean"], ["rows | every(r => r.id > 1)", "boolean"],
      ["text | split(',')", "string[]"], ["text | trim", "string"], ["text | includes('a')", "boolean"],
      ["text | size", "number"], ["nums | sum", "number"], ["nums | round", "number"],
      ["bag | keys", "string[]"], ["bag | values", "unknown[]"], ["bag | pick(['a'])", "none"],
      ["rows | groupBy(r => r.id)", "none"], ["rows | flatMap(r => [r.id])", "unknown[]"],
      ["rows | flatten", "unknown[]"], ["rows | concat([1])", "[unknown, ...unknown[]]"], ["rows | concat([])", "unknown[]"], ["nums | join(',')", "string"],
      ["nums | max", "none"],
    ];
    for (const [source, expected] of results) {
      const [finding] = checkExpressionSource(`(${source}).probe`, env);
      if (expected === "none") expect(finding?.code, source).not.toBe(TAVNIT_TYPE_CODE.notAnObject);
      else expect(finding?.receiverType, source).toBe(expected);
    }
    // A callback over something that is not an array has an unknown element.
    expect(codes("text | map(c => c.a)", env)).toEqual([]);
    expect(codes("anything | map(c => c.a)", env)).toEqual([]);
  });
});

describe("agreement with the strict evaluator on the whole", () => {
  it("reports no error for a read the data satisfies on every permitted shape", async () => {
    const engine = createEngine();
    const guarded = ['args.client.address?.city ?? ""', "args.note ?? ''", "args.rows | map(r => r.id)", "args.client.name"];
    for (const source of guarded) {
      expect(checkExpressionSource(source, environment), source).toEqual([]);
      const data = { args: { client: { name: "n", nick: null }, rows: [{ id: 1 }], free: {}, count: 1 } };
      await expect(engine.evaluate(source, data)).resolves.not.toBeUndefined();
    }
  });
});

describe("guards that name nothing", () => {
  const env: TypeEnvironment = {
    names: { n: nullable(objectOf({ a: required(NUMBER) })), m: objectOf({}, true), key: STRING, flag: BOOLEAN, ...environment.names },
  };

  it("does not report a read inside a guard twice", () => {
    expect(codes("args.client.nick.length ? 1 : 0", env)).toEqual([
      `${TAVNIT_TYPE_CODE.nullReceiver}:error`,
      `${TAVNIT_TYPE_CODE.notAnObject}:error`,
    ]);
  });

  it("keeps the scope when a side of `&&` or `||` guards nothing", () => {
    expect(codes("1 < 2 && n ? n.a : 0", env)).toEqual([]);
    expect(codes("1 < 2 || !n ? 0 : n.a", env)).toEqual([]);
  });

  it("does not narrow a dynamic key", () => {
    expect(codes("m[key] ? 1 : 0", env)).toEqual([]);
  });
});

describe("types", () => {
  it("compares primitives by kind", () => {
    expect(sameType(NUMBER, { kind: "number" })).toBe(true);
    expect(sameType(objectOf({ a: required(NUMBER) }), objectOf({ a: required(STRING) }))).toBe(false);
    expect(sameType(objectOf({}, true), objectOf({}, false))).toBe(false);
  });
});

describe("built-in results without argument types", () => {
  for (const [name, signature] of Object.entries(BUILTIN_SIGNATURES)) {
    it(`${name}() has a result for no, one and a function argument`, () => {
      expect(signature.result([])).toBeDefined();
      expect(signature.result([arrayOf(STRING)])).toBeDefined();
      expect(signature.result([arrayOf(STRING), { kind: "function", result: NUMBER }])).toBeDefined();
      expect(signature.result([arrayOf(STRING), NUMBER])).toBeDefined();
      expect(signature.result([STRING])).toBeDefined();
    });
  }
});

describe("assumptions", () => {
  const assumed = (condition: string, truthy: boolean): TypeEnvironment => ({
    ...environment,
    assume: [{ condition: parse(condition), truthy }],
  });

  it("narrows an expression by the condition it runs under", () => {
    expect(codes("args.client.address.city", assumed("args.client.address?.city", true))).toEqual([]);
    expect(codes("args.client.address.city", assumed("args.client.address", true))).toEqual([]);
    expect(codes("args.client.address.city", assumed("args.client.address?.city", false))).toEqual([
      `${TAVNIT_TYPE_CODE.absentProperty}:error`,
    ]);
    expect(codes("args.client.nick.length", assumed("not args.client.nick", false))).toEqual([
      `${TAVNIT_TYPE_CODE.notAnObject}:error`,
    ]);
  });
});

describe("type tests", () => {
  const env: TypeEnvironment = {
    names: {
      t: nullable(arrayOf(STRING)),
      u: unionOf([STRING, objectOf({ a: required(NUMBER) }, false)]),
    },
  };

  it("narrows a value to the kind a type() test names", () => {
    expect(codes('type(t) == "array" ? t | map(x => x) : []', env)).toEqual([]);
    expect(codes('type(t) != "array" ? [] : t | map(x => x)', env)).toEqual([]);
    expect(codes('"array" == type(t) ? t | map(x => x) : []', env)).toEqual([]);
    expect(codes('type(t) != "array" or (t | every(x => x))', env)).toEqual([]);
    expect(codes('(t | type) == "array" ? t | map(x => x) : []', env)).toEqual([]);
    expect(codes("t | map(x => x)", env)).toEqual([`${TAVNIT_TYPE_CODE.nullArgument}:error`]);
  });

  it("narrows a union to the member of the tested kind", () => {
    expect(codes('type(u) == "object" ? u.a : 0', env)).toEqual([]);
    expect(codes('type(u) == "object" ? u.b : 0', env)).toEqual([`${TAVNIT_TYPE_CODE.undeclaredProperty}:error`]);
    expect(codes('type(u) == "string" ? (u | trim) : ""', env)).toEqual([]);
  });

  it("learns nothing from a test of null or of an unknown kind", () => {
    expect(codes('type(t) == "null" ? t | map(x => x) : []', env)).toEqual([`${TAVNIT_TYPE_CODE.nullArgument}:error`]);
    expect(codes('type(t) == "number" ? t | map(x => x) : []', env)).toEqual([]);
    expect(codes('type(t + 1) == "number" ? 1 : 0', env)).toEqual([]);
    expect(codes('type(args.rows[args.count]) == "object" ? 1 : 0', { ...env, names: { ...env.names, ...environment.names } })).toEqual([]);
    expect(codes('type(t, 1) == "array" ? t | map(x => x) : []', env)).toEqual([`${TAVNIT_TYPE_CODE.nullArgument}:error`]);
  });
});
