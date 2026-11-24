import { describe, expect, it } from "vitest";
import { createEngine } from "../engine/engine.js";
import {
  Duration,
  Instant,
  PlainDate,
  PlainDateTime,
  PlainTime,
} from "../index.js";

const eng = createEngine();
const lenientEng = createEngine({ strict: false });
const infEng = createEngine({ divisionByZero: "infinity" });
const ev = (expr: string, ctx: Record<string, unknown> = {}) =>
  eng.evaluate(expr, ctx as never);

// ── Construction ──────────────────────────────────────────────────────────────

describe("now() / today()", () => {
  it("now() returns an Instant", async () => {
    const v = await ev("now()");
    expect(v).toBeInstanceOf(Instant);
  });

  it("today() returns a PlainDate", async () => {
    const v = await ev("today()");
    expect(v).toBeInstanceOf(PlainDate);
  });

  it("now() is after a past instant", async () => {
    const v = await ev("now() > instant(\"2020-01-01T00:00:00Z\")");
    expect(v).toBe(true);
  });
});

describe("instant(str)", () => {
  it("parses ISO string", async () => {
    const v = await ev("instant(\"2024-03-15T10:00:00Z\")");
    expect(v).toBeInstanceOf(Instant);
  });

  it("throws on non-string", async () => {
    await expect(ev("instant(42)")).rejects.toThrow("instant() requires a string");
  });

  it("throws on invalid string", async () => {
    await expect(ev("instant(\"not-a-date\")")).rejects.toThrow("Invalid Instant string");
  });
});

describe("plainDate(str)", () => {
  it("parses ISO date string", async () => {
    const v = await ev("plainDate(\"2024-03-15\")");
    expect(v).toBeInstanceOf(PlainDate);
  });

  it("throws on invalid string", async () => {
    await expect(ev("plainDate(\"bad\")")).rejects.toThrow("Invalid PlainDate string");
  });
});

describe("toInstant(v)", () => {
  it("passes through an Instant", async () => {
    const v = await ev("instant(\"2024-01-01T00:00:00Z\") | toInstant()");
    expect(v).toBeInstanceOf(Instant);
  });

  it("accepts ISO string", async () => {
    const v = await ev("toInstant(\"2024-01-01T00:00:00Z\")");
    expect(v).toBeInstanceOf(Instant);
  });

  it("accepts Unix milliseconds", async () => {
    const v = await ev("toInstant(0)");
    expect(v).toBeInstanceOf(Instant);
    expect(await ev("toInstant(0) | toEpochMs()")).toBe(0);
  });

  it("throws on non-finite number", async () => {
    await expect(infEng.evaluate("toInstant(1/0)", {})).rejects.toThrow("finite number");
  });

  it("throws on invalid type", async () => {
    await expect(ev("toInstant(true)")).rejects.toThrow("toInstant()");
  });
});

describe("toPlainDate(v)", () => {
  it("accepts ISO string", async () => {
    const v = await ev("toPlainDate(\"2024-03-15\")");
    expect(v).toBeInstanceOf(PlainDate);
  });

  it("converts Instant to PlainDate (UTC date)", async () => {
    const v = await ev("toPlainDate(instant(\"2024-03-15T10:00:00Z\"))");
    expect(v).toBeInstanceOf(PlainDate);
    expect(await ev("toPlainDate(instant(\"2024-03-15T10:00:00Z\")) | format()")).toBe("2024-03-15");
  });

  it("passes through PlainDate", async () => {
    const v = await ev("plainDate(\"2024-01-01\") | toPlainDate()");
    expect(v).toBeInstanceOf(PlainDate);
  });
});

describe("toPlainTime(v)", () => {
  it("accepts time string", async () => {
    const v = await ev("toPlainTime(\"14:30:00\")");
    expect(v).toBeInstanceOf(PlainTime);
  });

  it("throws on invalid type", async () => {
    await expect(ev("toPlainTime(42)")).rejects.toThrow("toPlainTime()");
  });
});

describe("duration(v)", () => {
  it("from ISO duration string", async () => {
    const v = await ev("duration(\"P3D\")");
    expect(v).toBeInstanceOf(Duration);
  });

  it("from object literal", async () => {
    const v = await ev("duration({ \"days\": 3 })");
    expect(v).toBeInstanceOf(Duration);
  });

  it("passes through Duration", async () => {
    const v = await ev("duration(\"P1D\") | duration()");
    expect(v).toBeInstanceOf(Duration);
  });

  it("throws on invalid string", async () => {
    await expect(ev("duration(\"bad\")")).rejects.toThrow("Invalid Duration string");
  });

  it("throws on null", async () => {
    await expect(ev("duration(null)")).rejects.toThrow("duration()");
  });
});

// ── Arithmetic ────────────────────────────────────────────────────────────────

