import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { createEngine } from "./engine/engine.js";
import { Duration, Instant, PlainDate, PlainDateTime, PlainTime, type Value } from "./index.js";
import { deserialiseValue, serialiseValue } from "./serialisation.js";

const eng = createEngine();
const ev = (expr: string): Promise<Value> => eng.evaluate(expr);
const evCtx = (expr: string, ctx: Record<string, Value>): Promise<Value> =>
  eng.evaluate(expr, ctx);

const map = (inner: string, type: string): Value => ({
  __tavnit_date__: true,
  _inner: inner,
  __tavnit_type__: type,
});

/** Exactly the round-trip a YAML-backed KV performs on write then read. */
const throughYaml = (value: Value): Value =>
  deserialiseValue(parseYaml(stringifyYaml(serialiseValue(value))) as Value);

describe("serialiseValue", () => {
  it("writes a PlainDate as a tagged wrapper", async () => {
    const date = await ev('plainDate("2026-09-01")');
    expect(serialiseValue(date)).toEqual(map("2026-09-01", "plaindate"));
  });

  it("writes an Instant as a tagged wrapper", async () => {
    const instant = await ev('instant("2026-09-01T10:00:00Z")');
    expect(serialiseValue(instant)).toEqual(map("2026-09-01T10:00:00Z", "instant"));
  });

  it("writes a PlainTime as a tagged wrapper", async () => {
    const time = await ev('toPlainTime("10:30:00")');
    expect(serialiseValue(time)).toEqual(map("10:30:00", "plaintime"));
  });

  it("writes a PlainDateTime as a tagged wrapper", async () => {
    const dt = await ev('parsePlainDateTime("01.09.2026 10:30:00", "dd.MM.yyyy HH:mm:ss")');
    expect(serialiseValue(dt)).toEqual(map("2026-09-01T10:30:00", "plaindatetime"));
  });

  it("writes a Duration as a tagged wrapper", async () => {
    const dur = await ev('duration("P1Y2M")');
    expect(serialiseValue(dur)).toEqual(map("P1Y2M", "duration"));
  });

  it("leaves plain data untouched", () => {
    const value: Value = { a: 1, b: [true, null, "x"], c: { d: 2 } };
    expect(serialiseValue(value)).toEqual(value);
  });

  it("recurses into arrays and objects", async () => {
    const date = await ev('plainDate("2026-09-01")');
    expect(serialiseValue({ season: { start: date } })).toEqual({
      season: { start: map("2026-09-01", "plaindate") },
    });
    expect(serialiseValue([date])).toEqual([map("2026-09-01", "plaindate")]);
  });
});

describe("deserialiseValue", () => {
  it("revives a PlainDate to a live wrapper", () => {
    const revived = deserialiseValue(map("2026-09-01", "plaindate"));
    expect(revived).toBeInstanceOf(PlainDate);
    expect((revived as PlainDate)._inner.toString()).toBe("2026-09-01");
  });

  it("revives every storable wrapper type", () => {
    expect(deserialiseValue(map("2026-09-01T10:00:00Z", "instant"))).toBeInstanceOf(Instant);
    expect(deserialiseValue(map("10:30:00", "plaintime"))).toBeInstanceOf(PlainTime);
    expect(deserialiseValue(map("2026-09-01T10:30:00", "plaindatetime"))).toBeInstanceOf(PlainDateTime);
    expect(deserialiseValue(map("P1Y2M", "duration"))).toBeInstanceOf(Duration);
  });

  it("leaves plain data untouched", () => {
    const value: Value = { a: 1, b: [true, null, "x"], c: { d: 2 } };
    expect(deserialiseValue(value)).toEqual(value);
  });

  it("recurses into arrays and objects", () => {
    const revived = deserialiseValue({ season: { start: map("2026-09-01", "plaindate") } }) as Record<
      string,
      Value
    >;
    const season = revived.season as Record<string, Value>;
    expect(season.start).toBeInstanceOf(PlainDate);
  });

  it("leaves an unknown wrapper type as a plain value (forward compatibility)", () => {
    const value = map("2026-09-01", "somefuturetype");
    expect(deserialiseValue(value)).toEqual(value);
  });

  it("leaves a malformed wrapper as a plain value", () => {
    const value: Value = { __tavnit_date__: true, _inner: 20260901, __tavnit_type__: "plaindate" };
    expect(deserialiseValue(value)).toEqual(value);
  });

  it("leaves a wrapper whose inner text does not parse as a plain value", () => {
    const value = map("not-a-date", "plaindate");
    expect(deserialiseValue(value)).toEqual(value);
  });

  it("does not revive the transient ZonedDateTime type", () => {
    const value = map("2026-09-01T10:00:00+03:00[Europe/Moscow]", "zoneddatetime");
    expect(deserialiseValue(value)).toEqual(value);
  });
});

describe("round-trip through YAML", () => {
  it("keeps a PlainDate usable as a date after stringify + parse", async () => {
    const date = await ev('plainDate("2026-09-01")');
    const yaml = stringifyYaml(serialiseValue({ sStart: date }));
    expect(yaml).toContain("__tavnit_date__");

    const revived = throughYaml({ sStart: date }) as Record<string, Value>;
    expect(revived.sStart).toBeInstanceOf(PlainDate);

    // The failure that motivated the codec: subtract() on a read-back value.
    const subtracted = await evCtx("subtract(sStart, { years: 7 })", revived);
    expect(subtracted).toBeInstanceOf(PlainDate);
    expect((subtracted as PlainDate)._inner.toString()).toBe("2019-09-01");
  });

  it("round-trips an Instant", async () => {
    const instant = await ev('instant("2026-09-01T10:00:00Z")');
    const revived = throughYaml({ at: instant }) as Record<string, Value>;
    expect(revived.at).toBeInstanceOf(Instant);
  });

  it("round-trips a Duration", async () => {
    const dur = await ev('duration("P1Y2M")');
    const revived = throughYaml({ span: dur }) as Record<string, Value>;
    expect(revived.span).toBeInstanceOf(Duration);
  });
});
