# @tavnit-ts/tavnit

Constrained expression evaluator with text-embedding and value templates.

## Purpose

Tavnit tokenizes and evaluates expressions embedded in template strings using
`${{ expr }}` interpolation syntax. It is intentionally constrained: no `eval`,
no arbitrary JS, only a well-defined expression grammar.

The user-facing reference for the language, its built-ins and the TypeScript API is the
[`tavnit` skill](docs/skills/tavnit/SKILL.md); contributor design notes live in this file and the
per-directory `src/**/AGENTS.md` files. Do not restate the skill here.

## Authorship

The whole repository is written by LLM agents, and [AI_DISCLOSURE.md](AI_DISCLOSURE.md) says so.
Keep that statement true and tool-neutral: name no model or agent in it, and update it when how the
project uses LLMs changes.

## Public and internal entry points

`src/index.ts` is the public API and follows semver. Anything a tool built on Tavnit needs but an
application does not — the evaluator, lexer, parser, AST, `contextFilter`, lint and fix — is exported
from `src/internal.ts` (`@tavnit-ts/tavnit/internal`), which is unstable. What an application needs only
to embed the engine — `Resolver`, `resolve`, `contextFilter`, `EvaluationOptions` — is exported from
`src/host.ts` (`@tavnit-ts/tavnit/host`), which follows semver like `index.ts`. A new export goes in
`internal.ts` unless an application needs it; adding one to `index.ts` or `host.ts` means updating the
list in `src/index.test.ts`, the snapshot and `typescript-api.md` in the same commit.

## Keeping the skill in step

Every change a Tavnit user can observe — syntax, semantics, a built-in, the public API, an error
message, a limit — updates the skill in the same commit. The `SKILL.md` tables say which reference
owns a topic; error messages belong in the `errors.md` catalog. Then run
`pnpm run build`: it fails on what it can check — an undocumented built-in,
export or error message, a broken link, a malformed example (the full list is in
[STRUCTURE.md](docs/skills/tavnit/STRUCTURE.md)).

Where a change goes:

| Change | Code and tests | Skill |
|---|---|---|
| Built-in | [Adding a New Builtin](src/builtins/AGENTS.md#adding-a-new-builtin) | `builtins.md` row + its `builtins-*.md` / `datetime.md` |
| Syntax or operator | `lexer/` → `parser/` → `evaluator/`, with their tests | `language.md`, `embedding.md` or `block-tags.md` |
| Value-template directive | `parser/value-template.ts`, `evaluator/value-template.ts`, `engine.test.ts` | `value-templates.md` |
| Export, `Engine` method, `EngineOptions` field | `src/index.ts`, `engine/` | `typescript-api.md` |
| Error message | the throw site, per [Error conventions](#error-conventions) | `errors.md` under its phase |
| Limit or sandbox rule | `engine/`, `evaluator/restricted.ts` | `security.md` |

A reference example that claims a behaviour is asserted in `src/engine/skill-docs.test.ts`.

## Error conventions

- Every `Engine` method throws `ExpressionError`. Below the engine: the lexer throws `LexError`
  (`parse()` rethrows it as `ParseError`), the template scanner `TemplateError` with the template
  `offset`, the evaluator `EvaluationError`.
- A runtime error needs no position: `atNode` in `evaluator/evaluate.ts` gives it the span of the
  node that raised it, a pipe step `calleeStart`–`end`. Pass a position only to point at a part of
  the node, as property access does.
- AST positions are relative to the expression — a compiled expression is cached by its source and
  shared between templates. `enrichError` maps them into the template once, via `positionInSource`.
- Every diagnostic has a stable `code` (`ERROR_CODES` in `evaluator/errors.ts`, listed in `errors.md`). A throw
  site picks one: `codedError("TAV_TYPE", …)`, `limitError(limit, value)` for a limit (it names the value and the
  option that raises it), or the default `TAV_RUNTIME` of a plain `EvaluationError`. A new code goes in
  `ERROR_CODES` and in `errors.md` in the same commit; the build and `skill-docs.test.ts` fail on a code the
  catalog lacks. Test that the code and the structured fields (`limit`, `value`, `option`, `access`) are set.
- Message text: no `[tavnit]` prefix and no position (the location carries it); a value's type
  through `typeName()` from `evaluator/types.ts`, never `typeof`; a built-in named as `fn()`.
- `ExpressionError.format()` / `formatDiagnostic` (`engine/format.ts`) print a diagnostic.

## Directory Layout

```
scripts/build-docs.mjs   — checks the skill and generates docs/UserGuide.md (see STRUCTURE.md)
scripts/gen-builtin-names.mjs — writes src/builtins/names.ts from the categories in dist/
scripts/check-size.mjs   — the size gate (see Size); scripts/size-ceilings.json holds the ceilings
scripts/check-package.mjs — the package check (see Package check): publint and attw over the packed tarball
docs/skills/tavnit/      — the user-facing skill: SKILL.md, STRUCTURE.md, references/
docs/                    — generated UserGuide.md and design notes (docs/AGENTS.md)
bench/                   — the benchmark corpus and its runners; outside src/, so never built or published (see Benchmarks)
src/
  index.ts               — the public API (semver); index.test.ts pins its list of exports
  host.ts                — `@tavnit-ts/tavnit/host`: Resolver, resolve, contextFilter, synchronousFilter, EvaluationOptions (semver; pinned by index.test.ts)
  internal.ts            — `@tavnit-ts/tavnit/internal`: evaluator, lexer, parser, AST, lint, fix. Unstable, outside semver
  core.ts, core-engine.ts — `@tavnit-ts/tavnit/core`: the public API with a `createEngine` that registers nothing by default
  defaults.ts            — what the root `createEngine` starts from: every category, the linear regex engine, the polyfill; the root `deserialiseValue`
  categories/            — one module per built-in category (`@tavnit-ts/tavnit/builtins/<name>`); index.ts holds `defaultBuiltins` and `commonBuiltins`
  regex-linear.ts        — `@tavnit-ts/tavnit/regex-linear`: `linearRegex`, the only module that imports re2js
  temporal.ts            — the registration point of `Temporal`: `temporal()`, `registerTemporal()`; imports no implementation
  temporal-polyfill.ts   — `@tavnit-ts/tavnit/temporal-polyfill`: the only module that imports `@js-temporal/polyfill` at run time
  serialisation.ts       — persistence codec for the date/time wrappers (tagged-map wire format)
  builtins/              — the built-in registry, one module per category (builtins/AGENTS.md)
  engine/
    types.ts             — ExpressionError, Diagnostic, SourceLocation, Expression, Engine, EngineOptions
    cache.ts             — Cache: compiles and memoises expressions, text templates, value trees
    engine.ts            — createEngine() → Engine; error adaptation (toExpressionError, enrichError); the per-call budgets
    analyze.ts           — the free variables and calls of a compiled source: behind engine.analyze() and engine.check()
    format.ts            — formatDiagnostic: a diagnostic as text with a source excerpt and caret
  lexer/
    token.ts             — TokenKind enum, Token, SourcePosition
    tokenize.ts          — tokenize(source) → Token[]; LexError
    spans.ts             — extractSpans / parseTemplate: spans and block tags; TemplateError
  parser/
    ast.ts               — ASTNode union and node interfaces
    parse.ts             — parse(source) → ASTNode; ParseError
    walk.ts              — forEachNode / someNode AST visitors; referencedNames
    text-template.ts     — parseTextTemplate → TextTemplateNode[]; positionInTemplate / positionInSource
    value-template.ts    — parseValueTemplate → ValueTemplate; substitutes each `_` body into its hosts
  typecheck/             — the static type checker (`checkExpression`, `checkTemplate`) behind `@tavnit-ts/tavnit/internal`; see typecheck/AGENTS.md
  evaluator/
    types.ts             — Value, contexts, FilterFn, EvaluationError, Resolver, date wrappers, typeName
    errors.ts            — ERROR_CODES, codedError, limitError, chargeIterations, nearest (the "did you mean" name)
    evaluate.ts          — evaluate / evaluateAsync; atNode error attribution
    restricted.ts        — prototype names rejected by the grammar, the filter registry and path()
    text-template.ts     — executes a compiled text template
    value-template.ts    — walks a compiled value tree (also a `_` body inside its host expression)
    stringify.ts         — valueToString: the text-embedding conversion of a Value
```

## Internals

Not in the skill, because they are not public:

| Name | Where | Note |
|---|---|---|
| `parseTemplate(template)` | `lexer/spans.ts` | Template string → `TemplateNode[]`, including `if` / `for` block tags; `parseTextTemplate` compiles its result |
| `contextFilter`, `isContextFilter`, `ContextFilterFn` | `evaluator/types.ts` | Lets a built-in receive the `EvalContext`. The mark is a `WeakSet` entry, never a property: a property changes the function's hidden class and made `evaluateCall` megamorphic (+14% on every call) |
| `compileTextTemplate` / `compileValueTemplate` | `parser/` | The compilers with an injected expression parser — the engine passes its cache |
| `createEngineWith(defaults, options)` | `engine/engine.ts` | The one constructor: the root `createEngine` passes `defaults.ts`, `core` passes an empty set. Keep `engine.ts` free of any import that reaches `re2js`, `yaml` or the polyfill other than through `defaults.ts` |
| `BuiltinCategory`, `categories/*` | `builtins/category.ts` | A named record of filters; `options.builtins` replaces the default list, `derive({ builtins })` adds |
| `names.ts` | `builtins/names.ts` | Generated list behind `builtinFilterNames`; `names.test.ts` compares it with the categories. Regenerate with `pnpm run gen:names` after adding a built-in |

## Tests and coverage

Vitest only; files sit next to the code they test. Beyond the per-module `*.test.ts`:
`engine/integration.test.ts` runs end-to-end examples, `engine/skill-docs.test.ts` the skill's
claims, `engine/format.test.ts` error locations and printing; `engine/routing.test.ts` which expressions take the async path; `builtins/higher-order.test.ts` covers the
arrow-function built-ins, `builtins/datetime.test.ts` date and time.

In tests, `${{ }}` in a string needs no Biome suppression — `biome.json` turns
`noTemplateCurlyInString` off for `*.test.ts` (SonarQube is a separate linter). Test built-ins with
`engine.evaluate()`; `render()` belongs in `engine/` tests.

```bash
pnpm run test:coverage               # whole package
pnpm run test:coverage -- src/lexer  # one directory
```

Keep coverage green in every directory. Each `src/*/AGENTS.md` — builtins, engine, evaluator, lexer,
parser — records its design notes and the branches it leaves uncovered or suppresses, and why.

**V8 ignore comments** mark code a test cannot reach; say why next to each:

- `/* v8 ignore next -- @preserve */` — suppresses the next statement or branch.
- The `-- @preserve` suffix is required: Vite uses esbuild which strips comments by default;
  `-- @preserve` marks the comment as a "legal comment" that esbuild keeps in the output.
- `/* v8 ignore else -- @preserve */` does **not** work for `??` operators — esbuild lowers
  `??` to a conditional, and the `else` hint is not matched against the generated branch.
  Use `/* v8 ignore next -- @preserve */` on the `??` line instead.

## Benchmarks

Performance is held by two things, both in this package. The plan and its rationale are in
[docs/performance.md](docs/performance.md).

- **Counters** in `src/performance.test.ts` assert the work Tavnit does — clock reads, compilations,
  `Intl` constructions, scope copies — never the time. They run with `pnpm test` and cannot flake.
  A change that adds an optimisation adds its counter there.
- **The corpus** in `bench/corpus.mjs` is the fixed set of 67 cases, grouped by parse, evaluate, datetime, context,
  templates, routing, engine, errors and limits. It is generic: no case depends on a particular application.
  Every engine in it raises `timeoutMs`, which is a no-op now that the default is off (the deterministic
  `maxSteps` and `maxIterations` bound a run); a case that needs more than the defaults raises those too.

```bash
pnpm run bench          # the corpus on the built dist, a table
pnpm run bench:noise    # 30 fresh processes, the spread of every case
node bench/ab.mjs <distA> <distB>                 # alternate two builds, the delta per case
TAVNIT_BENCH_SKIP="regex /" node bench/ab.mjs …    # leave out cases the base build lacks the feature for (a name containing the text)
```

```bash
node --expose-gc bench/memory.mjs --enforce       # heap retained after a forced GC, against a bound per case
```

Pull requests that touch `src/`, `bench/` or `package.json` get a base-against-head comparison
(`.github/workflows/bench.yml`): nine alternating rounds, the median
delta per case, a warning above 10% and a failure above 25%. The job fails only while the repository
variable `TAVNIT_BENCH_ENFORCE` is `true`. A nightly job on `main`
(`bench-nightly.yml`) runs the memory report and fails a case over its bound.

To find where a slow case spends its time, profile that case alone and read the Tavnit frames:

```bash
node --cpu-prof --cpu-prof-dir=/tmp/prof bench/run.mjs --filter "50-card screen" --time 2000
```

Open the `.cpuprofile` in Chrome DevTools (Performance, Load profile) or speedscope; sort by self
time. A host application profiles its own screens with its own tools — the profile of a real workload
is how a regression is found, and its cause then becomes a case in `bench/corpus.mjs` and, where it is
an optimisation, a counter in `src/performance.test.ts`.

Compare only two builds measured on one machine in one job. Never compare an absolute number from
another machine, another Node version or another `Temporal` source (`bench/run.mjs --once` prints the
last in its header). A new case goes in `bench/corpus.mjs` with a group and a name that says what it measures.

## Size

Bundle size is held by a gate, `scripts/check-size.mjs` (`pnpm run size`). It bundles
five entries of `dist/` with Vite (found through vitest; no extra install): the lean core, the core with the
common categories, the same with `datetime` on a runtime with `Temporal`, the root `createEngine` and
`builtinFilterNames`. It fails when a gzip size exceeds its ceiling in `scripts/size-ceilings.json` by more than
5%, when a lean bundle holds `re2js`, `yaml`, `safe-regex2` or `@js-temporal/polyfill`, or when the full bundle
lost one of them. `.github/workflows/ci.yml` runs it on Node 24.

```bash
pnpm run size                  # check
node scripts/check-size.mjs --update                     # after tsc: record new ceilings, with the bundler and its version
```

Raise a ceiling (with `--update`) only for code the entry needs; say in the commit what grew. The rules that
keep the lean bundles lean:

- A category module imports what its built-ins need and nothing else; `strings.ts` and `regex.ts` are split so
  `safe-regex2` stays out of `strings`.
- `engine.ts` reaches the default set only through `defaults.ts`, inside `createEngine`. `sideEffects: false`
  lets a bundler drop `defaults.ts` for a build that imports `createEngine` from `core`.
- `temporal.ts` imports no implementation; code that needs `Temporal` calls `temporal()` at call time, never at
  module load.
- A built-in that needs a regex engine reads `ctx.regex`; it never imports `linear-regex.ts`.

A Metro (React Native) bundle is not part of the gate: Metro is not installed.

## Package check

`exports` maps 14 entry points by hand to files in `dist/`, so a wrong path or a misplaced condition passes
lint, build and test and fails only for a user, after an irreversible publish. `scripts/check-package.mjs`
(`pnpm run check:package`, which runs `tsc` first) packs the package as `npm publish` would and lints the
tarball, not the working tree:

- **publint** (`--strict`, so a warning fails) checks `package.json` against the packed files: every path in
  `main`, `types` and `exports` exists, the condition order is valid, `files` leaves nothing out.
- **attw** (`@arethetypeswrong/cli`, profile `esm-only`) resolves the types of every entry point as
  `node16` from ESM and as `bundler`. The profile ignores the CommonJS and `node10` columns because the package
  ships ESM only; a `require` of an entry point is not a supported use.

`pnpm run check` ends with it, `.github/workflows/ci.yml` runs it on Node 24 and `publish.yml` runs it before
`npm publish`. A new entry point goes in `exports` with a `types` condition first, and this check must stay
green. Both tools are pinned to an exact version in `devDependencies`: a new rule in either would otherwise
fail a release that did not change.

## Playground

`playground/index.html` is a static page: an expression or a text template, a JSON context and a `strict`
switch go in, the result or `ExpressionError.format()` comes out. `playground/build.mjs` bundles it with Vite
(found through vitest, as in the size gate) against `dist/` into `playground/dist/`, which git ignores. The
`files` list of `package.json` leaves `playground/` out, so it is never published.

```bash
pnpm run playground   # tsc, then the bundle; serve playground/dist with any static server
```

## Open items

Engine gaps and deferred decisions. 

| Item | Note |
|---|---|
| `\|?` null-propagating pipe | Not implemented. Add only if `(expr)?.` usage shows the language surface is warranted. |
| `cond(...)` multi-branch helper | Not implemented; object-literal lookup is the documented workaround. |
| Object `merge()` builtin | Deferred pending shallow/deep and conflict-resolution semantics. |
| `now` / `today` getter form | Only the `now()` / `today()` calls exist. The dual form was proposed and never adopted — record as rejected or schedule it. |
| Typed filter API | Deferred; any future typed `FilterFn` must stay source-compatible with the untyped signature. |
| Async filter semantics | Partly specified: the sync methods raise `TAV_ASYNC_REQUIRED` on a promise-returning filter (found only when it runs, so the filter has started), and `timeoutMs` is opt-in. Still open: rejected-Promise handling and concurrency across the spans of one template. |
| `@js-temporal/polyfill` removal | Still a dependency, now bundled only by the root entry point and `@tavnit-ts/tavnit/temporal-polyfill`; remove once the supported Node baseline ships native Temporal. |
| Metro bundle in the size gate | Needs Metro installed; the gate bundles with Vite only. |
| Collection null-input table | `errors.md` states the rule (only `size(null)` returns `0`); a per-function table is missing. |
| Top-level function value | `language.md` calls a lambda as an expression result a type error; `evaluate("x => x")` returns it, only a rendered span rejects it. Align the doc or the engine. |
| BigInt | Numbers are IEEE doubles; an integer above 2^53 loses precision silently. Documented in `language.md`, not handled. |
| Membership and objects | `"a" in o` on an object raises; there is no `has(o, k)`, `entries`, `fromEntries` or `mapValues`, and no object or array spread or computed key in an expression. Decide the meaning of `k in obj` and the expression spread (it must agree with the value templates), then add the built-ins through [Adding a New Builtin](src/builtins/AGENTS.md#adding-a-new-builtin). |
| One rule for `null` | `size(null)` is `0`, but `trim(null)`, `toUpperCase(null)`, `map(null)` and `join(null)` raise. Pick one rule with the per-function table above and decide `\|?` with it; say in `embedding.md` that a span with `null` renders `""`. |
| Public parser entry point | `@peula-ts/events-postgres` compiles a predicate to SQL from `parse` and `ASTNode` of `@tavnit-ts/tavnit/internal`, which carries no compatibility promise. Export `parse` and the node types from a public entry point, then `events-postgres` drops `/internal` (its open items name the step). |
| Comparison pages | `docs/skills/tavnit/references/other-engines.md` compares Liquid only; add CEL, JEXL and JSONata, and verify every row by running the expression. |
| Benchmark gate | The pull-request benchmark comments only. Set the repository variable `TAVNIT_BENCH_ENFORCE` to `true` after two weeks of reports from real pull requests; the nightly memory job needs seven days without a false failure. |
| Fresh install check | A check that a new project installs the published package and imports every entry point. The package check lints the tarball but never runs it. |
| Doc-style nits | `reduce()` accumulator note, precedence callout formatting, signature optionality. |
