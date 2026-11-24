import type { Temporal as TemporalTypes } from "@js-temporal/polyfill";
import { temporal } from "../temporal.js";
import {
  EvaluationError,
  TavnitDuration,
  TavnitInstant,
  TavnitPlainDate,
  TavnitPlainDateTime,
  TavnitPlainTime,
  TavnitZonedDateTime,
  type FilterFn,
  type Value,
  typeName,
} from "../evaluator/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Coerce a Value to a Temporal.Duration.
 * Accepts TavnitDuration or a plain object literal with duration fields.
 */
function toDuration(v: Value): TemporalTypes.Duration {
  if (v instanceof TavnitDuration) return v._inner;
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, Value>;
    const init: Record<string, number> = {};
    for (const [k, val] of Object.entries(obj)) {
      if (typeof val !== "number") {
        throw new EvaluationError(
          `duration field "${k}" must be a number, got ${typeName(val)}`,
        );
      }
      init[k] = val;
    }
    try {
      return temporal().Duration.from(init);
    } catch {
      /* v8 ignore next -- @preserve */
      throw new EvaluationError("Invalid duration object");
    }
  }
  throw new EvaluationError(
    "Expected a Duration or duration-like object, got " +
      (v === null ? "null" : typeof v),
  );
}

// ── CLDR format helpers ───────────────────────────────────────────────────────

const CLDR_TOKENS = [
  { token: "yyyy", field: "year" },
  { token: "MM", field: "month" },
  { token: "dd", field: "day" },
  { token: "HH", field: "hour" },
  { token: "mm", field: "minute" },
  { token: "ss", field: "second" },
] as const;

type CldrFields = {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
};

function applyCldrFormat(fields: CldrFields, pattern: string): string {
  let result = pattern;
  for (const { token, field } of CLDR_TOKENS) {
    if (result.includes(token)) {
      const val = fields[field] ?? 0;
      const pad = token === "yyyy" ? 4 : 2;
      result = result.replaceAll(token, String(val).padStart(pad, "0"));
    }
  }
  return result;
}

function extractFields(v: Value): CldrFields {
  if (v instanceof TavnitInstant) {
    const pdt = v._inner.toZonedDateTimeISO("UTC").toPlainDateTime();
    return {
      year: pdt.year,
      month: pdt.month,
      day: pdt.day,
      hour: pdt.hour,
      minute: pdt.minute,
      second: pdt.second,
    };
  }
  if (v instanceof TavnitPlainDate) {
    return { year: v._inner.year, month: v._inner.month, day: v._inner.day };
  }
  if (v instanceof TavnitPlainTime) {
    return { hour: v._inner.hour, minute: v._inner.minute, second: v._inner.second };
  }
  if (v instanceof TavnitPlainDateTime) {
    return {
      year: v._inner.year,
      month: v._inner.month,
      day: v._inner.day,
      hour: v._inner.hour,
      minute: v._inner.minute,
      second: v._inner.second,
    };
  }
  if (v instanceof TavnitZonedDateTime) {
    return {
      year: v._inner.year,
      month: v._inner.month,
      day: v._inner.day,
      hour: v._inner.hour,
      minute: v._inner.minute,
      second: v._inner.second,
    };
  }
  throw new EvaluationError(
    "format() requires an Instant, PlainDate, PlainTime, PlainDateTime, or ZonedDateTime",
  );
}

// ── parsePlainDate / parsePlainDateTime helpers ───────────────────────────────

function parseDateFormat(
  str: string,
  fmt: string,
): Record<string, number> {
  let regexStr = "^";
  const fieldOrder: string[] = [];
  let pos = 0;
  while (pos < fmt.length) {
    let found = false;
    for (const { token, field } of CLDR_TOKENS) {
      if (fmt.startsWith(token, pos)) {
        const isYear = token === "yyyy";
        regexStr += isYear ? String.raw`(\d{4})` : String.raw`(\d{2})`;
        fieldOrder.push(field);
        pos += token.length;
        found = true;
        break;
      }
    }
    if (!found) {
      regexStr += fmt[pos].replace(/[$()*+./?[\\\]^{|}]/g, String.raw`\$&`);
      pos++;
    }
  }
  regexStr += "$";

  const match = new RegExp(regexStr).exec(str);
  if (!match) {
    throw new EvaluationError(
      `Cannot parse "${str}" with format "${fmt}"`,
    );
  }
  const result: Record<string, number> = {};
  for (let i = 0; i < fieldOrder.length; i++) {
    result[fieldOrder[i]] = Number.parseInt(match[i + 1], 10);
  }
  return result;
}

