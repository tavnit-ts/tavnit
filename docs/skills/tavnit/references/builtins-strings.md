### Strings

<!-- contents -->
**Contents:** `includes`, `split`, `toUpperCase`, `squish`, `remove`, `append`, `truncate`, `substring`, `left`, `chunks`, `stripNewlines`, `indent`, `matches`, `createEngine`, `replace`, `replaceAll`, `trim`, `padStart`
<!-- /contents -->

`includes(str, substr)`, `startsWith(str, prefix)`, `endsWith(str, suffix)`.

`split(str, delimiter)` — split a string into an array of substrings at each occurrence of `delimiter`. Returns an empty array when `str` is empty. If `delimiter` is not found, returns a single-element array containing `str`:

```tavnit
"a:b:c" | split(":")            // ["a", "b", "c"]
"hello" | split("")             // ["h", "e", "l", "l", "o"]
args.data | split(":") | last   // last segment
```

`toUpperCase(str)`, `toLowerCase(str)` — the JavaScript names; the Liquid `upcase` / `downcase` do not exist.

`squish(str)` — collapse all whitespace runs (spaces, tabs, newlines) to a single space and trim leading/trailing whitespace:

```tavnit
"  hello   world  " | squish   // "hello world"
input | squish                 // normalize user-supplied text
```

`remove(str, substr)` — remove all occurrences (equivalent to
`str.replaceAll(substr, "")`).

`append(str, suffix)` — concatenate `suffix` to `str`.

`truncate(str, n)` — keep the first `n` characters. `n` is truncated to an
integer; a negative `n` therefore slices from the end (`"hello" | truncate(-1)`
→ `"hell"`). Length is counted in UTF-16 code units, so an emoji takes two; a
cut that would fall inside a surrogate pair moves one unit left, so the result
never contains a lone surrogate and can be one unit shorter than `n`:

```tavnit
"a😀b" | truncate(2)   // → "a" — the emoji is dropped, not cut in half
```