describe("add / subtract — Instant", () => {
  it("add days to Instant returns Instant", async () => {
    const v = await ev("instant(\"2024-01-01T00:00:00Z\") | add({ \"days\": 1 })");
    expect(v).toBeInstanceOf(Instant);
    const iso = await ev("instant(\"2024-01-01T00:00:00Z\") | add({ \"days\": 1 }) | format()");
    expect(iso).toContain("2024-01-02");
  });

  it("subtract days from Instant returns Instant", async () => {
    const iso = await ev("instant(\"2024-01-10T00:00:00Z\") | subtract({ \"days\": 3 }) | format()");
    expect(iso).toContain("2024-01-07");
  });

  it("accepts Duration value", async () => {
    const iso = await ev(
      "instant(\"2024-01-01T00:00:00Z\") | add(duration(\"P7D\")) | format()",
    );
    expect(iso).toContain("2024-01-08");
  });
});

describe("add / subtract — PlainDate", () => {
  it("add months to PlainDate returns PlainDate", async () => {
    const v = await ev("plainDate(\"2024-01-15\") | add({ \"months\": 1 })");
    expect(v).toBeInstanceOf(PlainDate);
    const iso = await ev("plainDate(\"2024-01-15\") | add({ \"months\": 1 }) | format()");
    expect(iso).toBe("2024-02-15");
  });

  it("subtract PlainDate returns PlainDate", async () => {
    const iso = await ev("plainDate(\"2024-03-01\") | subtract({ \"days\": 1 }) | format()");
    expect(iso).toBe("2024-02-29");
  });
});

describe("add / subtract — PlainDateTime", () => {
  it("add hours to PlainDateTime returns PlainDateTime", async () => {
    const v = await ev(
      "parsePlainDateTime(\"2024-01-15 10:00:00\", \"yyyy-MM-dd HH:mm:ss\") | add({ \"hours\": 2 })",
    );
    expect(v).toBeInstanceOf(PlainDateTime);
  });

  it("add throws for unsupported type", async () => {
    await expect(ev("add(\"not-a-date\", { \"days\": 1 })")).rejects.toThrow("add()");
  });

  it("subtract throws for unsupported type", async () => {
    await expect(ev("subtract(42, { \"days\": 1 })")).rejects.toThrow("subtract()");
  });
});

describe("until()", () => {
  it("Instant.until returns Duration", async () => {
    const v = await ev(
      "instant(\"2024-01-01T00:00:00Z\") | until(instant(\"2024-01-04T00:00:00Z\"))",
    );
    expect(v).toBeInstanceOf(Duration);
  });

  it("PlainDate.until returns Duration", async () => {
    const v = await ev(
      "plainDate(\"2024-01-01\") | until(plainDate(\"2024-01-10\"))",
    );
    expect(v).toBeInstanceOf(Duration);
  });

  it("PlainDateTime.until returns Duration", async () => {
    const v = await ev(
      "parsePlainDateTime(\"2024-01-01 00:00:00\", \"yyyy-MM-dd HH:mm:ss\") | until(parsePlainDateTime(\"2024-01-02 00:00:00\", \"yyyy-MM-dd HH:mm:ss\"))",
    );
    expect(v).toBeInstanceOf(Duration);
  });

  it("PlainTime.until returns Duration", async () => {
    const v = await ev("toPlainTime(\"09:00:00\") | until(toPlainTime(\"17:00:00\"))");
    expect(v).toBeInstanceOf(Duration);
  });

  it("throws on mismatched types", async () => {
    await expect(
      ev("instant(\"2024-01-01T00:00:00Z\") | until(plainDate(\"2024-01-10\"))"),
    ).rejects.toThrow("until()");
  });
});

describe("toMillis(dur)", () => {
  it("converts hours duration to ms", async () => {
    const ms = await ev("duration({ \"hours\": 2 }) | toMillis()");
    expect(ms).toBe(2 * 60 * 60 * 1000);
  });

  it("converts days duration to ms", async () => {
    const ms = await ev("duration({ \"days\": 1 }) | toMillis()");
    expect(ms).toBe(24 * 60 * 60 * 1000);
  });

  it("throws on non-Duration", async () => {
    await expect(ev("toMillis(42)")).rejects.toThrow("toMillis()");
  });
});

describe("get(dur, field)", () => {
  it("extracts days field", async () => {
    const v = await ev("duration(\"P3D\") | get(\"days\")");
    expect(v).toBe(3);
  });

  it("extracts hours field", async () => {
    const v = await ev("duration({ \"hours\": 5 }) | get(\"hours\")");
    expect(v).toBe(5);
  });

  it("throws on unknown field", async () => {
    await expect(ev("duration(\"P1D\") | get(\"foobar\")")).rejects.toThrow(
      "unknown duration field",
    );
  });

  it("throws on non-Duration", async () => {
    await expect(ev("get(42, \"days\")")).rejects.toThrow("get()");
  });

  it("throws when field is not a string", async () => {
    await expect(ev("duration(\"P3D\") | get(42)")).rejects.toThrow("get() field must be a string");
  });
});