// ── Construction built-ins ────────────────────────────────────────────────────

const now: FilterFn = () =>
  new TavnitInstant(temporal().Now.instant());

const today: FilterFn = () =>
  new TavnitPlainDate(temporal().Now.plainDateISO("UTC"));

const instant: FilterFn = (v) => {
  if (typeof v !== "string") {
    throw new EvaluationError("instant() requires a string");
  }
  try {
    return new TavnitInstant(temporal().Instant.from(v));
  } catch {
    throw new EvaluationError(`Invalid Instant string: "${v}"`);
  }
};

const plainDate: FilterFn = (v) => {
  if (typeof v !== "string") {
    throw new EvaluationError("plainDate() requires a string");
  }
  try {
    return new TavnitPlainDate(temporal().PlainDate.from(v));
  } catch {
    throw new EvaluationError(`Invalid PlainDate string: "${v}"`);
  }
};

const toInstant: FilterFn = (v) => {
  if (v instanceof TavnitInstant) return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new EvaluationError("toInstant() requires a finite number");
    }
    return new TavnitInstant(temporal().Instant.fromEpochMilliseconds(v));
  }
  if (typeof v === "string") {
    try {
      return new TavnitInstant(temporal().Instant.from(v));
    } catch {
      throw new EvaluationError(`Cannot convert to Instant: "${v}"`);
    }
  }
  throw new EvaluationError(
    `toInstant() requires a string or number (Unix ms), got ${typeName(v)}`,
  );
};

const toPlainDate: FilterFn = (v) => {
  if (v instanceof TavnitPlainDate) return v;
  if (v instanceof TavnitInstant) {
    return new TavnitPlainDate(
      v._inner.toZonedDateTimeISO("UTC").toPlainDate(),
    );
  }
  if (v instanceof TavnitPlainDateTime) {
    return new TavnitPlainDate(v._inner.toPlainDate());
  }
  if (typeof v === "string") {
    try {
      return new TavnitPlainDate(temporal().PlainDate.from(v));
    } catch {
      throw new EvaluationError(`Cannot convert to PlainDate: "${v}"`);
    }
  }
  throw new EvaluationError(
    `toPlainDate() requires a string, Instant, or PlainDateTime, got ${typeName(v)}`,
  );
};

const toPlainTime: FilterFn = (v) => {
  if (v instanceof TavnitPlainTime) return v;
  if (v instanceof TavnitPlainDateTime) {
    return new TavnitPlainTime(v._inner.toPlainTime());
  }
  if (typeof v === "string") {
    try {
      return new TavnitPlainTime(temporal().PlainTime.from(v));
    } catch {
      throw new EvaluationError(`Cannot convert to PlainTime: "${v}"`);
    }
  }
  throw new EvaluationError(
    `toPlainTime() requires a string or PlainDateTime, got ${typeName(v)}`,
  );
};

const duration: FilterFn = (v) => {
  if (v instanceof TavnitDuration) return v;
  if (typeof v === "string") {
    try {
      return new TavnitDuration(temporal().Duration.from(v));
    } catch {
      throw new EvaluationError(`Invalid Duration string: "${v}"`);
    }
  }
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return new TavnitDuration(toDuration(v));
  }
  throw new EvaluationError(
    `duration() requires a string or object, got ${typeName(v)}`,
  );
};

// ── Arithmetic built-ins ──────────────────────────────────────────────────────

/**
 * Add a duration to an Instant.
 * Temporal.Instant only accepts time-based durations directly.
 * Calendar durations (days, weeks, months, years) require a ZonedDateTime
 * intermediary; we use UTC so the result is unambiguous.
 */
