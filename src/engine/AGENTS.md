# Tavnit Engine

## Design Notes

`EngineImpl` is orchestration only: it owns configuration, `EvalContext`
construction and public API/error adaptation; compiled forms live in `Cache`. Text
templates execute in `evaluator/text-template.ts`; value trees execute in
`evaluator/value-template.ts` after `parser/value-template.ts` compiles their
guards, spreads and holes. Do not add structural-template behaviour here.

- **`createEngine(options?)`** — factory that returns an `EngineImpl` (private class, typed as `Engine`).
  Calling it with no arguments produces a ready-to-use evaluator with default limits.
  Both `createEngine()` and `derive()` call `validateFilterNames()` immediately, which throws `ExpressionError`
  if any custom filter key is in the `RESTRICTED` prototype-name list (e.g. `constructor`, `__proto__`).
- **`Expression` (opaque handle)** — returned by `engine.parse()`; wraps `_node: ASTNode` and `_source: string`.
  Pass it to `engine.evaluate()` to skip re-parsing on repeated evaluations.
- **`Cache` (`cache.ts`)** — compiles and memoises expressions and text templates on their source
  string and value trees on their identity; a text template's expressions and a tree's strings and
  keys go through the same maps, so a fresh tree (`parse(value)`, a runtime-built `return` payload)
  reuses every compiled string. Compilation is engine-independent, so one cache is shareable:
  `createCache()` + `EngineOptions.cache`, and `derive()` inherits the parent's unless given one.
- **`derive(options?)`** — creates a child engine that inherits the parent's filter registry, limits, `strict`, `divisionByZero` and cache.
  `divisionByZero` is stored as the explicit option (or undefined), so a derived engine that flips `strict` gets the
  matching default.
  Child filters shadow parent filters of the same name. `secretRoots` replaces (does not merge) the parent's list when overridden.
  Reserved-name guard is applied to custom filters before the derived engine is created.
- **`secretRoots`** — list of top-level `DataContext` key names whose string values are redacted to `[redacted]`
  in runtime error messages. Applies only at the `toExpressionError` boundary in `evaluate()`; parse errors are not redacted.
- **`render()`** — parses the cached text template and delegates its execution to `evaluator/text-template.ts`.
- **Text-template executor** (`evaluator/text-template.ts`) walks the compiled `TextTemplateNode[]` from `parser/text-template.ts`; every expression, condition and iterable is already parsed, so a syntax error anywhere — even in an untaken branch — fails compilation:
  - `literal` → appends text, checks byte limit.
  - `expression` → evaluates its AST and stringifies; enriches error location via `enrichError()`.
  - `if` → evaluates branch conditions in order (`if`, then each `elif`) and recurses into the first truthy branch, else `alternate`. Only one branch is evaluated.
  - `for` → evaluates iterable (must be array); injects loop variable and `forloop` object (fields: `index`, `index1`, `first`, `last`, `length`) into a fresh child context; charges the call's `iterBudget` before each iteration.
- **Budgets are per engine call** — `evaluate`, `render` and `renderObject` each build one
  `CallBudget` (`iterBudget`, `steps`, the `timeoutCheck` sampler and `startTime`) and pass it to every span, loop
  iteration and value-tree leaf they evaluate through the private `#run`, so the budgets are shared, not reset per
  span. `${% for %}` iterations charge the same `iterBudget` as the collection built-ins. `compile()` builds a fresh
  budget per call of the lambda. The unit is documented in `security.md`.