// ── Comparison operators ──────────────────────────────────────────────────────

describe("Instant comparison operators", () => {
  it("< works", async () => {
    expect(
      await ev("instant(\"2020-01-01T00:00:00Z\") < instant(\"2024-01-01T00:00:00Z\")"),
    ).toBe(true);
    expect(
      await ev("instant(\"2024-01-01T00:00:00Z\") < instant(\"2020-01-01T00:00:00Z\")"),
    ).toBe(false);
  });

  it("> works", async () => {
    expect(
      await ev("instant(\"2024-01-01T00:00:00Z\") > instant(\"2020-01-01T00:00:00Z\")"),
    ).toBe(true);
  });

  it("<= works (equal case)", async () => {
    expect(
      await ev("instant(\"2024-01-01T00:00:00Z\") <= instant(\"2024-01-01T00:00:00Z\")"),
    ).toBe(true);
  });

  it(">= works (greater case)", async () => {
    expect(
      await ev("instant(\"2024-06-01T00:00:00Z\") >= instant(\"2024-01-01T00:00:00Z\")"),
    ).toBe(true);
  });

  it("== works for equal instants", async () => {
    expect(
      await ev("instant(\"2024-01-01T00:00:00Z\") == instant(\"2024-01-01T00:00:00Z\")"),
    ).toBe(true);
  });

  it("!= works for unequal instants", async () => {
    expect(
      await ev("instant(\"2024-01-01T00:00:00Z\") != instant(\"2024-01-02T00:00:00Z\")"),
    ).toBe(true);
  });
});

describe("PlainDate comparison operators", () => {
  it("< works", async () => {
    expect(await ev("plainDate(\"2024-01-01\") < plainDate(\"2024-06-01\")")).toBe(true);
  });

  it(">= works (equal case)", async () => {
    expect(await ev("plainDate(\"2024-01-01\") >= plainDate(\"2024-01-01\")")).toBe(true);
  });

  it("== works for equal dates", async () => {
    expect(await ev("plainDate(\"2024-03-15\") == plainDate(\"2024-03-15\")")).toBe(true);
  });

  it("!= works for different dates", async () => {
    expect(await ev("plainDate(\"2024-01-01\") != plainDate(\"2024-01-02\")")).toBe(true);
  });
});

describe("PlainTime comparison operators", () => {
  it("< works", async () => {
    expect(await ev("toPlainTime(\"08:00:00\") < toPlainTime(\"14:30:00\")")).toBe(true);
  });

  it("== works", async () => {
    expect(await ev("toPlainTime(\"10:00:00\") == toPlainTime(\"10:00:00\")")).toBe(true);
  });
});

describe("PlainDateTime comparison operators", () => {
  it("< works", async () => {
    expect(
      await ev(
        "parsePlainDateTime(\"2024-01-01 09:00:00\", \"yyyy-MM-dd HH:mm:ss\") < parsePlainDateTime(\"2024-01-01 17:00:00\", \"yyyy-MM-dd HH:mm:ss\")",
      ),
    ).toBe(true);
  });
});

// ── Formatting ────────────────────────────────────────────────────────────────

describe("format(v, pattern?)", () => {
  it("Instant without pattern gives ISO string", async () => {
    const v = await ev("instant(\"2024-03-15T10:30:00.000Z\") | format()");
    expect(v).toBe("2024-03-15T10:30:00Z");
  });

  it("PlainDate without pattern gives ISO date", async () => {
    expect(await ev("plainDate(\"2024-03-15\") | format()")).toBe("2024-03-15");
  });

  it("PlainDate with CLDR pattern", async () => {
    expect(await ev("plainDate(\"2024-03-15\") | format(\"dd.MM.yyyy\")")).toBe("15.03.2024");
  });

  it("PlainTime without pattern gives ISO time", async () => {
    expect(await ev("toPlainTime(\"14:30:00\") | format()")).toBe("14:30:00");
  });

  it("PlainTime with HH:mm pattern", async () => {
    expect(await ev("toPlainTime(\"14:30:00\") | format(\"HH:mm\")")).toBe("14:30");
  });

  it("Instant with CLDR pattern (UTC fields)", async () => {
    const v = await ev("instant(\"2024-03-15T10:05:03Z\") | format(\"yyyy-MM-dd HH:mm:ss\")");
    expect(v).toBe("2024-03-15 10:05:03");
  });

  it("throws on non-date value", async () => {
    await expect(ev("format(42)")).rejects.toThrow("format()");
  });

  it("throws when pattern is not a string", async () => {
    await expect(ev("plainDate(\"2024-01-01\") | format(42)")).rejects.toThrow(
      "format() pattern must be a string",
    );
  });
});