function instantAdd(
  inst: TemporalTypes.Instant,
  dur: TemporalTypes.Duration,
  op: "add" | "subtract",
): TemporalTypes.Instant {
  try {
    return inst.toZonedDateTimeISO("UTC")[op](dur).toInstant();
  } catch (e) {
    /* v8 ignore next -- @preserve */
    throw new EvaluationError(`${op}() failed: ${e instanceof Error ? e.message : e}`);
  }
}

const add: FilterFn = (v, durArg = null) => {
  const dur = toDuration(durArg);
  if (v instanceof TavnitInstant) {
    return new TavnitInstant(instantAdd(v._inner, dur, "add"));
  }
  if (v instanceof TavnitPlainDate) {
    try {
      return new TavnitPlainDate(v._inner.add(dur));
    } catch (e) {
      /* v8 ignore next -- @preserve */
      throw new EvaluationError(`add() failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (v instanceof TavnitPlainDateTime) {
    try {
      return new TavnitPlainDateTime(v._inner.add(dur));
    } catch (e) {
      /* v8 ignore next -- @preserve */
      throw new EvaluationError(`add() failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new EvaluationError(
    "add() requires an Instant, PlainDate, or PlainDateTime as the first argument",
  );
};

const subtract: FilterFn = (v, durArg = null) => {
  const dur = toDuration(durArg);
  if (v instanceof TavnitInstant) {
    return new TavnitInstant(instantAdd(v._inner, dur, "subtract"));
  }
  if (v instanceof TavnitPlainDate) {
    try {
      return new TavnitPlainDate(v._inner.subtract(dur));
    } catch (e) {
      /* v8 ignore next -- @preserve */
      throw new EvaluationError(`subtract() failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (v instanceof TavnitPlainDateTime) {
    try {
      return new TavnitPlainDateTime(v._inner.subtract(dur));
    } catch (e) {
      /* v8 ignore next -- @preserve */
      throw new EvaluationError(`subtract() failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new EvaluationError(
    "subtract() requires an Instant, PlainDate, or PlainDateTime as the first argument",
  );
};

const until: FilterFn = (v, other = null) => {
  if (v instanceof TavnitInstant && other instanceof TavnitInstant) {
    return new TavnitDuration(v._inner.until(other._inner));
  }
  if (v instanceof TavnitPlainDate && other instanceof TavnitPlainDate) {
    return new TavnitDuration(v._inner.until(other._inner));
  }
  if (v instanceof TavnitPlainDateTime && other instanceof TavnitPlainDateTime) {
    return new TavnitDuration(v._inner.until(other._inner));
  }
  if (v instanceof TavnitPlainTime && other instanceof TavnitPlainTime) {
    return new TavnitDuration(v._inner.until(other._inner));
  }
  throw new EvaluationError(
    "until() requires two values of the same date/time type",
  );
};

const toMillis: FilterFn = (v) => {
  if (!(v instanceof TavnitDuration)) {
    throw new EvaluationError(
      `toMillis() requires a Duration, got ${typeName(v)}`,
    );
  }
  try {
    return v._inner.total({
      unit: "milliseconds",
      // Fixed reference point makes calendar units deterministic
      relativeTo: temporal().PlainDateTime.from("1970-01-01T00:00:00"),
    });
  } catch (e) {
    /* v8 ignore start -- @preserve */
    throw new EvaluationError(
      `toMillis() failed: ${e instanceof Error ? e.message : e}`,
    );
    /* v8 ignore stop -- @preserve */
  }
};

const get: FilterFn = (v, field = null) => {
  if (!(v instanceof TavnitDuration)) {
    throw new EvaluationError("get() requires a Duration as the first argument");
  }
  if (typeof field !== "string") {
    throw new EvaluationError("get() field must be a string");
  }
  const d = v._inner;
  const fieldMap: Record<string, number> = {
    years: d.years,
    months: d.months,
    weeks: d.weeks,
    days: d.days,
    hours: d.hours,
    minutes: d.minutes,
    seconds: d.seconds,
    milliseconds: d.milliseconds,
    microseconds: d.microseconds,
    nanoseconds: d.nanoseconds,
  };
  if (!(field in fieldMap)) {
    throw new EvaluationError(
      `get() unknown duration field: "${field}". Valid fields: years, months, weeks, days, hours, minutes, seconds, milliseconds`,
    );
  }
  return fieldMap[field];
};

// ── Formatting and conversion built-ins ───────────────────────────────────────

const format: FilterFn = (v, pattern = null) => {
  if (pattern === null || pattern === undefined) {
    // No pattern: ISO 8601 default
    if (v instanceof TavnitInstant) return v._inner.toString();
    if (v instanceof TavnitPlainDate) return v._inner.toString();
    if (v instanceof TavnitPlainTime) return v._inner.toString();
    if (v instanceof TavnitPlainDateTime) return v._inner.toString();
    if (v instanceof TavnitZonedDateTime) return v._inner.toString();
    throw new EvaluationError(
      "format() requires an Instant, PlainDate, PlainTime, PlainDateTime, or ZonedDateTime",
    );
  }
  if (typeof pattern !== "string") {
    throw new EvaluationError("format() pattern must be a string");
  }
  const fields = extractFields(v);
  return applyCldrFormat(fields, pattern);
};

const toZonedDateTime: FilterFn = (v, tz = null) => {
  if (!(v instanceof TavnitInstant)) {
    throw new EvaluationError("toZonedDateTime() requires an Instant");
  }
  if (typeof tz !== "string") {
    throw new EvaluationError("toZonedDateTime() requires a timezone string");
  }
  try {
    return new TavnitZonedDateTime(v._inner.toZonedDateTimeISO(tz));
  } catch {
    throw new EvaluationError(`Invalid timezone: "${tz}"`);
  }
};

/**
 * Calendar-relative label for a ZonedDateTime, judged against `reference` in the
 * same time zone: today → time; yesterday / tomorrow → the locale's word + time;
 * later → short weekday + day.month + time; earlier this year → day.month + time;
 * another year → the full date. Temporal decides the calendar bucket, Intl
 * supplies the words and field order for `locale`.
 */
/** The `formatCalendar` label parts, as `Intl.DateTimeFormat` options. */
const CALENDAR_PARTS = {
  time: { hour: "2-digit", minute: "2-digit" },
  dayMonth: { day: "2-digit", month: "2-digit" },
  dayMonthYear: { day: "2-digit", month: "2-digit", year: "numeric" },
  weekday: { weekday: "short" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/** Distinct locale × time zone × part formatters kept before the cache starts over. */
const MAX_CALENDAR_FORMATTERS = 256;
const calendarFormatters = new Map<string, Intl.DateTimeFormat>();
const relativeDayFormatters = new Map<string, Intl.RelativeTimeFormat>();

/**
 * `zdt` formatted as one `formatCalendar` part. Constructing an `Intl` formatter costs
 * hundreds of microseconds, formatting with one about a microsecond, and
 * `ZonedDateTime.toLocaleString` constructs one per call — so the formatters are cached.
 */
function formatCalendarPart(zdt: TemporalTypes.ZonedDateTime, tag: string, part: keyof typeof CALENDAR_PARTS): string {
  const key = `${tag}\u0000${zdt.timeZoneId}\u0000${part}`;
  let formatter = calendarFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(tag, { ...CALENDAR_PARTS[part], timeZone: zdt.timeZoneId });
    if (calendarFormatters.size >= MAX_CALENDAR_FORMATTERS) calendarFormatters.clear();
    calendarFormatters.set(key, formatter);
  }
  return formatter.format(zdt.epochMilliseconds);
}

/** «yesterday» / «tomorrow» in `tag`, from a cached `Intl.RelativeTimeFormat`. */
function formatRelativeDay(days: 1 | -1, tag: string): string {
  let formatter = relativeDayFormatters.get(tag);
  if (formatter === undefined) {
    formatter = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    if (relativeDayFormatters.size >= MAX_CALENDAR_FORMATTERS) relativeDayFormatters.clear();
    relativeDayFormatters.set(tag, formatter);
  }
  return formatter.format(days, "day");
}

const formatCalendar: FilterFn = (v, reference = null, locale = null) => {
  if (!(v instanceof TavnitZonedDateTime)) {
    throw new EvaluationError("formatCalendar() requires a ZonedDateTime");
  }
  let refInstant: TemporalTypes.Instant;
  if (reference instanceof TavnitInstant) refInstant = reference._inner;
  else if (reference instanceof TavnitZonedDateTime) refInstant = reference._inner.toInstant();
  else {
    throw new EvaluationError("formatCalendar() requires an Instant or ZonedDateTime reference");
  }
  if (locale !== null && typeof locale !== "string") {
    throw new EvaluationError("formatCalendar() locale must be a string");
  }
  const zdt = v._inner;
  const date = zdt.toPlainDate();
  const refDate = refInstant.toZonedDateTimeISO(zdt.timeZoneId).toPlainDate();
  const days = refDate.until(date, { largestUnit: "days" }).days;
  const tag = locale ?? "en";
  try {
    const time = formatCalendarPart(zdt, tag, "time");
    if (days === 0) return time;
    if (days === 1 || days === -1) return `${formatRelativeDay(days, tag)} ${time}`;
    const day = formatCalendarPart(zdt, tag, date.year === refDate.year ? "dayMonth" : "dayMonthYear");
    if (days > 0) {
      const weekday = formatCalendarPart(zdt, tag, "weekday");
      return `${weekday} ${day} ${time}`;
    }
    return `${day} ${time}`;
  } catch {
    throw new EvaluationError(`formatCalendar() invalid locale: "${tag}"`);
  }
};

const toEpochMs: FilterFn = (v) => {
  if (!(v instanceof TavnitInstant)) {
    throw new EvaluationError("toEpochMs() requires an Instant");
  }
  return v._inner.epochMilliseconds;
};

const toEpochSeconds: FilterFn = (v) => {
  if (!(v instanceof TavnitInstant)) {
    throw new EvaluationError("toEpochSeconds() requires an Instant");
  }
  return Math.trunc(v._inner.epochMilliseconds / 1000);
};

const fromEpochSeconds: FilterFn = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new EvaluationError("fromEpochSeconds() requires a finite number");
  }
  return new TavnitInstant(temporal().Instant.fromEpochMilliseconds(v * 1000));
};

// ── Non-ISO parsing built-ins ─────────────────────────────────────────────────

const parsePlainDate: FilterFn = (v, fmt = null) => {
  if (typeof v !== "string") {
    throw new EvaluationError("parsePlainDate() requires a string as first argument");
  }
  if (typeof fmt !== "string") {
    throw new EvaluationError("parsePlainDate() requires a format string as second argument");
  }
  const fields = parseDateFormat(v, fmt);
  try {
    return new TavnitPlainDate(
      temporal().PlainDate.from(
        { year: fields.year ?? 1970, month: fields.month ?? 1, day: fields.day ?? 1 },
        { overflow: "reject" },
      ),
    );
  } catch {
    throw new EvaluationError(
      `parsePlainDate() invalid date "${v}" for format "${fmt}"`,
    );
  }
};

const parsePlainDateTime: FilterFn = (v, fmt = null) => {
  if (typeof v !== "string") {
    throw new EvaluationError("parsePlainDateTime() requires a string as first argument");
  }
  if (typeof fmt !== "string") {
    throw new EvaluationError("parsePlainDateTime() requires a format string as second argument");
  }
  const fields = parseDateFormat(v, fmt);
  try {
    return new TavnitPlainDateTime(
      temporal().PlainDateTime.from(
        {
          year: fields.year ?? 1970,
          month: fields.month ?? 1,
          day: fields.day ?? 1,
          hour: fields.hour ?? 0,
          minute: fields.minute ?? 0,
          second: fields.second ?? 0,
        },
        { overflow: "reject" },
      ),
    );
  } catch {
    throw new EvaluationError(
      `parsePlainDateTime() invalid datetime "${v}" for format "${fmt}"`,
    );
  }
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const datetimeBuiltins: Record<string, FilterFn> = {
  now,
  today,
  instant,
  plainDate,
  toInstant,
  toPlainDate,
  toPlainTime,
  duration,
  add,
  subtract,
  until,
  toMillis,
  get,
  format,
  toZonedDateTime,
  formatCalendar,
  toEpochMs,
  toEpochSeconds,
  fromEpochSeconds,
  parsePlainDate,
  parsePlainDateTime,
};