`substring(str, start, end?)` — the characters from `start` (inclusive) to `end`
(exclusive); `end` defaults to the length. Indexes are truncated to integers and
count UTF-16 code units, so an emoji takes two. A negative index counts from the end
and one past either end is clamped, as in [`slice`](builtins-collections.md#first-last-slice):
the result is `""` when `start` is not before `end`, never an error. `null` for `start`
or `end` means the default. Like `truncate`, a cut that would fall inside a surrogate
pair drops the dangling half, at either edge. A non-string `str` or a non-number index throws:

```tavnit
"hello world" | substring(6)       // → "world"
"hello world" | substring(0, 5)    // → "hello"
"hello" | substring(-3)            // → "llo"
"hello" | substring(-3, -1)        // → "ll"
"hello" | substring(9)             // → ""
"a😀b" | substring(1, 2)           // → "" — half an emoji is dropped
```

`left(str, n)` — the first `n` characters; `right(str, n)` — the last `n`.
`n` is truncated to an integer and counted in code units. Unlike `truncate`, a
negative `n` gives `""`, and an `n` over the length gives the whole string.
A cut inside a surrogate pair drops the dangling half, so the result can be one unit shorter:

```tavnit
"hello" | left(2)      // → "he"
"hello" | right(2)     // → "lo"
"hello" | right(0)     // → ""
"hello" | left(-1)     // → ""
"a😀b" | right(2)      // → "b" — the emoji is dropped, not cut in half
```

`chunks(str, maxLen, separators?)` — split `str` into an array of substrings each no longer than `maxLen` characters. Tries each separator in `separators` (default `["\n\n", "\n"]`) in priority order: finds the last occurrence of that separator before the limit, splits there (consuming the separator), and repeats. Falls back to a hard character split when no separator fits. Returns `[]` for an empty string:

```tavnit
"long text here" | chunks(4000)          // → ["long text here"] if ≤ 4000 chars
args.body | chunks(4000)                 // split for a 4000-character message limit
args.body | chunks(4096, ["\n\n", "\n"]) // the default separators, given explicitly
args.body | chunks(1000, ["\n\n", "\n", ". ", " "])  // prefer paragraph, then sentence
```

`stripNewlines(str)` — remove all newline characters.

`indent(str, n)` — prepend `n` spaces to each line.

`matches(str, pattern)` — boolean regex test. `capture(str, pattern, group)` —
returns the content of capture group `group` (1-based integer) from the first
match; returns `""` when there is no match. `captures(str, pattern)` returns all
groups of the first match as an array (`[]` for a pattern without groups; a group
that did not take part is `""`), or `null` when there is no match — one regex run
for several groups, and `?? ` / `?.` tell a miss from a match.

The pattern is in **RE2 syntax**, run by a linear-time engine that never backtracks, so no
pattern can run away and a subject may be of any length. There are no flags. The test is a
**substring** match, not a full-string match — anchor with `^`/`$` when the whole string must
match. Character classes, quantifiers (greedy and lazy), alternation, anchors, `\b`, `\d`, `\w`,
numbered and named capture groups (`(?<n>…)`), non-capturing groups, `\p{…}` Unicode classes
and the inline flags `(?i)`, `(?s)`, `(?m)` work. `.`, `\s`, `\S`, `\uXXXX` and `\cX` mean what they
mean in JavaScript (`\s` takes the no-break space and the Unicode spaces; `.` excludes `\r`,
U+2028 and U+2029). Lookahead, lookbehind and backreferences do not exist in RE2: the engine
names the feature it refuses. An astral character (an emoji) is one character here, where
JavaScript counts two units.

`createEngine({ regex: "native" })` switches the three functions to JavaScript's own
`RegExp`: lookahead and backreferences work (lookbehinds stay refused), and `safe-regex2` plus
a structural check refuse patterns that can backtrack badly, and a subject over 100 000
characters is refused. Use it only for patterns written by someone you trust.

`matches` returns `false` on a non-matching input and never throws for that case.
A pattern the engine cannot compile throws `ExpressionError`: `Invalid regular expression: …`
for a syntax error, `… pattern uses a lookahead / a backreference, which the linear regex engine
does not support; set regex: 'native' on the engine` for those features. In native mode an unsafe
pattern reports `Potentially unsafe regular expression: …`.

```tavnit
"user@example.com" | matches("[^@]+@[^@]+")           // true
"2024-01-15" | capture("(\d{4})-(\d{2})-(\d{2})", 1)  // "2024"
"2024-01-15" | capture("(\d{4})-(\d{2})-(\d{2})", 2)  // "01"
"2024-01-15" | captures("(\d{4})-(\d{2})-(\d{2})")     // ["2024", "01", "15"]
"hello" | captures("(\d+)")                              // null
```

`replace(str, search, replacement)` — replace the first occurrence of `search` with `replacement`. `search` is a literal string; `replacement` goes through JavaScript's replacement-pattern expansion, so `$&` inserts the match:

```tavnit
"hello world" | replace("world", "there")    // "hello there"
path | replace("/old/", "/new/")
"a" | replace("a", "$&$&")                   // "aa" — not the literal "$&$&"
```

`replaceAll(str, search, replacement)` — replace every occurrence of `search` with `replacement`, with the same `$` expansion. Equivalent to `remove(str, search)` when `replacement` is `""`:

```tavnit
"aabbcc" | replaceAll("b", "x")    // "aaxxcc"
template | replaceAll("{name}", name)
```

`trim(str)` — remove leading and trailing whitespace. `trimStart(str)` removes only leading whitespace; `trimEnd(str)` removes only trailing whitespace.

`padStart(str, n, fill?)` — pad the beginning of `str` with `fill` until the total length is `n`. `fill` defaults to `" "`. `padEnd(str, n, fill?)` pads the end instead:

```tavnit
"42"  | padStart(5, "0")    // "00042"
"hi"  | padEnd(5, ".")      // "hi..."
hour  | str | padStart(2, "0")   // zero-pad a clock digit
```

#### Building strings from nullable fields

When composing a string from several fields that may be `null`, use
`compact` + `join` rather than chaining `?? ""` guards inside `+` expressions:

```tavnit
// verbose — hard to read, fragile to extend
let name = plan.title ?? plan.name
in name ? (name + ' ' + (plan.startDate ?? '') + '–' + (plan.endDate ?? '')) : 'none'

// idiomatic — collect, drop nulls, join
let parts = [
    plan.title ?? plan.name,
    plan.startDate,
    plan.endDate
  ]
in parts | compact | join(" ")
```

To also drop empty and whitespace-only strings, use `joinFilled(parts, " ")` —
`parts | joinFilled(" ")` replaces `parts | compact | join(" ")` when the parts
may be `""`. `compact` removes `null` values from the array; `join` concatenates the
survivors with the separator. See [`compact`](builtins-collections.md#collections) in the Collections
section. For a fixed separator between always-present parts, `+` concatenation
is still fine — `compact` + `join` shines when the number of non-null fields
varies at runtime.