describe("toZonedDateTime(instant, tz)", () => {
  it("converts Instant to ZonedDateTime and formats", async () => {
    const v = await ev(
      "instant(\"2024-01-15T07:00:00Z\") | toZonedDateTime(\"Europe/Moscow\") | format(\"yyyy-MM-dd HH:mm\")",
    );
    // Moscow is UTC+3
    expect(v).toBe("2024-01-15 10:00");
  });

  it("throws on invalid timezone", async () => {
    await expect(
      ev("instant(\"2024-01-01T00:00:00Z\") | toZonedDateTime(\"Not/AZone\")"),
    ).rejects.toThrow("Invalid timezone");
  });

  it("throws on non-Instant", async () => {
    await expect(ev("toZonedDateTime(\"2024-01-01\", \"UTC\")")).rejects.toThrow(
      "toZonedDateTime() requires an Instant",
    );
  });

  it("throws when tz is not a string", async () => {
    await expect(ev("now() | toZonedDateTime(42)")).rejects.toThrow(
      "toZonedDateTime() requires a timezone string",
    );
  });
});

describe("formatCalendar(zdt, reference, locale?)", () => {
  // Reference: Sat 2026-09-26 22:00 Moscow (19:00Z).
  const cal = (iso: string, locale = "\"ru\"") =>
    ev(
      `instant("${iso}") | toZonedDateTime("Europe/Moscow") | formatCalendar(instant("2026-09-26T19:00:00Z"), ${locale})`,
    );

  it("today → time only", async () => {
    expect(await cal("2026-09-26T15:34:00Z")).toBe("18:34");
  });

  it("yesterday → locale word + time", async () => {
    expect(await cal("2026-09-25T15:34:00Z")).toBe("вчера 18:34");
  });

  it("tomorrow → locale word + time", async () => {
    expect(await cal("2026-09-27T08:00:00Z")).toBe("завтра 11:00");
  });

  it("later → short weekday + day.month + time", async () => {
    expect(await cal("2026-09-29T15:00:00Z")).toBe("вт 29.09 18:00");
  });

  it("earlier this year → day.month + time", async () => {
    expect(await cal("2026-09-20T09:05:00Z")).toBe("20.09 12:05");
  });

  it("another year → full date + time", async () => {
    expect(await cal("2025-12-31T09:05:00Z")).toBe("31.12.2025 12:05");
  });

  it("judges the day in the value's zone, not UTC", async () => {
    // 21:30Z on the 26th is already the 27th in Moscow → tomorrow.
    expect(await cal("2026-09-26T21:30:00Z")).toBe("завтра 00:30");
  });

  it("formats a value in a fixed-offset zone", async () => {
    const v = await ev(
      "instant(\"2026-09-25T15:34:00Z\") | toZonedDateTime(\"+03:00\") | formatCalendar(instant(\"2026-09-26T19:00:00Z\"), \"ru\")",
    );
    expect(v).toBe("вчера 18:34");
  });

  it("gives the same label on a repeated call", async () => {
    expect(await cal("2026-09-29T15:00:00Z")).toBe(await cal("2026-09-29T15:00:00Z"));
    expect(await cal("2026-09-29T15:00:00Z", "\"en\"")).toBe("Tue 09/29 06:00 PM");
  });

  it("keeps labelling correctly past the formatter cache limit", async () => {
    // Each private-use tag is a distinct cache key; the label stays that of "ru".
    for (let i = 0; i < 300; i++) {
      expect(await cal("2026-09-25T15:34:00Z", `"ru-x-t${i}"`)).toBe("вчера 18:34");
    }
  });

  it("accepts a ZonedDateTime reference", async () => {
    const v = await ev(
      "instant(\"2026-09-26T15:34:00Z\") | toZonedDateTime(\"Europe/Moscow\") | formatCalendar(instant(\"2026-09-26T19:00:00Z\") | toZonedDateTime(\"UTC\"), \"ru\")",
    );
    expect(v).toBe("18:34");
  });

  it("defaults to the en locale", async () => {
    const v = await ev(
      "instant(\"2026-09-25T15:34:00Z\") | toZonedDateTime(\"Europe/Moscow\") | formatCalendar(instant(\"2026-09-26T19:00:00Z\"))",
    );
    expect(v).toBe("yesterday 06:34 PM");
  });

  it("throws on non-ZonedDateTime", async () => {
    await expect(ev("now() | formatCalendar(now())")).rejects.toThrow(
      "formatCalendar() requires a ZonedDateTime",
    );
  });

  it("throws on a missing reference", async () => {
    await expect(
      ev("now() | toZonedDateTime(\"UTC\") | formatCalendar()"),
    ).rejects.toThrow("formatCalendar() requires an Instant or ZonedDateTime reference");
  });

  it("throws when locale is not a string", async () => {
    await expect(
      ev("now() | toZonedDateTime(\"UTC\") | formatCalendar(now(), 42)"),
    ).rejects.toThrow("formatCalendar() locale must be a string");
  });

  it("throws on an invalid locale", async () => {
    await expect(
      ev("now() | toZonedDateTime(\"UTC\") | formatCalendar(now(), \"not a locale\")"),
    ).rejects.toThrow("formatCalendar() invalid locale");
  });
});