- **Context validation** — not in the engine: `checkRead` in `evaluator/evaluate.ts` checks a value as an identifier, member or
  index node reads it (a type test for a plain value), so an expression pays only for what it reaches and nothing walks the
  context before the call. It throws `TAV_CONTEXT` with the access path, converts a `Date` to an instant, and passes a
  `FunctionValue`, a `Resolver`, a date wrapper and an `opaque()` value. A named class instance of the host passes in lenient
  mode and is not looked into (its fields are the host's own); strict mode refuses it, and the built-in containers are refused
  in both. Members of a container are checked when read in turn, so a list of `Date`s handed whole to a built-in is not converted.
  The three node cases call it, never `evaluate()` itself: a node-kind test in that wrapper, which runs at every node, made
  seven lambda-heavy corpus cases 13-20% slower.
- **Block tags are a template-layer feature** — `${% if/for %}` lives entirely in `parseTemplate` / `parseTextTemplate` + the text-template evaluator; the expression parser and evaluator are unchanged. `forloop` is injected as a plain `DataContext` sub-object, and block-tag conditions/iterables are ordinary Tavnit expressions under the same sandbox.
- **`maxOutputBytes`** — `EngineOptions` field (default `1_048_576` = 1 MB). Checked via `Buffer.byteLength(text, "utf8")` after each literal or expression output is appended. Throws `ExpressionError` on breach. Inherited by `derive()`, overridable.
- **Errors** — how they are raised, located and printed: [Error conventions](../../AGENTS.md#error-conventions).
- **`parse(value)` / `evaluate(value, context?)`** — compile and execute a structural `ValueTemplate`.
  `parser/value-template.ts` validates expression spans, text templates, object keys, `$if` / `$unless`,
  array/object spreads and `_` / `$_` holes once, and substitutes each compiled `_` body into its hosts.
  `evaluator/value-template.ts` walks that compiled tree — the engine drives it for the tree, the
  evaluator for a `_` body inside its host — and attaches the failing node's `path` to runtime errors.
  `parseValueTemplate` memoises the tree on its identity; `parse(value)`, `evaluate(value)` and
  `renderObject` do not, because their caller may mutate the tree, but still reuse cached strings.
- **`renderObject(value, context?, options?)`** — evaluates a value tree or a compiled `ValueTemplate`. A raw
  string is a text template here; `evaluate(rawString)` is an expression.
- **Synchronous methods** — `evaluateSync`, `renderSync` and `renderObjectSync` run `#runSync`, `#renderNodesSync`
  and `#valueTemplateSync`, which mirror the async ones over the sync evaluator, `evaluateTextTemplateSync` and
  `evaluateValueTemplateSync`. They never call `evaluateAsync` (`sync.test.ts` counts). A `Resolver` is
  refused when it is read without a `staticValues` answer, or returned whole (`TAV_ASYNC`), never for being named; a promise-returning filter is caught by the evaluator at call time.
  `asyncRequired` recodes both to `TAV_ASYNC_REQUIRED` at the public method, so the lower layers keep one code.
  A change to the async text or tree path needs the same change in its sync twin; the parity tables in `sync.test.ts` catch a drift.
- **`TextTemplate`** — the opaque handle `parseTextTemplate` returns; it wraps the cached nodes and a `WeakMap`
  keeps one handle per compiled template, so the cache identity (`toBe`) holds.
- **`analyze()` / `check()`** (`analyze.ts`) — one scoped walk (`Collector`) over an expression, a text template or a
  value tree; arrow parameters, `let` names and `for` variables (and `forloop`) are bound, a `_` body is walked in
  its host's scope. `check` compares the references with the engine's filter names and the host's lists and reuses the
  strict-mode codes and "did you mean" text. The registry has no arity, so arity is not checked.
- **`compile()`** — requires an arrow expression at the top level; returns a `FilterFn` that evaluates the arrow body using the compiling engine's filter registry.
- **`ExpressionError`** — public error class; `message` always equals `errors[0].message`. The `?? "Expression error"`
  fallback on `errors[0]?.message` in `ExpressionError` is structurally unreachable because every call site passes a
  non-empty `errors` array.
- **Default limits**: `maxDepth = 50`, `maxIterations = 1_000_000`, `maxSteps = 10_000_000`, `maxOutputBytes = 1_048_576`;
  `timeoutMs` is off (`Infinity` internally), so the evaluator never reads the clock unless the host sets it.
- **Modes** — `strict` and `divisionByZero` resolve to the `Semantics` object of `EvalContext` (`strict`,
  `infiniteDivision`). Strict (the default) defaults `divisionByZero` to `"error"`; lenient (`strict: false`) to `"infinity"`.
- **`Resolver` routing** — `EngineImpl.evaluate()` calls `evaluateAsync(node, ctx)` instead of the sync
  `evaluate(node, ctx)` only when the expression can meet something to await (`#needsAsync`): one of
  the names it reads or calls (`Cache.names`, memoised per node) is a top-level `Resolver` of the
  context, or an unmarked custom filter — any not the built-in of its name — while the context holds a `Resolver`.
  A host marks a filter with `synchronousFilter` only when a synchronous attempt has no effects;
  a promise from that attempt sends the expression through the async evaluator without caching
  the async verdict for later calls. A Resolver read does cache the async verdict even when
  the same expression names a marked filter.
  The async path allocates a promise per node and runs about three times slower, and a host that
  always supplies `Resolver` roots would otherwise send every expression down it. `render()` benefits automatically since it calls `this.evaluate()`. `compile()` is
  unaffected: a compiled lambda evaluates synchronously and has no DataContext.

## Testing

`engine.test.ts` covers the `Engine` API, including value templates (`$if` / `$unless`,
spreads, `_` / `$_` holes) and the cache. The other test files here are listed in [Tests and coverage](../../AGENTS.md#tests-and-coverage). Run:

```bash
pnpm run test
pnpm run test:coverage -- src/engine
```
