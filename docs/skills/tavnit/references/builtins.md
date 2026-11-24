## Built-in Functions

The built-in set is intentionally small. Every built-in is a pure function with
no side effects. Custom filters extend this set through the
[filter registry](typescript-api.md#filter-registration).

All built-ins are callable as plain functions (`fn(value, args)`) or via pipe
(`value | fn(args)`) — see [Function Calls and Pipe](language.md#function-calls-and-pipe).

### Quick Reference

| Function | Signature | Notes |
|---|---|---|
| **— Type —** | | |
| [`str`](builtins-types.md#type-coercion) | `str(v)` → `string` — coerce any value to a string; `null` → `""` | [Conversion Rules](builtins-types.md#conversion-rules) |
| [`num`](builtins-types.md#type-coercion) | `num(v)` → `number` — coerce to a finite number; throws on non-numeric input | [Conversion Rules](builtins-types.md#conversion-rules) |
| [`bool`](builtins-types.md#type-coercion) | `bool(v)` → `boolean` — parse `"true"`/`"false"` strings; rejects all other input | [Conversion Rules](builtins-types.md#conversion-rules) |
| [`type`](builtins-types.md#type-coercion) | `type(v)` → `string` — runtime type name: `"string"`, `"number"`, `"array"`, `"null"`, … | |
| [`deepEquals`](builtins-types.md#structural-equality) | `deepEquals(a, b)` → `boolean` — structural equality of arrays, objects and dates; `==` compares arrays and objects by reference | [Comparison](language.md#comparison) |
| **— Parse —** | | |
| [`parseBool`](builtins-types.md#parsing) | `parseBool(v)` → `boolean` — parse boolean from diverse formats: `"yes"`, `"1"`, `0`, … | |
| [`parseInteger`](builtins-types.md#parsing) | `parseInteger(v)` → `number` — parse string or number to integer; throws on decimal strings | |
| [`parseFloat`](builtins-types.md#parsing) | `parseFloat(v)` → `number` — parse string or finite number to float | |
| **— Null —** | | |
| [`default`](builtins-types.md#null-safety) | `default(v, fallback)` → `Value` — return `fallback` if `v` is `null` | [Null Safety](builtins-types.md#null-safety) |
| [`coalesce`](builtins-types.md#null-safety) | `coalesce(v1, …, vN)` → `Value` — return first non-null argument | [Null Safety](builtins-types.md#null-safety) |
| [`blank`](builtins-types.md#blank-and-empty-values) | `blank(v)` → `boolean` — `true` for `null`, `""`, a whitespace-only string, `[]` and `{}`; `0` and `false` are not blank | [Blank and empty values](builtins-types.md#blank-and-empty-values) |
| [`filled`](builtins-types.md#blank-and-empty-values) | `filled(v)` → `boolean` — the negation of `blank(v)` | |
| [`isEmpty`](builtins-types.md#blank-and-empty-values) | `isEmpty(v)` → `boolean` — `true` for `null`, `""`, `[]` and `{}`; unlike `blank`, a string is not trimmed | |
| [`firstFilled`](builtins-types.md#blank-and-empty-values) | `firstFilled(v1, …, vN)` → `Value` — first non-blank argument, else `null` | |
| **— Math —** | | |
| [`toFixed`](builtins-types.md#arithmetic-helpers) | `toFixed(v, digits)` → `string` — format number to fixed decimal places | |
| [`round`](builtins-types.md#rounding) | `round(v, digits?)` → `number` — round half away from zero to `digits` places (default `0`) | |
| [`floor`](builtins-types.md#rounding) | `floor(v)` → `number` — largest integer not above `v` | |
| [`ceil`](builtins-types.md#rounding) | `ceil(v)` → `number` — smallest integer not below `v` | |
| [`abs`](builtins-types.md#rounding) | `abs(v)` → `number` — absolute value | |
| **— Collections —** | | |
| [`size`](builtins-collections.md#collections) | `size(v)` → `number` — array length, string length, or object key count | |
| [`map`](builtins-collections.md#collections) | `map(arr, fn)` → `array` — transform each element | always `[]`, never `null` |
| [`filter`](builtins-collections.md#collections) | `filter(arr, fn)` → `array` — keep elements where `fn` is truthy | always `[]`, never `null` |
| [`find`](builtins-collections.md#collections) | `find(arr, fn)` → `Value \| null` — first element where `fn` is truthy | returns `null` if no match; use `?.` on result |
| [`some`](builtins-collections.md#collections) | `some(arr, fn)` → `boolean` — true if any element satisfies `fn` | |
| [`every`](builtins-collections.md#collections) | `every(arr, fn)` → `boolean` — true if all elements satisfy `fn` | |
| [`reduce`](builtins-collections.md#collections) | `reduce(arr, fn, init?)` → `Value` — fold left; `fn` receives `(accumulator, item)`; `init` defaults to `null` | |
| [`flatMap`](builtins-collections.md#collections) | `flatMap(arr, fn)` → `array` — map then flatten one level | always `[]`, never `null` |
| [`flatten`](builtins-collections.md#collections) | `flatten(arr, depth?)` → `array` — flatten nested arrays; `depth` defaults to `Infinity` | always `[]`, never `null` |
| [`join`](builtins-collections.md#collections) | `join(arr, separator?)` → `string` — join array elements into a string; separator defaults to `","` | |
| [`concat`](builtins-collections.md#collections) | `concat(arr1, arr2?)` → `array` — concatenate two arrays | always `[]`, never `null` |
| [`joinFilled`](builtins-collections.md#collections) | `joinFilled(arr, separator?)` → `string` — drop blank items, join the rest; `null` gives `""`; separator defaults to `","` | |
| [`compact`](builtins-collections.md#collections) | `compact(arr)` → `array` — remove all `null` values; keeps `0`, `false`, `""` | always `[]`, never `null` |
| [`reverse`](builtins-collections.md#collections) | `reverse(arr)` → `array` — reverse order; returns a new array | always `[]`, never `null` |
| [`sort`](builtins-collections.md#collections) | `sort(arr, fn?, { locale }?)` → `array` — sort ascending, by key extractor, or by comparator; `{ locale: "ru" }` orders strings by that language; new array | always `[]`, never `null` |
| [`uniqBy`](builtins-collections.md#collections) | `uniqBy(arr, fn)` → `array` — deduplicate by key extractor; keeps first occurrence | always `[]`, never `null` |
| [`groupBy`](builtins-collections.md#collections) | `groupBy(arr, fn)` → `object` — group into `{ [key]: item[] }` by key extractor | |
| [`keyBy`](builtins-collections.md#collections) | `keyBy(arr, fn)` → `object` — map into `{ [key]: item }` by key extractor | later item wins on duplicate keys |
| [`sum`](builtins-collections.md#sum-min-max-range) | `sum(arr)` → `number` — total of an array of numbers; `0` for `[]` | every element must be a number |
| [`min`](builtins-collections.md#sum-min-max-range) | `min(arr)` → `number \| null` — smallest element of an array of numbers; `null` for `[]` | every element must be a number |
| [`max`](builtins-collections.md#sum-min-max-range) | `max(arr)` → `number \| null` — largest element of an array of numbers; `null` for `[]` | every element must be a number |
| [`range`](builtins-collections.md#sum-min-max-range) | `range(end)` / `range(start, end, step?)` → `number[]` — `start` up to but not including `end` | counts against `maxIterations` |
| [`indexOf`](builtins-collections.md#collections) | `indexOf(arr\|str, value)` → `number` — zero-based index of first match, or `-1` | |
| [`first`](builtins-collections.md#first-last-slice) | `first(arr)` → `Value \| null` — first element, or `null` on empty array | returns `null` on empty; use `?.` on result |
| [`last`](builtins-collections.md#first-last-slice) | `last(arr)` → `Value \| null` — last element, or `null` on empty array | returns `null` on empty; use `?.` on result |
| [`slice`](builtins-collections.md#first-last-slice) | `slice(arr, from, to)` → `array` — subarray; returns `[]` if range is out of bounds | always `[]`, never `null` |
| [`chunk`](builtins-collections.md#first-last-slice) | `chunk(arr, size)` → `array` — split into consecutive sub-arrays of length `size` | `size` required, positive integer |
| **— Strings —** | | |
| [`includes`](builtins-strings.md#strings) | `includes(str, substr)` → `boolean` — true if `str` contains `substr` | |
| [`startsWith`](builtins-strings.md#strings) | `startsWith(str, prefix)` → `boolean` — true if `str` begins with `prefix` | |
| [`endsWith`](builtins-strings.md#strings) | `endsWith(str, suffix)` → `boolean` — true if `str` ends with `suffix` | |
| [`split`](builtins-strings.md#strings) | `split(str, delimiter)` → `string[]` — split into array; `""` splits to characters | |
| [`toUpperCase`](builtins-strings.md#strings) | `toUpperCase(str)` → `string` — convert to uppercase | |
| [`toLowerCase`](builtins-strings.md#strings) | `toLowerCase(str)` → `string` — convert to lowercase | |
| [`trim`](builtins-strings.md#strings) | `trim(str)` → `string` — remove leading and trailing whitespace | |
| [`squish`](builtins-strings.md#strings) | `squish(str)` → `string` — collapse all whitespace runs to a single space and trim | |
| [`trimStart`](builtins-strings.md#strings) | `trimStart(str)` → `string` — remove leading whitespace | |
| [`trimEnd`](builtins-strings.md#strings) | `trimEnd(str)` → `string` — remove trailing whitespace | |
| [`padStart`](builtins-strings.md#strings) | `padStart(str, n, fill?)` → `string` — left-pad to length `n` | |
| [`padEnd`](builtins-strings.md#strings) | `padEnd(str, n, fill?)` → `string` — right-pad to length `n` | |
| [`replace`](builtins-strings.md#strings) | `replace(str, search, replacement)` → `string` — replace first occurrence (literal strings) | |
| [`replaceAll`](builtins-strings.md#strings) | `replaceAll(str, search, replacement)` → `string` — replace all occurrences (literal strings) | |
| [`remove`](builtins-strings.md#strings) | `remove(str, substr)` → `string` — remove all occurrences of `substr` | |
| [`append`](builtins-strings.md#strings) | `append(str, suffix)` → `string` — concatenate `suffix` to `str` | |
| [`truncate`](builtins-strings.md#strings) | `truncate(str, n)` → `string` — limit to `n` code units, never splitting a surrogate pair | |
| [`chunks`](builtins-strings.md#strings) | `chunks(str, maxLen, separators?)` → `string[]` — split into pieces of at most `maxLen` characters, preferring the given separators | `[]` for `""` |
| [`indent`](builtins-strings.md#strings) | `indent(str, n)` → `string` — prepend `n` spaces to each line | |
| [`stripNewlines`](builtins-strings.md#strings) | `stripNewlines(str)` → `string` — remove all newline characters | |
| [`matches`](builtins-strings.md#strings) | `matches(str, pattern)` → `boolean` — regex test; never throws for non-matches | |
| [`capture`](builtins-strings.md#strings) | `capture(str, pattern, group)` → `string` — capture group content; `""` if no match | |
| [`captures`](builtins-strings.md#strings) | `captures(str, pattern)` → `array \| null` — every capture group of the first match, 1-based order; `null` if no match | unmatched optional group is `""`; test with `?? ` / `?.` |
| **— Objects —** | | |
| [`pick`](builtins-objects.md#objects) | `pick(obj, …keys)` → `object` — return object with only the listed keys | |
| [`omit`](builtins-objects.md#objects) | `omit(obj, …keys)` → `object` — return object without the listed keys | |
| [`keys`](builtins-objects.md#objects) | `keys(obj)` → `string[]` — own enumerable key names | |
| [`values`](builtins-objects.md#objects) | `values(obj)` → `Value[]` — own enumerable values | |
| [`path`](builtins-objects.md#objects) | `path(obj, dotPath)` → `Value` — dynamic dot-path access resolved at runtime | |
| **— Serialise —** | | |
| [`json`](builtins-objects.md#serialisation) | `json(v)` → `string` — JSON.stringify; preferred for API bodies and storage | [json vs yaml](builtins-objects.md#json-vs-yaml) |
| [`yaml`](builtins-objects.md#serialisation) | `yaml(v)` → `string` — YAML dump; preferred for AI prompt injection | [json vs yaml](builtins-objects.md#json-vs-yaml) |
| **— Encoding —** | | |
| [`btoa`](builtins-objects.md#encoding) | `btoa(str)` → `string` — Base64-encode | |
| [`atob`](builtins-objects.md#encoding) | `atob(str)` → `string` — Base64-decode | |
| [`base64urlEncode`](builtins-objects.md#encoding) | `base64urlEncode(str)` → `string` — Base64url-encode the UTF-8 bytes of `str` | |
| [`base64urlEncodeHex`](builtins-objects.md#encoding) | `base64urlEncodeHex(hex)` → `string` — decode a hex string to bytes and Base64url-encode them (`sha256(x) \| base64urlEncodeHex`) | |
| [`encodeURIComponent`](builtins-objects.md#encoding) | `encodeURIComponent(str)` → `string` — percent-encode a URI component | |
| [`decodeURIComponent`](builtins-objects.md#encoding) | `decodeURIComponent(str)` → `string` — decode a percent-encoded URI component | |
| **— Crypto —** | | |
| [`sha256`](builtins-objects.md#crypto) | `sha256(str)` → `string` — SHA-256 hex digest | |
| [`hmacSha256`](builtins-objects.md#crypto) | `hmacSha256(key, message)` → `string` — HMAC-SHA256 hex digest | |
| [`timingSafeEqualHex`](builtins-objects.md#crypto) | `timingSafeEqualHex(expected, received)` → `boolean` — compare hex bytes without an early mismatch exit | |
| [`uuid`](builtins-objects.md#crypto) | `uuid()` → `string` — random UUID v4 | |
| [`ulid`](builtins-objects.md#crypto) | `ulid()` → `string` — 26-char time-sortable ULID | |
| [`randomString`](builtins-objects.md#crypto) | `randomString(n, charset?)` → `string` — random string of length `n` | |
| **— Date / Time —** | | |
| [`now`](datetime.md#date-and-time) | `now()` → `Instant` — current UTC instant | |
| [`today`](datetime.md#date-and-time) | `today()` → `PlainDate` — today's date in UTC | |
| [`instant`](datetime.md#construction) | `instant(str)` → `Instant` — parse ISO 8601 UTC string | [Construction](datetime.md#construction) |
| [`plainDate`](datetime.md#construction) | `plainDate(str)` → `PlainDate` — parse ISO 8601 date string | [Construction](datetime.md#construction) |
| [`toInstant`](datetime.md#construction) | `toInstant(v)` → `Instant` — coerce ZonedDateTime or string to Instant | [Construction](datetime.md#construction) |
| [`toPlainDate`](datetime.md#construction) | `toPlainDate(v)` → `PlainDate` — extract or parse a plain date | [Construction](datetime.md#construction) |
| [`toPlainTime`](datetime.md#construction) | `toPlainTime(v)` → `PlainTime` — extract or parse a plain time | [Construction](datetime.md#construction) |
| [`duration`](datetime.md#construction) | `duration(v)` → `Duration` — parse ISO 8601 duration string or field object | [Construction](datetime.md#construction) |
| [`toZonedDateTime`](datetime.md#construction) | `toZonedDateTime(instant, tz)` → `ZonedDateTime` — attach timezone to an Instant | [Construction](datetime.md#construction) |
| [`add`](datetime.md#date-arithmetic) | `add(date, dur)` → `Instant \| PlainDate \| PlainDateTime` — add a duration | [Date Arithmetic](datetime.md#date-arithmetic) |
| [`subtract`](datetime.md#date-arithmetic) | `subtract(date, dur)` → `Instant \| PlainDate \| PlainDateTime` — subtract a duration | [Date Arithmetic](datetime.md#date-arithmetic) |
| [`until`](datetime.md#date-arithmetic) | `until(date, other)` → `Duration` — duration between two dates | [Date Arithmetic](datetime.md#date-arithmetic) |
| [`toMillis`](datetime.md#date-arithmetic) | `toMillis(dur)` → `number` — duration in milliseconds | |
| [`get`](datetime.md#date-arithmetic) | `get(dur, field)` → `number` — extract duration field (`"years"`, `"days"`, …) | |
| [`format`](datetime.md#formatting) | `format(v, pattern?)` → `string` — format date/time to string; ISO 8601 by default | [Formatting](datetime.md#formatting) |
| [`formatCalendar`](datetime.md#formatting) | `formatCalendar(zdt, reference, locale?)` → `string` — calendar-relative label: time today, «yesterday/tomorrow» + time, else the date | [Formatting](datetime.md#formatting) |
| [`parsePlainDate`](datetime.md#formatting) | `parsePlainDate(str, format)` → `PlainDate` — parse with custom CLDR format pattern | [Formatting](datetime.md#formatting) |
| [`parsePlainDateTime`](datetime.md#formatting) | `parsePlainDateTime(str, format)` → `PlainDateTime` — parse with custom CLDR format pattern | [Formatting](datetime.md#formatting) |
| [`toEpochMs`](datetime.md#interoperability-with-numeric-timestamps) | `toEpochMs(instant)` → `number` — Unix timestamp in milliseconds | [Interoperability](datetime.md#interoperability-with-numeric-timestamps) |
| [`toEpochSeconds`](datetime.md#interoperability-with-numeric-timestamps) | `toEpochSeconds(instant)` → `number` — Unix timestamp in seconds | [Interoperability](datetime.md#interoperability-with-numeric-timestamps) |
| [`fromEpochSeconds`](datetime.md#interoperability-with-numeric-timestamps) | `fromEpochSeconds(n)` → `Instant` — Instant from Unix seconds | [Interoperability](datetime.md#interoperability-with-numeric-timestamps) |