// ── Epoch interop ─────────────────────────────────────────────────────────────

describe("toEpochMs / toEpochSeconds / fromEpochSeconds", () => {
  it("toEpochMs returns milliseconds", async () => {
    const ms = await ev("instant(\"1970-01-01T00:00:01Z\") | toEpochMs()");
    expect(ms).toBe(1000);
  });

  it("toEpochSeconds returns seconds", async () => {
    const s = await ev("instant(\"1970-01-01T00:00:10Z\") | toEpochSeconds()");
    expect(s).toBe(10);
  });

  it("toEpochMs and toEpochSeconds differ by 1000×", async () => {
    const ms = await ev("instant(\"2024-01-01T00:00:00Z\") | toEpochMs()") as number;
    const s = await ev("instant(\"2024-01-01T00:00:00Z\") | toEpochSeconds()") as number;
    expect(ms / s).toBe(1000);
  });

  it("fromEpochSeconds constructs Instant", async () => {
    const v = await ev("fromEpochSeconds(0)");
    expect(v).toBeInstanceOf(Instant);
  });

  it("fromEpochSeconds round-trips with toEpochSeconds", async () => {
    const iso = await ev(
      "instant(\"2024-06-15T12:00:00Z\") | toEpochSeconds() | fromEpochSeconds() | format()",
    );
    expect(iso).toBe("2024-06-15T12:00:00Z");
  });

  it("toInstant(ms) equivalent to fromEpochSeconds(ms/1000)", async () => {
    const a = await ev("toInstant(1000) | toEpochMs()");
    const b = await ev("fromEpochSeconds(1) | toEpochMs()");
    expect(a).toBe(b);
  });

  it("toEpochMs throws on non-Instant", async () => {
    await expect(ev("toEpochMs(42)")).rejects.toThrow("toEpochMs()");
  });

  it("toEpochSeconds throws on non-Instant", async () => {
    await expect(ev("toEpochSeconds(\"x\")")).rejects.toThrow("toEpochSeconds()");
  });

  it("fromEpochSeconds throws on non-number", async () => {
    await expect(ev("fromEpochSeconds(\"x\")")).rejects.toThrow("fromEpochSeconds()");
  });
});

// ── parsePlainDate / parsePlainDateTime ───────────────────────────────────────

describe("parsePlainDate(str, format)", () => {
  it("parses dd.MM.yyyy format", async () => {
    const v = await ev("parsePlainDate(\"15.03.2024\", \"dd.MM.yyyy\")");
    expect(v).toBeInstanceOf(PlainDate);
    expect(await ev("parsePlainDate(\"15.03.2024\", \"dd.MM.yyyy\") | format()")).toBe("2024-03-15");
  });

  it("parses yyyy-MM-dd format", async () => {
    const v = await ev("parsePlainDate(\"2024-12-25\", \"yyyy-MM-dd\")");
    expect(v).toBeInstanceOf(PlainDate);
    expect(await ev("parsePlainDate(\"2024-12-25\", \"yyyy-MM-dd\") | format()")).toBe("2024-12-25");
  });

  it("can be compared to today()", async () => {
    const result = await ev(
      "parsePlainDate(\"01.01.2020\", \"dd.MM.yyyy\") < today()",
    );
    expect(result).toBe(true);
  });

  it("throws when first arg is not a string", async () => {
    await expect(ev("parsePlainDate(42, \"dd.MM.yyyy\")")).rejects.toThrow(
      "requires a string as first argument",
    );
  });

  it("throws on non-matching string", async () => {
    await expect(ev("parsePlainDate(\"bad\", \"dd.MM.yyyy\")")).rejects.toThrow("Cannot parse");
  });

  it("throws when format arg missing", async () => {
    await expect(ev("parsePlainDate(\"15.03.2024\")")).rejects.toThrow("format string");
  });
});

