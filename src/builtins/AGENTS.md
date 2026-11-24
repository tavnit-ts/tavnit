# src/builtins/

Built-in filter registry for Tavnit — registered automatically into every `createEngine()` call.

## Directory Layout

```
category.ts       — BuiltinCategory and EngineDefaults; the categories themselves are in ../categories/
names.ts          — GENERATED static list behind builtinFilterNames (scripts/gen-builtin-names.mjs); names.test.ts guards it
args.ts           — ensureString / ensureStringArg, shared by strings.ts and regex.ts
regex.ts          — matches/capture/captures: the native engine, safe-regex2 and the dispatch to the engine in ctx.regex
yaml.ts           — yaml (the yaml package), alone so that only the yaml category bundles it
builtins.test.ts  — tests of the scalar, string, object and collection built-ins
higher-order.test.ts — arrow functions, let…in and the higher-order built-ins
datetime.test.ts  — date and time built-ins
collections.ts    — context-aware collection builtins (size, map, filter, find, sort with a cached Intl.Collator, sum, min, max, range, …)
crypto.ts         — sha256, hmacSha256, uuid, randomString (uses node:crypto)
datetime.ts       — date/time builtins (use temporal() from ../temporal.ts; no implementation is imported)
encoding.ts       — btoa, atob, base64urlEncode, base64urlEncodeHex, encodeURIComponent, decodeURIComponent
math.ts           — number helpers: toFixed, round, floor, ceil, abs
null-safety.ts    — default, coalesce
objects.ts        — pick, omit, keys, values, path (runtime reserved-name check in path())
parse.ts          — parseBool, parseInteger, parseFloat
serialise.ts      — json (JSON.stringify)
strings.ts        — string manipulation
linear-regex.ts   — the default engine: re2js behind `translate` (JavaScript meaning of `.`, `\s`, `\u`, `[`) and a 256-entry LRU of compiled patterns; imported only by ../regex-linear.ts
type.ts           — str, num, bool, type, deepEquals
```

## How Builtins Are Wired

`createEngineWith` (`engine/engine.ts`) merges the filters of the selected categories with any caller-supplied
`options.filters` at engine creation time. The categories are `options.builtins`, else the defaults of the entry
point (`defaults.ts` for the root, none for `core`):

```typescript
const filters: Record<string, FilterFn | ContextFilterFn> = { ...categoryFilters(options?.builtins ?? defaults.builtins), ...options?.filters };
```

A category is a `BuiltinCategory` (`{ name, filters }`) in `src/categories/<name>.ts`, published as
`@tavnit-ts/tavnit/builtins/<name>`: `types` (type, parse, null-safety, math), `strings`, `regex`, `collections`,
`objects` (objects, json), `yaml`, `encoding`, `crypto`, `datetime`.

Caller-supplied filters shadow builtins with the same name — intentional, tested in `builtins.test.ts`.

## Filter Signature Convention

**Regular filters** (`FilterFn`): `(v: Value, ...args: Value[]) => Value`. Used for type, math, string, null-safety, and parse builtins.

**Context-aware filters** (`ContextFilterFn`): `(ctx: EvalContext, v: Value, ...args: Value[]) => Value`. Used for collection builtins that need access to `iterBudget`. Made by `contextFilter()`, which records the function in a `WeakSet` (never as a property: that changes the function's hidden class and slowed every filter call by 14%) — the evaluator tests it with `isContextFilter()` and passes `EvalContext` as the first argument. This is an internal detail; users always register regular `FilterFn` values.

Throw `EvaluationError` (from `../evaluator/types.js`) for type mismatches or invalid arguments — never return `null` as a silent fallback. The message starts with the built-in's `fn()` name and follows [Error conventions](../../AGENTS.md#error-conventions); a message that cannot name one needs a row in the skill's `errors.md`, which the build checks.

## Built-in Filters by Module

The filter catalogue — signatures, return values, edge cases — is owned by the
`tavnit` skill; do not restate it here.

| Module | Reference |
|---|---|
| `collections.ts` | [`builtins-collections.md`](../../docs/skills/tavnit/references/builtins-collections.md) |
| `type.ts`, `parse.ts`, `null-safety.ts`, `math.ts` | [`builtins-types.md`](../../docs/skills/tavnit/references/builtins-types.md) |
| `strings.ts` | [`builtins-strings.md`](../../docs/skills/tavnit/references/builtins-strings.md) |
| `objects.ts`, `serialise.ts`, `encoding.ts`, `crypto.ts` | [`builtins-objects.md`](../../docs/skills/tavnit/references/builtins-objects.md) |
| `datetime.ts` | [`datetime.md`](../../docs/skills/tavnit/references/datetime.md) |

Contributor-relevant behaviour the skill does not carry:

- **Iteration budget** — every collection operation decrements `ctx.iterBudget.remaining` by the element count and throws `EvaluationError("Maximum iteration count exceeded")` at zero. The budget is shared across all collection operations in one expression evaluation and is never reset between pipe steps. Higher-order builtins invoke their `FunctionValue` through `ctx.invokeFn`, which `evaluateCall` injects before dispatching to a `ContextFilterFn`.
- **Regex engine** — `EngineOptions.regex` (`ctx.regex`) picks it per evaluation: `native`, or an engine object (`LinearRegexEngine`). `createEngineWith` resolves the string `"linear"` to the engine of the entry point (re2js for the root, none for `core`, where `regex.ts` raises `TAV_USAGE`) and an absent option to that engine or to `native`. The linear engine is re2js: no backtracking, no subject cap; `translate` keeps `.`, `\s`, `\uXXXX`, `\cX`, `[` and `[]` as in JavaScript, and `linear-regex.test.ts` holds the differential test against `RegExp`. `native` is `RegExp` behind `safe-regex2`, `isBacktrackingRisk` and the 100 000-character subject cap (the cap and the guards live in `regex.ts`). Invalid patterns throw `EvaluationError("Invalid regular expression: …")`; native mode reports unsafe ones as `Potentially unsafe regular expression: …`.
- **`formatCalendar` formatters are cached** — by locale, time zone and label part (at most 256, then the cache starts over). Constructing an `Intl.DateTimeFormat` costs hundreds of microseconds and `ZonedDateTime.toLocaleString` constructs one per call, so the built-in formats `epochMilliseconds` with a cached formatter instead.
- **`Temporal` at call time** — date code calls `temporal()` (`../temporal.ts`) inside the function, never at module load, so a runtime without `Temporal` fails with `TAV_USAGE` on the first date value and not on import. `deserialiseValue` calls it before its `try`, because the `catch` returns the undecoded map.
- **`path()` reserved names** — each runtime dot-path segment is validated against the same `RESTRICTED` set as static access and a forbidden segment throws `EvaluationError`. Grammar-level checks only cover static `.prop` access, so this is the runtime defence for dynamic dot paths.

## Adding a New Builtin

1. Add the implementation to the appropriate module file (or create a new one).
2. For regular builtins: export a `FilterRegistry` object named `<module>Builtins`.
   For context-aware builtins: export a `Record<string, ContextFilterFn>` and use `ctxFilter()` helper.
3. Spread it into the `BuiltinCategory` of its category in `../categories/<name>.ts` (a new category also goes in
   `../categories/index.ts`, `package.json` `exports` and `packaging.test.ts`), then run `pnpm run gen:names`
   to regenerate `names.ts`.
4. Add tests in `builtins.test.ts` — use `eng.evaluate()`, never `eng.render()` (the `${{ }}` delimiter is a rendering concern).
5. Add its row to the skill's `builtins.md` quick reference and document it in the category reference; `pnpm run build` checks the row.

## Coverage

```bash
pnpm run test:coverage -- src/builtins
```

**Suppressed: the Temporal polyfill catch bodies in `datetime.ts`**

These catch bodies wrap Temporal API calls where the `@js-temporal/polyfill` never throws for valid
inputs. They are kept (not removed) as defensive boundaries in case behaviour changes when native
Temporal replaces the polyfill. Each throw is suppressed with `/* v8 ignore next -- @preserve */`;
the multi-line `toMillis()` throw uses `/* v8 ignore start/stop -- @preserve */`.

- `toDuration()` catch — `Temporal.Duration.from(init)` with all-numeric fields never throws.
- `instantAdd()` catch — `Instant.toZonedDateTimeISO("UTC")[op](dur).toInstant()` never throws for
  a valid `Instant` and `Duration`.
- `add()` catch bodies for `PlainDate` and `PlainDateTime` — `Temporal.PlainDate/PlainDateTime.add()`
  does not throw for any valid `Duration` with the polyfill.
- `subtract()` catch bodies — same reasoning.
- `toMillis()` catch — `Duration.total({ unit: "milliseconds", relativeTo: … })` never throws with the
  provided fixed `relativeTo` `PlainDateTime`.

**Suppressed: the ULID overflow in `crypto.ts`** — `ulidIncrement()` restarts from fresh random digits
only after 2^80 ULIDs in one millisecond.

V8 ignore conventions: [Tests and coverage](../../AGENTS.md#tests-and-coverage).
