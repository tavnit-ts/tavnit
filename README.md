# @tavnit-ts/tavnit

[![CI](https://github.com/tavnit-ts/tavnit/actions/workflows/ci.yml/badge.svg)](https://github.com/tavnit-ts/tavnit/actions/workflows/ci.yml)

A constrained expression evaluator with text templates and value templates.
Expressions are sandboxed — no `eval`, no prototype access, no global scope —
and keep their result type.

**It is** a small expression language for configuration, message templates and data mapping,
where the template author is not fully trusted. **It is not** a general template language with
includes and layouts, and not a programming language: no statements, no recursion, no access to
the host beyond the data and the filters you hand it. Requires Node 24 or later; ESM only; loads
in a browser or an edge runtime.

> **Written entirely with LLMs.** All code, tests and documentation in this repository are produced
> by LLM coding agents under a maintainer who reviews and releases the result. See
> [AI_DISCLOSURE.md](AI_DISCLOSURE.md).

## Installation

```bash
npm install @tavnit-ts/tavnit
```

## Quick Start

```typescript
import { createEngine, type Value } from "@tavnit-ts/tavnit";

const engine = createEngine({
  filters: { usd: (v: Value): Value => `$${Number(v).toFixed(2)}` },
});

await engine.evaluate("price * qty", { price: 10, qty: 3 });
// => 30 (number)

await engine.render("Total: ${{ price | usd }}", { price: 19.9 });
// => "Total: $19.90"
```

## A short tour

```typescript
// Types are kept: a bare expression returns a number, not a string.
await engine.evaluate("items | filter(i => i.qty > 0) | map(i => i.qty * i.price) | size", ctx);

// Text templates interpolate `${{ expr }}` and take `${% if %}` / `${% for %}` blocks.
await engine.render("${% for u in users %}${{ u.name | toUpperCase }}, ${% endfor %}", ctx);

// Value templates walk a YAML or JSON tree and evaluate every string in it.
await engine.renderObject({ title: "Hi ${{ name }}", total: "${{ a + b }}" }, ctx);

// Dates and times use Temporal.
await engine.evaluate('parsePlainDate(d, "dd.MM.yyyy") | format("yyyy-MM-dd")', { d: "31.12.2026" });
```

A source with no async filter and no `Resolver` also runs without a promise
(`engine.evaluateSync`, `renderSync`, `renderObjectSync`), and `engine.analyze` / `engine.check` list
the names a template uses and report the ones a host does not provide, before a run.
Host integration (`Resolver`, `contextFilter`, `EvaluationOptions`) is in `@tavnit-ts/tavnit/host`.

## Errors and strict mode

Every method throws `ExpressionError`. Each diagnostic carries a stable `code` (`TAV_NULL_ACCESS`,
`TAV_UNKNOWN_NAME`, `TAV_LIMIT_ITERATIONS` and others), a source position, and for a limit the
option to raise. `error.format()` prints the diagnostic with a source excerpt and a caret:

```typescript
import { ExpressionError } from "@tavnit-ts/tavnit";

try {
  await engine.evaluate("user.name | upcas()", { user: { name: "Ada" } });
} catch (error) {
  if (error instanceof ExpressionError) console.error(error.format());
}
```

By default an unknown name, a missing field and a property the type lacks (`items.length` on an
array) are errors with the nearest known name, and a division by zero is an error.
`createEngine({ strict: false })` reads them as `null` (`${{ typo }}` renders as an empty string)
and divides by zero to `Infinity`; see the changelog.

## Grammar

The grammar is small. [language.md](docs/skills/tavnit/references/language.md) owns the rules; this section is the map.

**Literals**

| Kind | Examples |
|---|---|
| String | `"text"`, `'text'` |
| Number | `42`, `3.14`, `1e3`, `1.5e-3` (IEEE doubles, exact to 2^53) |
| Boolean, null | `true`, `false`, `null` |
| Array, object | `[1, 2, 3]`, `{ key: value }`, `{ "key": value }` |

**Operators**, highest precedence first ([full table](docs/skills/tavnit/references/language.md#precedence-table)):

| Level | Operators | Meaning |
|---|---|---|
| 1-3 | `(expr)`, `.` `?.` `[key]` `?.[key]`, `fn(args)` | grouping, access, call |
| 4 | `!` `not` `-`; `**` (right) | unary, power |
| 5-6 | `*` `/` `%`; `+` `-` | arithmetic |
| 7-8 | `<` `>` `<=` `>=`; `==` `!=` | comparison (`==` is strict; arrays and objects by reference) |
| 9 | `in` | membership |
| 10-12 | `&&` `and`; `\|\|` `or`; `??` | logic, nullish coalescing |
| 13 | `? :` | ternary |
| 14 | `\|` | pipe |
| 15-16 | `=>`; `let … in` | arrow function, local binding |

**Forms**

| Form | Example |
|---|---|
| Pipe | `items \| map(x => x.id) \| join(",")` |
| Arrow function | `filter(items, x => x.active)` |
| `let … in` | `let tax = price * 0.2 in price + tax` |
| Ternary | `active ? "yes" : "no"` |
| Optional chaining, default | `user?.address?.city ?? "unknown"` |
| Block tags (text templates) | `${% if n > 0 %}…${% elif n == 0 %}…${% else %}…${% endif %}`, `${% for x in xs %}…${% endfor %}` with `forloop.index1` |

Block tags are in [block-tags.md](docs/skills/tavnit/references/block-tags.md), the YAML tree
forms (`...`, `$if`, `$unless`, `_`) in [value-templates.md](docs/skills/tavnit/references/value-templates.md).

## Built-in functions

Each built-in works as `fn(value, …)` or as `value | fn(…)`. The
[quick reference](docs/skills/tavnit/references/builtins.md#quick-reference) lists every signature.

| Category | Built-ins | Reference |
|---|---|---|
| Types and null | `str`, `num`, `bool`, `type`, `parseInteger`, `parseFloat`, `parseBool`, `default`, `coalesce`, `blank`, `filled`, `isEmpty`, `deepEquals` | [builtins-types.md](docs/skills/tavnit/references/builtins-types.md) |
| Math | `toFixed`, `round`, `floor`, `ceil`, `abs` | [builtins-types.md](docs/skills/tavnit/references/builtins-types.md) |
| Collections | `size`, `map`, `filter`, `find`, `some`, `every`, `reduce`, `flatMap`, `sort`, `groupBy`, `keyBy`, `uniqBy`, `concat`, `slice`, `sum`, `min`, `max`, `range`, … | [builtins-collections.md](docs/skills/tavnit/references/builtins-collections.md) |
| Strings and regex | `includes`, `split`, `replace`, `trim`, `squish`, `toUpperCase`, `truncate`, `matches`, `capture`, … | [builtins-strings.md](docs/skills/tavnit/references/builtins-strings.md) |
| Objects, encoding, crypto | `pick`, `omit`, `keys`, `values`, `path`, `json`, `yaml`, `btoa`, `sha256`, `hmacSha256`, `uuid`, `randomString`, … | [builtins-objects.md](docs/skills/tavnit/references/builtins-objects.md) |
| Date and time | `now`, `today`, `add`, `subtract`, `until`, `format`, `parsePlainDate`, `toEpochMs`, … | [datetime.md](docs/skills/tavnit/references/datetime.md) |

## Security and limits

Safety is structural: the grammar has no way to reach a prototype, a global or a function that
was not registered. Resource use is bounded per engine: `maxDepth`, `maxIterations`, `timeoutMs`
`maxOutputBytes`, `maxStringLength` and `maxRegexInput`, plus a fixed limit on parse nesting.
Regular expressions (`matches`, `capture`, `captures`) run a linear-time engine in RE2 syntax, so a
hostile pattern cannot stall an engine; `regex: "native"` opts into JavaScript's `RegExp` for
lookahead and backreferences. `secretRoots` keeps named context values out of error messages. Read the
[security reference](docs/skills/tavnit/references/security.md) for what the limits do and do not
cover, notably that `timeoutMs` cannot interrupt a single built-in already running.

## Entry points

`@tavnit-ts/tavnit` is the supported API with every built-in registered. A host that ships to a browser or
a phone selects what it bundles. Sizes are minified and gzipped, measured by `pnpm run size`
(Vite 8, `scripts/size-ceilings.json`):

| Import | Holds | Bundle |
|---|---|---|
| `@tavnit-ts/tavnit` | the API with every built-in, the linear regex engine and the Temporal polyfill | about 152 KB |
| `@tavnit-ts/tavnit/core` | the same API, `createEngine` without built-ins | about 20 KB |
| `@tavnit-ts/tavnit/builtins/<name>` | one category: `types`, `strings`, `regex`, `collections`, `objects`, `yaml`, `encoding`, `crypto`, `datetime` | `core` + `types` + `strings` + `collections` + `objects` + `encoding` about 26 KB; plus `datetime` on a runtime with `Temporal` about 28 KB |
| `@tavnit-ts/tavnit/regex-linear` | `linearRegex`, the linear-time regex engine | +50 KB (`re2js`) |
| `@tavnit-ts/tavnit/temporal-polyfill` | `installTemporalPolyfill()` | +52 KB (`@js-temporal/polyfill`) |
| `@tavnit-ts/tavnit/internal` | the lexer, parser and low-level evaluator, without a stability promise | — |

```typescript
import { createEngine } from "@tavnit-ts/tavnit/core";
import { strings } from "@tavnit-ts/tavnit/builtins/strings";
import { types } from "@tavnit-ts/tavnit/builtins/types";

const engine = createEngine({ builtins: [types, strings] });
```

`yaml` bundles the `yaml` package (+18 KB) and `regex` with `regex: "native"` `safe-regex2` (+4 KB), only when
imported. `builtinFilterNames` is a static list under 1 KB. See the
[TypeScript API reference](docs/skills/tavnit/references/typescript-api.md#lean-engines-and-built-in-selection)
for the options and [CHANGELOG.md](CHANGELOG.md) for changes.

## Documentation

- [The `tavnit` skill](docs/skills/tavnit/SKILL.md) — the language, built-in functions, value
  templates, engine API, security model and error catalog. `pnpm run build` also
  concatenates it into `docs/UserGuide.md`.
- [AGENTS.md](AGENTS.md) — contributor guide.
- [AI_DISCLOSURE.md](AI_DISCLOSURE.md) — how LLMs are used in this project and what checks back the output.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report a vulnerability, such as a way around the sandbox,
privately: [SECURITY.md](SECURITY.md).

## Licence

[ISC](LICENSE)