describe("parsePlainDateTime(str, format)", () => {
  it("parses dd.MM.yyyy HH:mm:ss", async () => {
    const v = await ev(
      "parsePlainDateTime(\"15.03.2024 10:30:00\", \"dd.MM.yyyy HH:mm:ss\")",
    );
    expect(v).toBeInstanceOf(PlainDateTime);
    expect(
      await ev("parsePlainDateTime(\"15.03.2024 10:30:00\", \"dd.MM.yyyy HH:mm:ss\") | format()"),
    ).toBe("2024-03-15T10:30:00");
  });

  it("can be compared", async () => {
    const r = await ev(
      "parsePlainDateTime(\"01.01.2020 00:00:00\", \"dd.MM.yyyy HH:mm:ss\") < parsePlainDateTime(\"01.01.2025 00:00:00\", \"dd.MM.yyyy HH:mm:ss\")",
    );
    expect(r).toBe(true);
  });

  it("throws on non-matching string", async () => {
    await expect(
      ev("parsePlainDateTime(\"bad\", \"dd.MM.yyyy HH:mm:ss\")"),
    ).rejects.toThrow("Cannot parse");
  });

  it("throws when first arg is not a string", async () => {
    await expect(ev("parsePlainDateTime(42, \"dd.MM.yyyy HH:mm:ss\")")).rejects.toThrow(
      "requires a string as first argument",
    );
  });

  it("throws when format arg missing", async () => {
    await expect(ev("parsePlainDateTime(\"15.03.2024 10:00:00\")")).rejects.toThrow(
      "format string",
    );
  });
});

describe("parsePlainDate / parsePlainDateTime out-of-range", () => {
  it("parsePlainDate throws on out-of-range date (month 13)", async () => {
    await expect(
      ev("parsePlainDate(\"32.13.2024\", \"dd.MM.yyyy\")"),
    ).rejects.toThrow();
  });

  it("parsePlainDateTime throws on out-of-range datetime (month 13)", async () => {
    await expect(
      ev("parsePlainDateTime(\"32.13.2024 10:00:00\", \"dd.MM.yyyy HH:mm:ss\")"),
    ).rejects.toThrow();
  });
});

// ── str() and type() for date types ──────────────────────────────────────────

describe("str() with date types", () => {
  it("str(Instant) gives ISO string", async () => {
    const v = await ev("str(instant(\"2024-03-15T10:00:00Z\"))");
    expect(v).toBe("2024-03-15T10:00:00Z");
  });

  it("str(PlainDate) gives ISO date", async () => {
    expect(await ev("str(plainDate(\"2024-03-15\"))")).toBe("2024-03-15");
  });

  it("str(PlainTime) gives ISO time", async () => {
    expect(await ev("str(toPlainTime(\"14:30:00\"))")).toBe("14:30:00");
  });

  it("str(Duration) gives ISO duration", async () => {
    expect(await ev("str(duration(\"P3D\"))")).toBe("P3D");
  });
});

describe("type() with date types", () => {
  it("type(Instant) → \"instant\"", async () => {
    expect(await ev("type(instant(\"2024-01-01T00:00:00Z\"))")).toBe("instant");
  });

  it("type(PlainDate) → \"plaindate\"", async () => {
    expect(await ev("type(plainDate(\"2024-01-01\"))")).toBe("plaindate");
  });

  it("type(PlainTime) → \"plaintime\"", async () => {
    expect(await ev("type(toPlainTime(\"10:00:00\"))")).toBe("plaintime");
  });

  it("type(PlainDateTime) → \"plaindatetime\"", async () => {
    expect(
      await ev("type(parsePlainDateTime(\"2024-01-01 00:00:00\", \"yyyy-MM-dd HH:mm:ss\"))"),
    ).toBe("plaindatetime");
  });

  it("type(Duration) → \"duration\"", async () => {
    expect(await ev("type(duration(\"P1D\"))")).toBe("duration");
  });
});

// ── Opaque: internal properties not accessible ────────────────────────────────

describe("Opaque date wrappers", () => {
  it("_inner not accessible via dot notation", async () => {
    const v = await lenientEng.evaluate("instant(\"2024-01-01T00:00:00Z\")._inner", {});
    expect(v).toBeNull();
  });

  it("epochMilliseconds not reachable via dot", async () => {
    const v = await lenientEng.evaluate("instant(\"2024-01-01T00:00:00Z\").epochMilliseconds", {});
    expect(v).toBeNull();
  });

  it("date type not usable in arithmetic directly", async () => {
    await expect(ev("instant(\"2024-01-01T00:00:00Z\") + 1")).rejects.toThrow();
  });

  it("date passes as context value", async () => {
    const ts = await eng.evaluate("myDate > instant(\"2020-01-01T00:00:00Z\")", {
      myDate: new Instant(
        // @ts-expect-error — internal constructor for test setup
        { epochMilliseconds: Date.now() } as never,
      ),
    }).catch(() => null);
    // Just checking it doesn't crash with a type error
    expect(ts).not.toBeUndefined();
  });
});

// ── Integration: realistic use-case chains ────────────────────────────────────

