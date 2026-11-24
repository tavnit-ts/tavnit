### Type Coercion

<!-- contents -->
**Contents**

- [Conversion Rules](#conversion-rules)
- [Blank and empty values](#blank-and-empty-values)
<!-- /contents -->

`str(v)`, `num(v)`, `bool(v)` — explicit type conversions. Each throws
`ExpressionError` when given a value it cannot convert.

#### Conversion Rules

**`str(v)`** — converts to a string representation:

| Input type | Result |
|---|---|
| `string` | unchanged |
| `number` (finite) | decimal string — e.g. `str(42)` → `"42"`, `str(3.14)` → `"3.14"` |
| `number` (`NaN`, `Infinity`, `-Infinity`) | throws `ExpressionError` |
| `boolean` | `"true"` or `"false"` |
| `Instant` | ISO 8601 UTC string, same as `format(v)` with no pattern |
| `PlainDate` | ISO 8601 date string, same as `format(v)` with no pattern |
| `PlainTime` | ISO 8601 time string, same as `format(v)` with no pattern |
| `PlainDateTime` | ISO 8601 date-time string, same as `format(v)` with no pattern |
| `Duration` | ISO 8601 duration string |
| `null` | `""` |
| `array` | throws `ExpressionError` — use `json(v)` to serialise |
| `object` | throws `ExpressionError` — use `json(v)` to serialise |

**`num(v)`** — converts to a finite number:

| Input type | Result |
|---|---|
| `number` (finite) | unchanged |
| `number` (`NaN`, `Infinity`, `-Infinity`) | throws `ExpressionError` |
| `string` that parses as a finite number | parsed number — e.g. `num("42")` → `42`, `num("-3.5")` → `-3.5` |
| `string` that does not parse as a finite number | throws `ExpressionError` |
| `boolean` | throws `ExpressionError` |
| `null` | throws `ExpressionError` |
| `array`, `object`, date types | throws `ExpressionError` |

**`bool(v)`** — parses `"true"` / `"false"` strings or passes through a boolean.
Intended for string values from external data sources (API responses, config
fields) that carry boolean meaning:

| Input type | Result |
|---|---|
| `boolean` | unchanged |
| `string` `"true"` (any case) | `true` |
| `string` `"false"` (any case) | `false` |
| any other string | throws `ExpressionError` |
| `number`, `null`, `array`, `object`, date types | throws `ExpressionError` |

> **Note:** To test whether any value is truthy, use the ternary form
> `v ? true : false` rather than `bool(v)`. `bool(v)` is exclusively for
> parsing string representations of booleans.

`type(v)` — returns a string naming the runtime type of `v`: `"string"`, `"number"`, `"boolean"`, `"null"`, `"array"`, `"object"`, `"instant"`, `"plaindate"`, `"plaintime"`, `"plaindatetime"`, `"zoneddatetime"`, `"duration"`, `"function"`, or `"resolver"`. Error messages name types the same way. Useful for conditional dispatch on heterogeneous data:

```tavnit
type(v) == "array" ? size(v) : 1
items | filter(x => type(x.value) == "number")
```

`"function"` is returned for a function value — an arrow function bound with
`let`, or a bare registered filter name (`type(map)`). Data-context values are
never function values (see [Function Values](language.md#function-values)), so `"function"`
does not occur in heterogeneous collection data:

```tavnit
let f = x => x in type(f)   // "function"
```

### Parsing

`parseBool(v)` — parse a value to a boolean, accepting a wider range of inputs than
`bool(v)`. Intended for external data sources that encode booleans in diverse formats
(API responses, form inputs, CSV fields):

| Input | Result |
|---|---|
| `boolean` | unchanged |
| `"true"` / `"false"` (any case) | `true` / `false` |
| `"yes"` / `"no"` (any case) | `true` / `false` |
| `"1"` / `"0"` | `true` / `false` |
| `number` `0` | `false` |
| non-zero `number` | `true` |
| `null` | `false` |
| any other string, array, or object | throws `ExpressionError` |

> **Note:** `parseBool` is for parsing external string representations. For inline
> truthiness tests, use the ternary form `v ? true : false` or plain boolean operators.
> `bool(v)` remains for cases where only `"true"` / `"false"` string values are expected
> and broader input must be rejected.

`parseInteger(v)` — parse a string or finite number to an integer:

| Input | Result |
|---|---|
| `number` (finite integer) | unchanged |
| `number` (finite, non-integer) | truncated toward zero — e.g. `parseInteger(3.7)` → `3` |
| `string` that parses as a whole number (no decimal part) | parsed integer — e.g. `parseInteger("42")` → `42` |
| `string` with a decimal component or exponent | throws `ExpressionError` — use `parseFloat` instead (`parseInteger("1e2")` throws) |
| any other value | throws `ExpressionError` |

```tavnit
args.data | split(":") | last | parseInteger()    // last segment as integer
"42" | parseInteger()                              // 42
```

`parseFloat(v)` — parse a string or finite number to a floating-point number.
Named to pair with `parseInteger`, but **not** identical to `num(v)`: it uses
`Number.parseFloat`, so trailing non-numeric text is ignored:

| Input | Result |
|---|---|
| `number` (finite) | unchanged |
| `string` starting with a finite number | parsed number — `parseFloat("3.14")` → `3.14`, `parseFloat("3.14abc")` → `3.14` |
| `string` that does not start with a number | throws `ExpressionError` |
| any other value | throws `ExpressionError` |

```tavnit
"3.14"  | parseFloat()    // 3.14
"42"    | parseFloat()    // 42
"1.5e2" | parseFloat()    // 150
```

### Null Safety

`default(v, fallback)` — returns `fallback` if `v` is `null`
(pipe form: `v | default(fallback)`).

`coalesce(v1, v2, ..., vN)` — returns the first non-null argument:

```tavnit
coalesce(override, value, "default")
```

#### Blank and empty values

`default` and `coalesce` look at `null` only. An empty or whitespace-only string
needs the blank family, which replaces `(x ?? '') == ''` and `trim(x ?? '') != ''`:

| Call | Result |
|---|---|
| `blank(v)` | `true` for `null`, `""`, a string of only whitespace, `[]`, `{}` |
| `filled(v)` | `!blank(v)` |
| `isEmpty(v)` | `true` for `null`, `""` (not trimmed), `[]`, `{}` |
| `firstFilled(v1, …, vN)` | the first non-blank argument, `null` when there is none |

`0`, `false`, `[0]`, `[null]`, `{ a: null }`, dates and functions are never blank
or empty. A missing name reads as `null`, so `missing | blank` is `true`. The
first argument is the piped value: `a | firstFilled(b, "none")`. For arrays,
`joinFilled` is in [Collections](builtins-collections.md#collections).

```tavnit
name | blank                              // true for null, "" and "   "
note | filled ? note : "no note"
firstFilled(author, contact, "Client")    // first non-blank name
items | isEmpty
```

### Structural equality

`deepEquals(a, b)` — `true` when `a` and `b` have the same content. Arrays compare element
by element, objects key by key (key order does not matter), dates of one type by value,
scalars as `==` does, and `NaN` equals `NaN`. Functions are equal only to themselves.
Unlike `==`, it never compares arrays or objects by reference. Nesting deeper than 200
levels throws.

```tavnit
deepEquals([1, { a: 2 }], [1, { a: 2 }])   // true
deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 }) // true
deepEquals([1], ["1"])                     // false — no coercion
[1] == [1]                                 // false — references
```

### Arithmetic Helpers

Arithmetic is done with the operators `+ - * / % **`; there are no pipe-callable helpers (`plus`, `minus`, `times`, `dividedBy`, `modulo` were removed). To use the result in a pipe, parenthesise: `(price / lessons) | round`. The functions `round`, `floor`, `ceil`, `abs`, `min`, `max`, `sum` and `toFixed` take the value as first argument.

```tavnit
count + 1
(plan.price / (plan.lessons ?? 1)) | round
```

`toFixed(v, digits)` — format number `v` to exactly `digits` decimal places. Returns a `string`:

```tavnit
price | toFixed(2)      // "19.90"
ratio | toFixed(4)      // "0.3333"
"$" + (price | toFixed(2))
```

### Rounding

`round(v, digits?)`, `floor(v)`, `ceil(v)` and `abs(v)` take a number as the piped value and
return a `number` (unlike `toFixed`, which returns a string). A `null` or non-number input
throws, like the other arithmetic helpers: `round(null)` is
`round() requires a number, got null`.

| Function | Result |
|---|---|
| `round(v)` | nearest integer; a half rounds away from zero |
| `round(v, digits)` | nearest multiple of `10^-digits`; `digits` is an integer from 0 to 100 |
| `floor(v)` | largest integer not above `v` |
| `ceil(v)` | smallest integer not below `v` |
| `abs(v)` | absolute value |

```tavnit
2.5 | round                  // 3
-2.5 | round                 // -3
1.005 | round(2)             // 1.01
7.2 | floor                  // 7
7.2 | ceil                   // 8
-3 | abs                     // 3
```

For the sum, minimum or maximum of an array see
[`sum`, `min`, `max`](builtins-collections.md#sum-min-max-range).
