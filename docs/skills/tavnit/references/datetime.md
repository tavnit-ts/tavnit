### Date and Time

<!-- contents -->
**Contents**

- [Type Model](#type-model)
- [Construction](#construction)
- [Date Arithmetic](#date-arithmetic)
- [Date Comparison](#date-comparison)
- [Formatting](#formatting)
- [Interoperability with Numeric Timestamps](#interoperability-with-numeric-timestamps)
<!-- /contents -->

Tavnit represents dates as typed values — not raw numbers or strings. Results
are opaque `Instant`, `PlainDate`, and `Duration` objects that can be passed
between filters, compared with operators, and stored in context. This eliminates
type-coercion steps entirely:

```
// LiquidJS — opaque, error-prone, requires a magic constant
'now' | date: '%s' | plus: 0 | minus: 259200

// Tavnit — typed, readable, no coercion
now() | subtract({ days: 3 })
```

Tavnit's date model is inspired by the TC39 Temporal API (Stage 3; shipping in
Node.js 22+).

#### Type Model

**`Instant`** — a fixed UTC point in time, equivalent to `Temporal.Instant`.
Sub-millisecond precision from `now()`; `toInstant(number)` is millisecond.
Correct for "happened before/after" comparisons across machines and timezones.

**`PlainDate`** — a calendar date (year, month, day) with no time component,
equivalent to `Temporal.PlainDate`. Correct for business-logic dates: expiry
dates, lesson schedules, event dates.

**`PlainDateTime`** — a calendar date and time (year, month, day, hour, minute,
second) with no time zone, equivalent to `Temporal.PlainDateTime`. Correct for
wall-clock datetimes that carry both date and time but have no UTC anchor:
lesson schedules, appointment times, or any datetime stored with an implied
local timezone. Supports `<`, `>`, `<=`, `>=`, `==`, `!=` comparisons and
`format()` with CLDR pattern tokens. Produced by `parsePlainDateTime()`.

**`Duration`** — an amount of time, equivalent to `Temporal.Duration`. Accepts
a field object (`{ days: 3 }`, `{ months: 1, hours: 2 }`) or an ISO 8601
duration string (`"P3D"`, `"PT2H30M"`).

**`PlainTime`** — a time-of-day without a date, equivalent to
`Temporal.PlainTime`. Used when scheduling data stores time-of-day separately
from dates. Supports `<`, `>`, `<=`, `>=`, `==`, `!=` comparisons and
`format()` with `HH`, `mm`, `ss` CLDR tokens.

**`ZonedDateTime`** — produced by `toZonedDateTime(tz)` on an `Instant`. Used
only for timezone-aware formatting; it cannot be compared.

The date types are **opaque in the expression grammar**: internal properties
(e.g. `epochNanoseconds`) are not accessible, and only registered Tavnit
functions create or inspect them. They are ordinary runtime values in every
other respect — they can be stored in context, bound with `let`, and passed
between filters.

#### Construction

```tavnit
now()                              // Instant — current UTC moment
today()                            // PlainDate — today in UTC

instant("2024-01-15T10:00:00Z")    // Instant from ISO string
plainDate("2024-01-15")            // PlainDate from ISO string

createdAt | toInstant()       // Instant from ISO string or Unix ms
dateStr   | toPlainDate()     // PlainDate from ISO string
timeStr   | toPlainTime()     // PlainTime from ISO time string

duration({ days: 3 })
duration("P3D")
duration({ months: 1, days: 15 })
```

**Parsing non-ISO strings** — external APIs often return dates in non-ISO
formats. Use `parsePlainDate` and `parsePlainDateTime` with a Unicode CLDR
format string (same tokens as `format()`):

```tavnit
parsePlainDate("15.03.2024", "dd.MM.yyyy")
// => PlainDate 2024-03-15

parsePlainDateTime("15.03.2024 10:30:00", "dd.MM.yyyy HH:mm:ss")
// => PlainDateTime 2024-03-15T10:30:00

// then use as a normal date value
parsePlainDate(record.b_date, "dd.MM.yyyy") | format("yyyy-MM-dd")
parsePlainDate(record.b_date, "dd.MM.yyyy") <= today()
```

#### Date Arithmetic

`add(date, duration)` and `subtract(date, duration)` accept a `Duration` value
or a plain object literal coerced to `Duration` at the call site. The result
type matches the input type — `Instant` in, `Instant` out; `PlainDate` in,
`PlainDate` out; `PlainDateTime` in, `PlainDateTime` out:

```tavnit
now() | subtract({ days: 3 })
now() | add({ weeks: 2 })
today() | add({ days: 1 })
today() | subtract({ months: 1 })
now() | subtract(retentionWindow)    // using a pre-built Duration
```

> **YAML quoting — object duration literals contain `: `.** When a `subtract`
> or `add` call with an object literal appears as a standalone YAML scalar, the
> `key: value` inside `{ days: 3 }` contains colon-space, which YAML parses as
> a nested mapping before the template engine runs. Quote the whole YAML value
> to prevent this:
>
> ```yaml
> # FAILS — YAML sees "days: 3" as a nested mapping
> since: ${{ now() | subtract({ days: 180 }) | toEpochSeconds() }}
>
> # Correct — single-quote the value so YAML treats it as a plain scalar
> since: '${{ now() | subtract({ days: 180 }) | toEpochSeconds() }}'
>
> # Alternative — use an ISO 8601 duration string (no colon-space issue)
> since: ${{ now() | subtract(duration("P180D")) | toEpochSeconds() }}
> ```
>
> Expressions with no object literals — `now() | toEpochSeconds()`,
> `today() | add(retentionWindow)` — need no quoting.

`until(date, other)` — returns the `Duration` from `date` to `other`, so a
positive result means `other` is later. Both sides must be the same date type.
Use the receiver as the **earlier** value for a "time remaining" number:

```tavnit
// days remaining until expiry
today() | until(expiryDate | toPlainDate()) | get("days")

// elapsed since a start instant
until(toInstant(startTime), now()) | toMillis()
```

`toMillis(duration)` — convert a `Duration` to a millisecond number.

`get(duration, field)` — extract a named field from a `Duration`
(e.g. `"days"`, `"hours"`, `"minutes"`).

#### Date Comparison

The comparison operators (`<`, `>`, `<=`, `>=`) work directly on `Instant`,
`PlainDate`, `PlainTime`, and `PlainDateTime` values — but **only between two
values of the same date type**. `now() > today()` throws
`Operator '>' cannot compare instant and plaindate; convert one to the other's type (toInstant, toPlainDate)`; convert first
(`toInstant(a) > now()`), and note that `==` on mixed types is a plain identity
check that returns `false` rather than throwing.

```tavnit
toInstant(event.date) > now()

toPlainDate(plan.startDate) <= today()
  && toPlainDate(plan.endDate) >= today()

messages | filter(x => toInstant(x.date) > subtract(now(), { days: 3 }))
```

**The pipe direction matters.** `event.date | toInstant() > now()` parses as
`(event.date | toInstant()) > now()` and works. The reversed form
`event.date > now() | toInstant()` parses as `(event.date > now()) | toInstant()`
and throws, because `>` is evaluated first on two different types. Write the
function-call form when in doubt.

#### Formatting

`format(v, pattern?)` — convert an `Instant`, `PlainDate`, `PlainTime`, or
`PlainDateTime` to a string. With no pattern, produces an ISO 8601 string.

With a pattern, exactly these six tokens are substituted, longest first, by
plain string replacement:

| Token | Meaning | Example |
|---|---|---|
| `yyyy` | 4-digit year | `2024` |
| `MM` | 2-digit month (01–12) | `03` |
| `dd` | 2-digit day (01–31) | `15` |
| `HH` | 2-digit hour, 24 h (00–23) | `10` |
| `mm` | 2-digit minute (00–59) | `30` |
| `ss` | 2-digit second (00–59) | `00` |

**Every other character passes through literally, including other CLDR tokens.**
There is no month-name or weekday-name formatting and no pattern validation —
an unsupported token is emitted verbatim rather than rejected:

```tavnit
today() | format("MMMM")      // "0303"  — "MM" replaced twice, not "January"
today() | format("d.M.yyyy")  // "d.M.2026" — "d" and "M" are literals
today() | format("EEEE")      // "EEEE"
today() | format("%Y-%m-%d")  // "%Y-%m-%d" — strftime tokens are not translated
```

```tavnit
now()     | format()                        // "2024-01-15T10:00:00.123456789Z" — now() is nanosecond-precise
today()   | format()                        // "2024-01-15"
today()   | format("dd.MM.yyyy")            // "15.01.2024"
now()     | format("yyyy-MM-dd HH:mm")
timeStr   | toPlainTime() | format()        // "14:30:00"
timeStr   | toPlainTime() | format("HH:mm") // "14:30"
```

An instant re-formats with the precision it was constructed with:
`instant("2024-01-15T10:00:00.000Z") | format()` → `"2024-01-15T10:00:00Z"`.

`toZonedDateTime(instant, tz)` — convert an `Instant` to a timezone-aware view
for use with `format`. It cannot be compared; it can be stored and passed
between filters:

```tavnit
toZonedDateTime(now(), "Europe/Moscow") | format("yyyy-MM-dd HH:mm")
```

`formatCalendar(zdt, reference, locale?)` — a short label for a
`ZonedDateTime`, judged against `reference` (an `Instant` or `ZonedDateTime`)
by calendar day in `zdt`'s zone. `locale` is a BCP 47 tag, `"en"` by default;
the words, weekday names and field order come from it:

| Day of `zdt` relative to `reference` | `"ru"` | `"en"` |
|---|---|---|
| same day | `18:34` | `06:34 PM` |
| previous / next day | `вчера 18:34` / `завтра 11:00` | `yesterday 06:34 PM` |
| later | `вт 29.09 18:00` | `Tue 09/29 06:00 PM` |
| earlier, same year | `20.09 12:05` | `09/20 12:05 PM` |
| earlier or later, another year | `31.12.2025 12:05` (later: with weekday) | `12/31/2025 12:05 PM` |

Pass `now()` as the reference rather than letting the function read the clock —
a test that freezes `now()` then gets a fixed label:

```tavnit
toInstant(ts) | toZonedDateTime("Europe/Moscow") | formatCalendar(now(), "ru")
```

#### Interoperability with Numeric Timestamps

`toEpochMs(instant)` — convert an `Instant` to a Unix millisecond number for
downstream APIs that expect milliseconds:

```tavnit
now() | subtract({ days: 3 }) | toEpochMs()
```

`toEpochSeconds(instant)` — convert an `Instant` to a Unix epoch seconds
integer. Use this when the downstream API expects seconds (OAuth `expires_in`
arithmetic, legacy storage, external API timestamps):

```tavnit
now() | toEpochSeconds()
now() | subtract({ days: 3 }) | toEpochSeconds()
```

`fromEpochSeconds(n)` — construct an `Instant` from a Unix epoch seconds
number. The counterpart to `toEpochSeconds()`, and the correct replacement for
the legacy `instant_epoch` filter when migrating:

```tavnit
legacyEpochSecs | fromEpochSeconds()
fromEpochSeconds(expiresAt) > now()
```

`toInstant(v)` accepts a Unix **millisecond** number. When migrating legacy
code that stores timestamps as seconds, use `fromEpochSeconds()` directly or
multiply before calling `toInstant()`:

```tavnit
// legacy epoch-seconds → Instant (two equivalent forms)
legacyEpochSecs | fromEpochSeconds()
legacyEpochSecs * 1000 | toInstant()

// Instant → epoch seconds (for APIs that expect seconds)
now() | toEpochSeconds()

// regular ms path (unchanged)
toInstant(legacyMs) > subtract(now(), { hours: 1 })
```

---