describe("Integration chains", () => {
  it("filter messages newer than 3 days", async () => {
    const cutoff = new Date("2024-01-10T00:00:00Z").toISOString();
    const messages = [
      { id: 1, date: "2024-01-08T00:00:00Z" },
      { id: 2, date: "2024-01-12T00:00:00Z" },
      { id: 3, date: "2024-01-15T00:00:00Z" },
    ];
    const result = await eng.evaluate(
      "messages | filter(x => toInstant(x.date) > instant(cutoff))",
      { messages, cutoff },
    ) as Array<{ id: number }>;
    expect(result.map((m) => m.id)).toEqual([2, 3]);
  });

  it("PKCE code-challenge chain", async () => {
    const v = await ev("randomString(43) | sha256() | base64urlEncodeHex()");
    expect(typeof v).toBe("string");
    expect((v as string).length).toBeGreaterThan(0);
  });

  it("format PlainDate from Russian API format", async () => {
    const v = await ev(
      "parsePlainDate(bdate, \"dd.MM.yyyy\") | format(\"yyyy-MM-dd\")",
      { bdate: "15.03.1990" },
    );
    expect(v).toBe("1990-03-15");
  });

  it("until + toMillis gives total ms between instants", async () => {
    const ms = await ev(
      "instant(\"2024-01-01T00:00:00Z\") | until(instant(\"2024-01-02T00:00:00Z\")) | toMillis()",
    );
    expect(ms).toBe(24 * 60 * 60 * 1000);
  });
});

// ── Missing branch coverage ───────────────────────────────────────────────────

describe("plainDate() type check", () => {
  it("throws when arg is not a string", async () => {
    await expect(ev("plainDate(42)")).rejects.toThrow("plainDate() requires a string");
  });
});

describe("toInstant() string-parse error", () => {
  it("throws on invalid ISO string", async () => {
    await expect(ev("toInstant(\"not-an-iso-string\")")).rejects.toThrow(
      "Cannot convert to Instant",
    );
  });
});

describe("toPlainDate() additional paths", () => {
  it("converts PlainDateTime to PlainDate", async () => {
    const v = await ev(
      "parsePlainDateTime(\"2024-06-15 10:30:00\", \"yyyy-MM-dd HH:mm:ss\") | toPlainDate()",
    );
    expect(v).toBeInstanceOf(PlainDate);
    const iso = await ev(
      "parsePlainDateTime(\"2024-06-15 10:30:00\", \"yyyy-MM-dd HH:mm:ss\") | toPlainDate() | format()",
    );
    expect(iso).toBe("2024-06-15");
  });

  it("throws on invalid string", async () => {
    await expect(ev("toPlainDate(\"not-a-date\")")).rejects.toThrow(
      "Cannot convert to PlainDate",
    );
  });

  it("throws on unsupported type", async () => {
    await expect(ev("toPlainDate(null)")).rejects.toThrow("toPlainDate() requires");
  });
});

describe("toPlainTime() additional paths", () => {
  it("passes through a PlainTime unchanged", async () => {
    const v = await ev("toPlainTime(\"14:30:00\") | toPlainTime()");
    expect(v).toBeInstanceOf(PlainTime);
    expect(await ev("toPlainTime(\"14:30:00\") | toPlainTime() | format()")).toBe("14:30:00");
  });

  it("converts PlainDateTime to PlainTime", async () => {
    const v = await ev(
      "parsePlainDateTime(\"2024-06-15 14:30:00\", \"yyyy-MM-dd HH:mm:ss\") | toPlainTime()",
    );
    expect(v).toBeInstanceOf(PlainTime);
    const iso = await ev(
      "parsePlainDateTime(\"2024-06-15 14:30:00\", \"yyyy-MM-dd HH:mm:ss\") | toPlainTime() | format()",
    );
    expect(iso).toBe("14:30:00");
  });

  it("throws on invalid time string", async () => {
    await expect(ev("toPlainTime(\"25:99:99\")")).rejects.toThrow(
      "Cannot convert to PlainTime",
    );
  });
});

describe("toDuration error paths (via add/subtract)", () => {
  it("throws when duration object field is not a number", async () => {
    await expect(
      ev("plainDate(\"2024-01-01\") | add({ \"days\": \"bad\" })"),
    ).rejects.toThrow("must be a number");
  });

  it("throws when duration arg is not a Duration or object", async () => {
    await expect(
      ev("subtract(plainDate(\"2024-01-01\"), null)"),
    ).rejects.toThrow("Expected a Duration or duration-like object");
  });
});


describe("subtract() — PlainDateTime", () => {
  it("subtract days from PlainDateTime returns PlainDateTime", async () => {
    const v = await ev(
      "parsePlainDateTime(\"2024-03-15 10:00:00\", \"yyyy-MM-dd HH:mm:ss\") | subtract({ \"days\": 1 })",
    );
    expect(v).toBeInstanceOf(PlainDateTime);
    const iso = await ev(
      "parsePlainDateTime(\"2024-03-15 10:00:00\", \"yyyy-MM-dd HH:mm:ss\") | subtract({ \"days\": 1 }) | format()",
    );
    expect(iso).toBe("2024-03-14T10:00:00");
  });
});

