---
name: tavnit
description: >
  Tavnit expression language — writing, reading, and debugging ${{ }} expressions and ${% if/for %}
  block tags in YAML/JSON configuration and TypeScript. Use when writing Tavnit expressions or block
  tags, using built-in functions (map, filter, sort, date/time, string manipulation, crypto,
  encoding), building YAML value trees (spreads, $if / $unless guards, the `_` subtree hole),
  configuring an engine (createEngine, derive, compile, custom filters, secretRoots, runtime limits,
  maxOutputBytes), understanding operator precedence or pipe syntax, diagnosing an ExpressionError
  message or a template that renders wrong without one, or migrating from LiquidJS to Tavnit.
allowed-tools: Read
---

> **Skill structure:** See [STRUCTURE.md](STRUCTURE.md). You MUST read STRUCTURE.md before modifying this skill.

# Tavnit Skill

## Scope

Using Tavnit: `${{ }}` expressions and `${% if/for %}` block tags in YAML/JSON values and strings,
built-in functions, engine configuration, custom filters, and errors. Developing the engine itself
(`src/`) is covered by the package `AGENTS.md`.

**Load the reference file for the topic before answering** — prefer a correct answer from the docs
over a fast one from memory. If the references do not cover it, say so and offer to check the source.
For an error message, start with [errors.md](references/errors.md).

## Cheat-sheet

```
price * qty                              // arithmetic
active ? "yes" : "no"                    // ternary
user?.address?.city ?? "unknown"         // optional chaining + nullish coalescing
"urgent" in tags                         // membership
items | filter(x => x.active)            // pipe + arrow
items | map(x => x.id) | join(",")       // pipe chain
let tax = price * 0.2 in price + tax     // let…in binding
now() | subtract({ days: 3 })            // date arithmetic

${% if count > 0 %}${{ count }} items${% else %}No items${% endif %}
${% for item in items %}${{ forloop.index1 }}. ${{ item.name }}
${% endfor %}
```

## Top pitfalls

- **No `contains` and no `...arr` in an expression.** Membership is `x in arr`; a substring
  test is `includes(str, sub)` — see
  [Built-in Functions](references/builtins.md#quick-reference).
- **`==` on arrays and objects compares references:** `[1] == [1]` is `false` — use
  `deepEquals(a, b)`. `1 == "1"` is `false` too — see
  [Comparison](references/language.md#comparison).
- **A typo is an error, not `null`:** the engine is strict by default, so an unknown name, a missing
  field and a property the type lacks (`a.length` on an array — use `size(a)`) raise with the nearest
  name; `??` names a default for an optional one. `createEngine({ strict: false })` is the lenient
  reading, where all of them are `null` — see [Strict mode](references/language.md#strict-mode).
- **`1 / 0` is an error by default** (`divisionByZero: "error"`); `"infinity"` gives `Infinity` — see
  [Strict mode](references/language.md#strict-mode).
- **`append` and `includes` are string-only.** Arrays: `arr | concat([item])`, `x in arr`.
- **`keyBy` / `groupBy` / `sort` / `uniqBy` take a function, not a field name:** `keyBy(items, x => x.id)`.
- **A `let`-bound lambda cannot be called** — `f(2)` is `Unknown function 'f'`; pass it on: `map(f)`.
- **`.x` on `null` throws** — `?.` on every step that may be null — see
  [Null and Error Propagation](references/language.md#null-and-error-propagation).
- **A `null` key throws too:** `index[id]` with `id` null — write `index[id ?? 0]`.
- **`a + b | fn()` pipes `(a + b)`**; operators after the pipe apply to its result — see
  [Function Calls and Pipe](references/language.md#function-calls-and-pipe).
- **A span in a YAML flow mapping silently becomes `"$"`** — use block mappings; a value
  containing `: ` needs quotes — see [YAML Quoting Rules](references/embedding.md#yaml-quoting-rules).
- **A long expression is usually the wrong shape.** A `map` body that builds a record or tree
  belongs in YAML — the `_` subtree hole or a host function — see
  [Value Templates](references/value-templates.md).

## Reference files

The order of the tables is the order of `docs/UserGuide.md`.

**Language**

| File | Load when |
|---|---|
| [intro.md](references/intro.md) | Getting started, key concepts, installing Tavnit, design goals |
| [embedding.md](references/embedding.md) | `${{ }}` in strings and YAML fields, expression vs text-embedding mode, type preservation, YAML quoting, keeping `${{ }}` at the leaves |
| [block-tags.md](references/block-tags.md) | `${% if/elif/else %}`, `${% for %}`, `forloop`, block-tag whitespace, escaping `${%` |
| [value-templates.md](references/value-templates.md) | A YAML tree with expressions in it: object / array spread `...`, `$if` / `$unless` node guards, the `_` / `$_` subtree hole, a node or record per row, why a key disappeared |
| [language.md](references/language.md) | Values and types, literals, operators and precedence, truthiness, null handling, optional chaining, ternary, pipes, arrow functions, `let … in` |

**Built-in functions**

| File | Load when |
|---|---|
| [builtins.md](references/builtins.md) | Which built-in functions exist — one-line quick reference of all of them |
| [builtins-types.md](references/builtins-types.md) | `str` / `num` / `bool` / `type`, `parseInteger` / `parseFloat` / `parseBool`, `default` / `coalesce`, `toFixed` |
| [builtins-collections.md](references/builtins-collections.md) | `map` / `filter` / `find` / `reduce` / `flatMap`, sorting, grouping, `keyBy`, dedup, `concat`, `slice`, `compact`, `chunk` |
| [builtins-strings.md](references/builtins-strings.md) | `includes` / `split` / `replace` / `trim` / `squish`, regex `matches` / `capture`, `truncate`, `chunks`, padding |
| [builtins-objects.md](references/builtins-objects.md) | `pick` / `omit` / `keys` / `values` / `path`, `json` / `yaml`, base64 and URL encoding, `sha256` / `hmacSha256`, `uuid`, random strings |
| [datetime.md](references/datetime.md) | `now` / `today`, instants and plain dates, date arithmetic, comparison, formatting, time zones, durations, epoch conversion, parsing |

**Host and engine**

| File | Load when |
|---|---|
| [security.md](references/security.md) | The sandbox model, runtime limits (`maxIterations`, `maxDepth`, `timeoutMs`, `maxOutputBytes`), `secretRoots`, process isolation |
| [typescript-api.md](references/typescript-api.md) | `createEngine` / `derive` / `compile`, lean engines and built-in selection (`/core`, `/builtins/*`, `/regex-linear`, `/temporal-polyfill`), custom filters, the shared `Cache`, `parse` / `evaluate` / `render` / `renderObject`, the sync methods, `analyze` / `check`, the host entry point, `ValueTemplate`, `Resolver`, `ExpressionError` |

**Troubleshooting and migration**

| File | Load when |
|---|---|
| [errors.md](references/errors.md) | An error message — its cause and fix; a template that renders wrong without an error; parser quirks |
| [other-engines.md](references/other-engines.md) | Migrating from LiquidJS; how Tavnit differs from Liquid, CEL, JEXL, JSONata |