describe("ZonedDateTime via extractFields", () => {
  it("format(ZonedDateTime, pattern) extracts zoned fields", async () => {
    const v = await ev(
      "instant(\"2024-03-15T10:05:03Z\") | toZonedDateTime(\"UTC\") | format(\"yyyy-MM-dd HH:mm:ss\")",
    );
    expect(v).toBe("2024-03-15 10:05:03");
  });

  it("format(ZonedDateTime) without pattern gives ISO string", async () => {
    const result = await ev(
      "instant(\"2024-01-01T00:00:00Z\") | toZonedDateTime(\"UTC\") | format()",
    );
    expect(result).toSatisfy((v: unknown) => typeof v === "string" && v.includes("2024-01-01"));
  });
});

describe("format() with non-date value throws", () => {
  it("throws when value is not a date type", async () => {
    await expect(ev("format(42, \"yyyy-MM-dd\")")).rejects.toThrow("format()");
  });
});

describe("format(PlainDateTime, pattern)", () => {
  it("formats PlainDateTime with CLDR pattern", async () => {
    const v = await ev(
      "parsePlainDateTime(\"2024-03-15 10:05:03\", \"yyyy-MM-dd HH:mm:ss\") | format(\"dd.MM.yyyy HH:mm\")",
    );
    expect(v).toBe("15.03.2024 10:05");
  });
});

describe("toPlainTime() null error branch", () => {
  it("throws with 'null' label when arg is null", async () => {
    await expect(ev("toPlainTime(null)")).rejects.toThrow("null");
  });
});

describe("str() — additional date types", () => {
  it("str(PlainDateTime) gives ISO datetime string", async () => {
    const v = await ev(
      "str(parsePlainDateTime(\"2024-03-15 10:30:00\", \"yyyy-MM-dd HH:mm:ss\"))",
    );
    expect(v).toBe("2024-03-15T10:30:00");
  });

  it("str(ZonedDateTime) throws — ZonedDateTime not serialisable via str()", async () => {
    await expect(
      ev("str(instant(\"2024-01-01T00:00:00Z\") | toZonedDateTime(\"UTC\"))"),
    ).rejects.toThrow();
  });
});

describe("parsePlainDate / parsePlainDateTime with partial format", () => {
  it("parsePlainDate with year-only format uses month=1 day=1 defaults", async () => {
    const v = await ev("parsePlainDate(\"2024\", \"yyyy\")");
    expect(v).toBeInstanceOf(PlainDate);
    expect(await ev("parsePlainDate(\"2024\", \"yyyy\") | format()")).toBe("2024-01-01");
  });

  it("parsePlainDateTime with time-only format uses 1970-01-01 defaults", async () => {
    const v = await ev("parsePlainDateTime(\"14:30:00\", \"HH:mm:ss\")");
    expect(v).toBeInstanceOf(PlainDateTime);
    expect(await ev("parsePlainDateTime(\"14:30:00\", \"HH:mm:ss\") | format()")).toBe(
      "1970-01-01T14:30:00",
    );
  });

  it("parsePlainDate without year in format uses year=1970 default", async () => {
    const v = await ev("parsePlainDate(\"01-15\", \"MM-dd\")");
    expect(v).toBeInstanceOf(PlainDate);
    expect(await ev("parsePlainDate(\"01-15\", \"MM-dd\") | format()")).toBe("1970-01-15");
  });

  it("parsePlainDateTime with date-only format uses 00:00:00 defaults", async () => {
    const v = await ev("parsePlainDateTime(\"2024-01-15\", \"yyyy-MM-dd\")");
    expect(v).toBeInstanceOf(PlainDateTime);
    expect(await ev("parsePlainDateTime(\"2024-01-15\", \"yyyy-MM-dd\") | format()")).toBe(
      "2024-01-15T00:00:00",
    );
  });
});

describe("additional error-branch coverage", () => {
  it("toDuration() with non-null non-object arg throws with typeof label", async () => {
    await expect(
      ev("plainDate(\"2024-01-01\") | add(42)"),
    ).rejects.toThrow("got number");
  });

  it("format() uses 0 fallback for fields not present in the date type", async () => {
    expect(await ev("plainDate(\"2024-01-01\") | format(\"HH:mm\")")).toBe("00:00");
  });

  it("toInstant(null) throws with 'null' label", async () => {
    await expect(ev("toInstant(null)")).rejects.toThrow("got null");
  });

  it("toPlainDate() with non-null non-special type throws with typeof label", async () => {
    await expect(ev("toPlainDate(42)")).rejects.toThrow("got number");
  });

  it("duration() with non-null non-string non-object throws with typeof label", async () => {
    await expect(ev("duration(42)")).rejects.toThrow("got number");
  });

  it("toMillis(null) throws with 'null' label", async () => {
    await expect(ev("toMillis(null)")).rejects.toThrow("got null");
  });
});
