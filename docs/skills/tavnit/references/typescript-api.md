## TypeScript API

<!-- contents -->
**Contents**

- [Entry points and runtimes](#entry-points-and-runtimes)
- [Lean engines and built-in selection](#lean-engines-and-built-in-selection)
- [Engine Instantiation and Isolation](#engine-instantiation-and-isolation)
- [Filter Registration](#filter-registration)
- [Filter Signature](#filter-signature)
- [Host integration](#host-integration)
- [Opaque host values](#opaque-host-values)
- [Context-aware host filters](#context-aware-host-filters)
- [Reserved Names](#reserved-names)
- [Shared Cache](#shared-cache)
- [Engine Derivation](#engine-derivation)
- [Lambda Compilation](#lambda-compilation)
- [Core Evaluation API](#core-evaluation-api)
- [Synchronous methods](#synchronous-methods)
- [Parse API](#parse-api)
- [Static analysis — `analyze` and `check`](#static-analysis--analyze-and-check)
- [Public and internal entry points](#public-and-internal-entry-points)
- [Exported Types](#exported-types)
- [Lazy Async Context — `Resolver` and `resolve()`](#lazy-async-context--resolver-and-resolve)
- [Error Types](#error-types)
- [Linting value templates](#linting-value-templates)
- [Static type checking](#static-type-checking)
<!-- /contents -->

### Entry points and runtimes

The package is ESM only and declares an `exports` map:

| Import | Holds |
|---|---|
| `@tavnit-ts/tavnit` | the supported API: engine with every built-in, cache, errors, value types, templates, lint and fix |
| `@tavnit-ts/tavnit/host` | the host-integration API: `Resolver`, `resolve`, `contextFilter`, `opaque`, `EvaluationOptions`; supported like the root |
| `@tavnit-ts/tavnit/core` | the same API with a lean `createEngine` that registers no built-in; see [Lean engines](#lean-engines-and-built-in-selection) |
| `@tavnit-ts/tavnit/builtins` | `defaultBuiltins` (every category), `commonBuiltins` and the categories as named exports |
| `@tavnit-ts/tavnit/builtins/<name>` | one category: `types`, `strings`, `regex`, `collections`, `objects`, `yaml`, `encoding`, `crypto` or `datetime` |
| `@tavnit-ts/tavnit/regex-linear` | `linearRegex`, the linear-time regex engine (bundles `re2js`) |
| `@tavnit-ts/tavnit/temporal-polyfill` | `installTemporalPolyfill()` and `Temporal` (bundles `@js-temporal/polyfill`) |
| `@tavnit-ts/tavnit/internal` | the lexer, parser, AST and low-level evaluator; no stability promise |

Choose the entry point by where the code runs:

| Host | Entry point | Gzip size (Vite, minified) |
|---|---|---|
| A Node server or a CLI that wants everything and no set-up | `@tavnit-ts/tavnit` | about 150 KB |
| A browser, an edge runtime or a phone that needs strings, collections and types | `@tavnit-ts/tavnit/core` with `commonBuiltins` | about 26 KB |
| The same, with dates on a runtime that has a native `Temporal` | add `builtins/datetime` | about 29 KB |
| The same, on a runtime without `Temporal` | add `builtins/datetime` and call `installTemporalPolyfill()` | about 29 KB plus about 52 KB for the polyfill |
| Regular expressions with the linear-time guarantee | add `builtins/regex` and `regex-linear`, or use the root entry | about 50 KB for `re2js` |
| A tool that only needs the names of the built-ins | `builtinFilterNames` from the root | under 1 KB |

The sizes are the ceilings the package's size gate records (`pnpm run size` in the package); the
exact figures live there, not here.

The package is marked `sideEffects: false` and needs Node 24 or later. Its modules import nothing
from `node:`, so a bundler can build it for a browser or an edge runtime. Random built-ins
(`uuid()`, `ulid()`, `randomString()`) and `timingSafeEqualHex()` use Web Crypto. `sha256()` and
`hmacSha256()` look `node:crypto` up when called; where the runtime has none they fail with
`sha256() needs node:crypto, which this runtime does not provide`.

### Lean engines and built-in selection

`createEngine` from the root entry point registers every built-in, runs `regex: "linear"` on the
bundled `re2js` and installs the Temporal polyfill when the runtime has no `Temporal`. Its bundle is
about 150 KB gzip. A host that ships to a browser or a phone selects what it needs instead:

```typescript
import { createEngine } from "@tavnit-ts/tavnit/core";
import { collections } from "@tavnit-ts/tavnit/builtins/collections";
import { strings } from "@tavnit-ts/tavnit/builtins/strings";
import { types } from "@tavnit-ts/tavnit/builtins/types";

const engine = createEngine({ builtins: [types, strings, collections] });
```

`@tavnit-ts/tavnit/core` exports the root API except `Temporal`, and its `createEngine` differs in the
defaults only: no built-in, no regex engine, no polyfill. The root `createEngine` accepts `builtins` too;
there a list replaces the full set. `derive({ builtins })` adds categories to the engine it derives from.
A custom filter of the same name shadows a category's, as it shadows a built-in.

| Category | Built-ins | Costs in a bundle |
|---|---|---|
| `types` | `type`, `str`, `num`, `bool`, `parse*`, `default`, `coalesce`, `round`, `toFixed` and the other number helpers | nothing beyond Tavnit |
| `strings` | the string built-ins except the regex ones | nothing beyond Tavnit |
| `regex` | `matches`, `capture`, `captures` | `safe-regex2` (about 4 KB gzip) for `regex: "native"` |
| `collections` | `map`, `filter`, `sort`, `groupBy`, `size`, `join`, … | nothing beyond Tavnit |
| `objects` | `pick`, `omit`, `keys`, `values`, `path`, `json` | nothing beyond Tavnit |
| `yaml` | `yaml` | the `yaml` package (about 18 KB gzip) |
| `encoding` | `btoa`, `atob`, `base64urlEncode`, `base64urlEncodeHex`, `encodeURIComponent`, `decodeURIComponent` | nothing beyond Tavnit |
| `crypto` | `sha256`, `hmacSha256`, `uuid`, `ulid`, `randomString`, … | nothing beyond Tavnit |
| `datetime` | `now`, `today`, `add`, `format`, … | nothing, provided the runtime has `Temporal` |

`commonBuiltins` is `types`, `strings`, `collections`, `objects` and `encoding`; with `core` it bundles to
about 26 KB gzip.

**Regex engine.** `matches`, `capture` and `captures` take `regex` from the engine options. A lean engine
defaults to `"native"`. To run the linear engine, pass the object:

```typescript
import { linearRegex } from "@tavnit-ts/tavnit/regex-linear";
createEngine({ builtins: [regex], regex: linearRegex });
```

`regex: "linear"` on a lean engine that was given no engine object raises `TAV_USAGE` when one of the three
runs. On the root `createEngine` it means the bundled engine.

**Temporal.** The date/time built-ins, date comparison and `deserialiseValue` use the runtime's own
`Temporal`; a runtime without one needs the polyfill, registered once at start-up:

```typescript
import { installTemporalPolyfill } from "@tavnit-ts/tavnit/temporal-polyfill";
installTemporalPolyfill();
```

Without it a lean engine raises `TAV_USAGE` ("Temporal is not available") on the first date value. A native
`Temporal` always wins over the polyfill; the root entry point installs the polyfill itself, so a host that
imports only `@tavnit-ts/tavnit` changes nothing. A build for a runtime with `Temporal` that imports neither
`@tavnit-ts/tavnit` nor the polyfill subpath holds no polyfill and no JSBI.

`builtinFilterNames` is a static list: importing it bundles under 1 KB, not the registry.

### Engine Instantiation and Isolation

Each call to `createEngine` produces an isolated evaluator with its own
filter registry and configuration. There is no global filter registry —
different modules can use different filter sets. This is the same isolation
model as LiquidJS `new Liquid({ ... })`.

```typescript
import { createEngine, createCache } from "@tavnit-ts/tavnit";

const engine = createEngine({
  // Resource limits (see Runtime Limits) — all optional, values below are defaults
  maxDepth: 50,
  maxIterations: 1_000_000,    // items and loop iterations per engine call
  maxSteps: 10_000_000,        // expression nodes per engine call
  // timeoutMs: 100,           // opt-in wall-clock guard; off by default
  maxOutputBytes: 1_048_576,   // 1 MB — max total render() output size
  maxStringLength: 10_000_000, // longest string a built-in may produce
  maxRegexInput: 100_000,      // longest subject of native-regex built-ins

  // Shared cache of compiled expressions and templates (see Shared Cache) — optional; omit for a private one
  cache: createCache(),

  // Top-level context keys whose values are redacted in error messages (see Secret Values in Diagnostics)
  secretRoots: ["env", "secrets"],

  // Strict mode and division by zero (see Strict mode in language.md) — default: strict
  strict: true,                // false: unknown names and missing fields read as null
  divisionByZero: "error",     // "error" | "infinity"; the default follows strict ("infinity" when strict is false)
  undefinedIsAbsent: false,    // true: a context key set to undefined is no name (unknown in strict mode), not a name that reads null

  // Custom filters (see Filter Registration)
  filters: { ... },
});
```

**Typical deployment pattern — one engine, many derived engines.**
Create one process-wide engine at startup with the shared cache and
process-level filters. At module load time, derive a child engine for each
module and register module-specific filters on it. At file parse time, derive
a further child if file-local filters are needed. Do not call `createEngine`
inside a hot path — engine construction is a setup step, not a per-request
operation.

```typescript
// startup — once per process
const cache = createCache();
const globalEngine = createEngine({
  cache,
  secretRoots: ["env", "secrets"],
  filters: { sha256, tenantFilter },
});

// module load — once per module
const courseEngine = globalEngine.derive({
  filters: { pricePerLesson, eligibleStudent },
});

// evaluation — per request
const result = await courseEngine.evaluate(expression, dataContext);
```

This matches the pattern LiquidJS users will recognise: `new Liquid()` as an
application singleton, with per-module configuration layered on top via
`derive()` rather than a new `new Liquid()` call.

### Filter Registration

Custom filters are registered under the `filters` key and are callable both as
named functions and via pipe:

A filter key may be dotted — `"connection.get"` is called as
`connection.get(...)` (and `x | connection.get`). That is how a host keeps a name
reachable when a built-in already owns the bare one: `get(...)` stays the
built-in, `connection.get(...)` is the registered filter. The key is a name, not
a path — nothing is looked up on a `connection` value.

```typescript
const engine = createEngine({
  filters: {
    // sha256(value)  or  value | sha256()
    sha256: (value: Value): Value => {
      return crypto.createHash("sha256").update(String(value)).digest("hex");
    },

    // dateFormat(value, "yyyy-MM-dd")  or  value | dateFormat("yyyy-MM-dd")
    dateFormat: (value: Value, fmt: Value): Value => {
      return format(parseISO(String(value)), String(fmt));
    },

    // Async filters run only on the async path — when the data context
    // contains a resolve() value. Otherwise calling one throws.
    lookup: async (id: Value): Promise<Value> => {
      return await db.find(String(id));
    },
  },
});
```

### Filter Signature

```typescript
type FilterFn = (value: Value, ...args: Value[]) => Value | Promise<Value>;
```

The first argument is always the pipe value — the left-hand side of `|`, or
the first argument in direct-call form. Additional arguments follow. This
matches the LiquidJS custom filter signature, making porting mechanical.

### Host integration

An application that embeds the engine uses a handful of pieces that an expression author never
sees. They are exported from `@tavnit-ts/tavnit/host`, apart from the root API:

```typescript
import { contextFilter, opaque, resolve, Resolver, synchronousFilter } from "@tavnit-ts/tavnit/host";
import type { ContextFilterFn, EvalContext, EvaluationOptions } from "@tavnit-ts/tavnit/host";
```

| Piece | Purpose | Reference |
|---|---|---|
| `Resolver`, `resolve(fn)` | A context root read lazily and asynchronously, key by key | [Lazy Async Context](#lazy-async-context--resolver-and-resolve) |
| `contextFilter(fn)`, `ContextFilterFn`, `EvalContext` | A filter that receives the evaluation context | [Context-aware host filters](#context-aware-host-filters) |
| `synchronousFilter(fn)` | Marks a context filter safe to try synchronously; a promise triggers one async retry | [Context-aware host filters](#context-aware-host-filters) |
| `opaque(value)` | Marks a host object (a stream, a handle) so the strict context check lets it through | [Opaque host values](#opaque-host-values) |
| `EvaluationOptions` | Per-call hooks: `callHostFunction` dispatches a host function, `runtimeValues` supplies values to context-aware filters. Accepted by `evaluate`, `evaluateSync`, `renderObject` and `renderObjectSync` | [Context-aware host filters](#context-aware-host-filters) |
| `EngineOptions.secretRoots` | Top-level context keys whose values are redacted in error messages | [Secret roots](security.md#secret-values-in-diagnostics) |

`Resolver`, `resolve` and `EvaluationOptions` are exported from `@tavnit-ts/tavnit/host` only, not from the root entry point.

### Opaque host values

Strict mode refuses an instance of a named class in the context (`TAV_CONTEXT`). A host that must
carry such an object through a template (a stream from one action to the next, a request-scoped
handle) marks it first: `const body = opaque(new PassThrough())`. The marked object passes the
check unchanged, is handed to filters as it is, and the engine does not walk its fields. A built-in container
(`Map`, `Set`, `Promise`) is refused unless marked.

### Context-aware host filters

An engine host that needs a stable registered name with per-evaluation state can
use `contextFilter()` from `@tavnit-ts/tavnit/host`. It receives the evaluation context;
ordinary application filters must use `FilterFn` instead. `Engine.evaluate()` accepts
an optional `EvaluationOptions` object whose `callHostFunction` callback is
available to such a filter.

`synchronousFilter(contextFilter(fn))` permits the sync evaluator even when the
context also contains a `Resolver`. The filter's sync attempt must have no effects:
if it returns a promise, Tavnit retries the expression on the async path.
`ctx.asyncMode` tells the host which path is running. `callHostFunction` receives
that mode as its third argument.

```typescript
import { createEngine } from "@tavnit-ts/tavnit";
import { contextFilter } from "@tavnit-ts/tavnit/host";

const engine = createEngine({
  filters: {
    lookup: contextFilter((ctx, _value, ...args) => {
      if (ctx.callHostFunction === undefined) throw new Error("No host dispatcher");
      return ctx.callHostFunction("lookup", args);
    }),
  },
});

await engine.evaluate("lookup(id)", { id: "42" }, {
  callHostFunction: async (name, args) => ({ name, args }),
});
```

### Reserved Names

Registering a filter whose name appears in the prototype-restriction list
(`__proto__`, `constructor`, `prototype`, `__defineGetter__`, etc.) throws at
registration time, not at render time.

Built-in function names may be overridden by a custom filter of the same name,
allowing a host to replace a built-in with a domain-specific version. Override
with care.

`builtinFilterNames` is the list of every built-in name, exported so a host that
registers filters from an open set (user-supplied names) can keep built-ins from
being shadowed by accident:

```typescript
import { builtinFilterNames, createEngine } from "@tavnit-ts/tavnit";

const reserved = new Set(builtinFilterNames);
const safe = Object.fromEntries(
  Object.entries(userFilters).filter(([name]) => !reserved.has(name)),
);
const engine = createEngine({ filters: safe });
```

### Shared Cache

By default each engine instance keeps a private cache of compiled expressions
and templates: expressions and text templates keyed on their source string,
value trees on their identity. `createCache()` produces a cache object that can
be passed to any number of engines:

```typescript
import { createEngine, createCache } from "@tavnit-ts/tavnit";

const cache = createCache();

const engineA = createEngine({ cache, filters: { ... } });
const engineB = createEngine({ cache, filters: { ... } });
```

Sharing is safe because the compiled form encodes only structure — filters and
limits apply at evaluation time. A call node for
`filter(eligible)` records a call to a name; which function `eligible` maps to
is resolved against the evaluating engine's scope at runtime.

The cache has no eviction policy. Template strings read from configuration files are static
constants; the cache grows only to the number of distinct template strings in
the system and never needs clearing. Do not feed it strings built at runtime.

`cache.metrics(): CacheMetrics` returns `CacheMetric` hit/miss counters for expressions,
text templates and identity-keyed value templates. `cache.resetMetrics()` clears only
those counters, not compiled values. A stable tree must have one value-template miss
followed by hits; newly allocated trees cannot reuse that identity entry, though their
identical string leaves still reuse text templates.

### Engine Derivation

`engine.derive(options)` creates a child engine that inherits the parent's filter
registry and shares its cache. Filters registered on the child shadow parent
filters with the same name.

```typescript
const globalEngine = createEngine({
  cache,
  filters: { sha256, tenantFilter },
});

// inherits globalEngine's filters; adds module-level filters
const moduleEngine = globalEngine.derive({
  filters: { eligible, pricePerLesson },
});

// inherits moduleEngine's filters; adds file-local filters
const fileEngine = moduleEngine.derive({
  filters: { localFormat },
});
```

Filter resolution at evaluation time walks the chain from the evaluating engine
toward the root:

1. Filters registered on the evaluating engine
2. Filters registered on its parent engine
3. … continuing up the chain …
4. Built-in functions (see [Built-in Functions](builtins.md#built-in-functions))

First match wins. The chain is fixed at `derive()` time — there is no way to add
or remove filters from an already-derived engine.

**Resource limits and modes** — `maxDepth`, `maxIterations`, `maxSteps`, `timeoutMs`, `maxOutputBytes`, `maxStringLength`,
`maxRegexInput`, `strict`, `divisionByZero` and `undefinedIsAbsent` are inherited
from the parent unless overridden in the `derive()` call. A `divisionByZero` left unset follows the `strict` of the engine it is read on. A child may tighten or
relax any limit; relaxing above the parent's value is the host's responsibility.

**Reserved names** — the check described in [Reserved Names](#reserved-names) fires at each `derive()` call
independently. A reserved name cannot be registered at any scope level.

### Lambda Compilation

`engine.compile(source)` parses a Tavnit arrow expression string and returns a
`FilterFn` (see [Filter Signature](#filter-signature)) that can be passed to `derive()` or to
`createEngine`:

```typescript
const fn = moduleEngine.compile("x => x.active && x.balance > 0");
const fileEngine = moduleEngine.derive({ filters: { eligible: fn } });
```

`source` must be an arrow expression at the top level (see [Arrow Functions](language.md#arrow-functions)). Any other
expression form is a compile-time error. The compiled function:

- Binds its positional arguments to the arrow's parameter list.
- Evaluates the body using the **compiling engine's** scope chain for filter
  resolution — the same chain that was in effect when `compile()` was called.
- Has no access to an outer data context. Only its own parameters and the
  compiling engine's registered filters (and built-ins) are in scope.

The last point is a security property: a compiled filter cannot read `args`,
`state`, `env`, or any other data-context root from the expression it is later
called within.

```typescript
// body resolves toInstant, now, subtract from moduleEngine's built-ins
const recent = moduleEngine.compile(
  "x => toInstant(x.date) > subtract(now(), { days: 3 })"
);
const fileEngine = moduleEngine.derive({ filters: { recent } });

// callable as a named filter or via pipe
// items: messages | filter(recent)
```

The compiled filter obeys the same reserved-name rules as any registered filter
(see [Reserved Names](#reserved-names)) and uses the `FilterFn` signature
(see [Filter Signature](#filter-signature)). It is **synchronous**: the wrapper
calls `evaluate()`, so a body that calls an async filter throws
`Filter 'x' is async — use engine.evaluate() for async filter support`.

### Core Evaluation API

```typescript
// Evaluate an expression — returns the native Value
engine.evaluate(source: Expression | string, context?: DataContext, options?: EvaluationOptions): Promise<Value>

// Render a text template — evaluates ${{ }} spans and ${% if/for %} block tags — always returns string
engine.render(template: string, context?: DataContext): Promise<string>

// Render a value tree (or a compiled ValueTemplate): every string goes through the engine by the value-template rules
engine.renderObject(value: Value | ValueTemplate, context?: DataContext, options?: EvaluationOptions): Promise<Value>

// Compile an expression or YAML/JSON value tree
engine.parse(source: string): Expression
engine.parse(value: Value): ValueTemplate

// Compile without evaluating, through the engine's cache (see Shared Cache).
// A value tree is memoised on its identity — do not mutate it afterwards;
// `parse(value)` compiles a fresh tree but still reuses its cached strings.
engine.parseTextTemplate(template: string): TextTemplate // opaque handle; the same template gives the same handle
engine.parseValueTemplate(value: Value): ValueTemplate // a string is a text template or one expression
// template.isStatic: true when the tree holds only literals (no expression, directive or templated key),
// so it evaluates the same in any context and a caller may skip building one

// The same compilers without a cache, and static analysis of a compiled text template
// (from `@tavnit-ts/tavnit/internal`, unstable)
parseTextTemplate(template: string): TextTemplateNode[]
parseValueTemplate(value: Value): ValueTemplate
textTemplateExpressions(nodes: TextTemplateNode[]): ASTNode[] // spans, conditions, iterables
forEachNode(node: ASTNode, visit: (node: ASTNode) => void): void // parents before children
```

Each entry point takes one kind of source: `evaluate` an expression, `render` a text template,
`renderObject` a value tree. A string given to `evaluate` is always an expression, so
`evaluate("${{ a }}-x")` is a syntax error; use `render` for it. `TextTemplate` is opaque: pass it
to `analyze` or `check`; a tool that walks its content calls `textTemplateExpressions(template.nodes)`
from the internal entry point.

`evaluate` corresponds to expression mode (see
[Expression Mode vs. Text-Embedding Mode](embedding.md#expression-mode-vs-text-embedding-mode)):
the source is a bare expression, and the result is a native `Value` with type
preserved. Passing a pre-parsed `Expression` (see [Parse API](#parse-api)) skips
the parse step; passing a raw string hits the expression cache first and parses
only on a miss.

`parse(value)` validates the expression spans and `$if` / `$unless` directives of a value tree
once, then returns an opaque `ValueTemplate` that `renderObject` evaluates repeatedly.

`render` corresponds to text-embedding mode (see
[Expression Mode vs. Text-Embedding Mode](embedding.md#expression-mode-vs-text-embedding-mode)):
the template may contain any mix of literal text, `${{ }}` expression spans, and
`${% if/for %}` block tags. Each span is evaluated and stringified; block tags
include or repeat sections of the template; the method always returns `string`.
See [Block Tags](block-tags.md#block-tags) for block-tag syntax.

The total output size across all spans and literal text is capped by
`maxOutputBytes` (default 1 MB). Exceeding the limit throws `ExpressionError`.

`renderObject` evaluates a value tree by the rules in
[Value Templates](value-templates.md): a single-span string keeps its type, other
strings are text templates, and `...`, `$if` / `$unless`, `_` and `$_` are
directives. `null`, numbers, booleans, `FunctionValue`, `Resolver` and date
wrappers pass through unchanged.

Use it to pre-process a structured value — for example, rendering an object
tree read from YAML before passing it to a downstream system.

```typescript
const raw = {
  subject: "Order ${{ orderId }} confirmed",
  items: "${{ args.items }}",    // expression mode — preserves the array
  meta: {
    count: "${{ size(args.items) }}",
    "...": "${{ extraMeta }}",   // spread — merged into meta
  },
};

const rendered = await engine.renderObject(raw, { orderId: 42, args, extraMeta });
// rendered.subject === "Order 42 confirmed"  (string)
// rendered.items   === [...]                 (original array, not a string)
// rendered.meta    === { count: 3, ...extraMeta fields }
```

`context` is a plain object whose top-level keys are the names available inside
the expression. Keys absent from `context` evaluate to `null` (see
[Null and Error Propagation](language.md#null-and-error-propagation)).

When all filters in the expression are synchronous, the returned `Promise`
resolves on the same microtask — no scheduler overhead.

**Span evaluation order in `render()`** — when a template contains multiple
`${{ }}` spans, the order in which they are evaluated is implementation-defined.
Do not rely on one span's side effects (e.g. a custom async filter that mutates
external state) being visible to a later span.

```typescript
// Type-preserved result
const enabled: Value = await engine.evaluate("enabled", { enabled: true });
// enabled === true  (boolean, not string)

// Pre-parsed Expression — parse step skipped entirely
const expr: Expression = engine.parse("price * qty");
const total: Value = await engine.evaluate(expr, { price: 10, qty: 3 });
// total === 30

// Text-embedding — always returns string
const path: string = await engine.render("/items/${{ id }}/details", { id: 42 });
// path === "/items/42/details"
```

### Synchronous methods

```typescript
engine.evaluateSync(source: Expression | string, context?: DataContext, options?: EvaluationOptions): Value
engine.renderSync(template: string, context?: DataContext): string
engine.renderObjectSync(value: Value | ValueTemplate, context?: DataContext, options?: EvaluationOptions): Value
```

The synchronous methods return the value itself, for a caller that cannot `await`: a React Native
render, a configuration load, a compiled `FilterFn`. They run the engine's synchronous path, apply the
same limits, strict mode, context validation and error locations, and give the same result as the
async method for every source that needs no async work.

A source that needs async work cannot run there. `evaluateSync`, `renderSync` and `renderObjectSync` throw
`ExpressionError` with code `TAV_ASYNC_REQUIRED` when the source reads a [`Resolver`](#lazy-async-context--resolver-and-resolve)
root or calls a filter that returns a promise. The message names it and the async method to use:

```typescript
engine.evaluateSync("state.user", { state: resolve(async (key) => load(key)) });
// ExpressionError [TAV_ASYNC_REQUIRED]: Resolver 'state' requires async evaluation; evaluateSync() cannot wait for it, use evaluate()
```

A `Resolver` is refused only when it is read (or returned whole), not for being named: `false && state.x` and a read answered by the resolver's `staticValues` succeed.
A promise-returning filter is detected when it runs, so the filter has started when the error is thrown.
Register such a filter on an engine used only with the async methods, or avoid the sync methods for
templates that name it.

### Parse API

```typescript
engine.parse(source: string): Expression
```

Parses a Tavnit expression string and returns an opaque `Expression` handle.
Throws `ExpressionError` immediately if the source contains a syntax error — no
data context is needed.

`Expression` is opaque by convention — its only supported use is to be passed
back to `engine.evaluate()`. It does carry implementation fields (`_node`,
`_source`); do not depend on them.

`parse` is synchronous and populates the engine's cache as a side effect.
A subsequent `engine.evaluate(source, ctx)` call with the same string will hit
the cache and skip parsing — the two paths are equivalent in steady state.

Primary use cases:

**Pre-validation at load time** — catch syntax errors when a configuration file is
first read, not when the expression is first evaluated:

```typescript
// Validate all expressions up front; collect every error before throwing
const diagnostics: Diagnostic[] = [];
for (const src of expressionStrings) {
  try { engine.parse(src); }
  catch (e) {
    if (e instanceof ExpressionError) diagnostics.push(...e.errors);
  }
}
```

**Explicit cache warm-up** — populate the shared cache (see [Shared Cache](#shared-cache))
before the hot path so no evaluation call ever pays a parse cost:

```typescript
for (const src of knownExpressions) engine.parse(src);
// all subsequent engine.evaluate(src, ctx) calls hit the cache
```

### Static analysis — `analyze` and `check`

```typescript
engine.analyze(source: string | Expression | TextTemplate | ValueTemplate, kind?: "expression" | "text"): Analysis
engine.check(source: string | Expression | TextTemplate | ValueTemplate, options?: CheckOptions): Diagnostic[]

interface Analysis {
  variables: string[];   // free variables, in source order, once each
  functions: string[];   // names called, in source order, once each
  calls: { name: string; start: SourcePosition; end: SourcePosition }[];  // every call with its span
}

interface CheckOptions {
  kind?: "expression" | "text";    // how to read a string source; default "expression"
  variables?: readonly string[];   // the context names that exist; omit to skip the variable check
  filters?: readonly string[];     // function names that exist beyond the built-ins and the engine's filters
}
```

Both read a source without running it and throw `ExpressionError` on a syntax error. A string is an
expression unless `kind` is `"text"`; a value tree is compiled first (`engine.parseValueTemplate(tree)`).

`analyze` reports the free variables — the names read from the data context. A name bound by an arrow
parameter, a `let` binding or a `${% for %}` loop (and `forloop` inside it) is not free. `calls` holds
the span of every call; in a text template the span is a line and column of the template, in an
expression of the expression. Inside a value tree the span is that of the expression or string that holds
the call.

`check` compares those names with what the host provides and returns one `Diagnostic` per problem, in
source order, each with `severity: "error"`, a `location` and the nearest known name as a suggestion
(`; did you mean 'x'?`), as strict mode gives at run time:

| Code | Problem |
|---|---|
| `TAV_UNKNOWN_NAME` | A free variable that is not in `variables`; `access` holds the name |
| `TAV_UNKNOWN_FUNCTION` | A called name that is not a built-in, a filter of the engine or in `filters` |

Without `variables` no variable is reported. Arity is not checked: the built-in registry records no
parameter counts, so a call with too many or too few arguments passes `check` and fails when it runs.

```typescript
const engine = createEngine();
engine.analyze("items | map(i => i.id + offset)");
// { variables: ["items", "offset"], functions: ["map"], calls: [{ name: "map", start, end }] }

engine.check("itms | mapp(i => i)", { variables: ["items"] }).map((d) => d.message);
// ["Unknown name 'itms'; did you mean 'items'?", "Unknown function 'mapp'; did you mean 'map'?"]
```

### Public and internal entry points

The package has these API entry points:

- `@tavnit-ts/tavnit` — the public API, covered by semver. A test pins its list of exports. `@tavnit-ts/tavnit/core`
  exports the same list with a lean `createEngine`, and the `builtins/*`, `regex-linear` and `temporal-polyfill`
  subpaths are covered by semver too.
- `@tavnit-ts/tavnit/host` — the host-integration API ([Host integration](#host-integration)), covered by semver and pinned the same way.
- `@tavnit-ts/tavnit/internal` — the evaluator, lexer, parser, AST and static-analysis
  helpers, for tools built on Tavnit: linters, compilers to another language, host
  runtimes. **Unstable and not covered by semver**; a minor or patch release may rename
  or remove anything in it. Application code never needs it.

### Exported Types

Named exports from `@tavnit-ts/tavnit`:

```typescript
import {
  createEngine,
  createCache,
  builtinFilterNames,
  formatDiagnostic,
  ExpressionError,
  ValueTemplate,
  TextTemplate,
  Cache,
  Temporal,
  Instant,
  PlainDate,
  PlainTime,
  PlainDateTime,
  Duration,
  // persistence codec for date/time values
  serialiseValue,
  deserialiseValue,
} from "@tavnit-ts/tavnit";

import type {
  Analysis,
  AnalysisCall,
  CheckOptions,
  Engine,
  EngineOptions,
  Expression,
  FormatOptions,
  Value,
  DataContext,
  FilterFn,
  CacheMetric,
  CacheMetrics,
  Diagnostic,
  SourceLocation,
  SourcePosition,
  BuiltinCategory,
  LinearRegexEngine,
} from "@tavnit-ts/tavnit";
```

Named exports from `@tavnit-ts/tavnit/host`:

```typescript
import { Resolver, resolve, contextFilter, synchronousFilter } from "@tavnit-ts/tavnit/host";
import type { ContextFilterFn, EvalContext, EvaluationOptions } from "@tavnit-ts/tavnit/host";
```

Named exports from `@tavnit-ts/tavnit/internal` (unstable):

```typescript
// evaluator
import {
  evaluate,
  evaluateAsync,
  contextFilter,
  EvaluationError,
  FunctionValue,
} from "@tavnit-ts/tavnit/internal";
import type { EvalContext, Locals, FilterRegistry, RegexMode, RuntimeLimits } from "@tavnit-ts/tavnit/internal";

// lexer and template layer
import { tokenize, extractSpans, TokenKindValues, TemplateError, LexError } from "@tavnit-ts/tavnit/internal";
import type { Span, Token, TokenKind } from "@tavnit-ts/tavnit/internal";

// parser, compiled templates and static analysis
import {
  parse,
  ParseError,
  parseValueTemplate,
  parseTextTemplate,
  textTemplateExpressions,
  forEachNode,
} from "@tavnit-ts/tavnit/internal";
import type {
  TextTemplateNode,
  TextTemplateExpression,
  ASTNode,
  // AST node types and operator unions
  ArrayLiteralNode, ArrowNode, BinaryOp, BinaryOpNode, CallNode, IdentifierNode,
  IndexAccessNode, LetInNode, LiteralNode, MemberAccessNode, ObjectLiteralNode,
  PipeNode, TernaryNode, UnaryOp, UnaryOpNode,
} from "@tavnit-ts/tavnit/internal";

// linting and fixes — see "Linting value templates"
import {
  lintValueTemplate,
  fixBlankIdiom,
  fixInlineObject,
  TAVNIT_LINT_CODE,
} from "@tavnit-ts/tavnit/internal";
import type { LintDiagnostic, TavnitLintCode, ValueTemplateLintOptions, InlineObjectFix } from "@tavnit-ts/tavnit/internal";
```

`Instant`, `PlainDate`, `PlainTime`, `PlainDateTime`, and `Duration` are value
exports (classes) as well as types.

**`Temporal`** — the `Temporal` namespace that the date/time values above wrap:
the runtime's native one when it has it, `@js-temporal/polyfill` otherwise. Build
the `_inner` of those classes from this export, never from the polyfill directly:
values of the two implementations do not mix.

```typescript
import { Instant, Temporal } from "@tavnit-ts/tavnit";

const now = new Instant(Temporal.Now.instant());
```

**`Expression`** — handle returned by `engine.parse()` and accepted by
`engine.evaluate()`. Treat it as opaque.

**`TextTemplate`** — handle returned by `engine.parseTextTemplate()` and accepted by `engine.analyze()` and
`engine.check()`. Treat it as opaque.

**`Value`** — the union of all types an expression can return. Maps directly to
TypeScript types:

```typescript
type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value }
  | FunctionValue
  | Resolver
  | Instant
  | PlainDate
  | PlainTime
  | PlainDateTime
  | ZonedDateTime
  | Duration;
```

`ZonedDateTime` (produced by `toZonedDateTime()`) is a date `Value` subtype whose
only use is timezone-aware `format()`. It cannot be compared, and is not exported
as a standalone type — but it is an ordinary value: it can live in the data
context and pass between filters.

**`DataContext`** — the context argument shape:

```typescript
type DataContext = Record<string, Value>;
```

**`Engine`** — the interface returned by `createEngine()` and
`engine.derive()`:

```typescript
interface Engine {
  evaluate(source: Expression | string, context?: DataContext, options?: EvaluationOptions): Promise<Value>;
  evaluateSync(source: Expression | string, context?: DataContext, options?: EvaluationOptions): Value;
  render(template: string, context?: DataContext): Promise<string>;
  renderSync(template: string, context?: DataContext): string;
  renderObject(value: Value | ValueTemplate, context?: DataContext, options?: EvaluationOptions): Promise<Value>;
  renderObjectSync(value: Value | ValueTemplate, context?: DataContext, options?: EvaluationOptions): Value;
  parse(source: string): Expression;
  parse(value: Value): ValueTemplate;
  parseTextTemplate(template: string): TextTemplate;
  parseValueTemplate(value: Value): ValueTemplate;
  analyze(source: string | Expression | TextTemplate | ValueTemplate, kind?: "expression" | "text"): Analysis;
  check(source: string | Expression | TextTemplate | ValueTemplate, options?: CheckOptions): Diagnostic[];
  compile(source: string): FilterFn;
  derive(options?: Partial<EngineOptions>): Engine;
}
```

**`EngineOptions`** — the options bag for `createEngine()` and
`engine.derive()`:

```typescript
interface EngineOptions {
  maxDepth?: number;         // default: 50
  maxIterations?: number;    // default: 1_000_000 — items and ${% for %} iterations per engine call
  maxSteps?: number;         // default: 10_000_000 — expression nodes per engine call; positive integer
  timeoutMs?: number;        // default: off — opt-in wall-clock guard per engine call, in ms
  strict?: boolean;          // default: true — unknown names, missing fields and properties of non-objects are errors; false reads them as null
  divisionByZero?: "error" | "infinity"; // default: "error" when strict, else "infinity"
  undefinedIsAbsent?: boolean;           // default: false — a key set to undefined reads as null; true: it is absent (unknown name in strict mode)
  maxOutputBytes?: number;   // default: 1_048_576 (1 MB) — total render() output cap
  maxStringLength?: number;  // default: 10_000_000 — longest string a built-in may produce; positive integer
  maxRegexInput?: number;    // default: 100_000 — longest subject of native-regex matches()/capture()/captures(); positive integer
  cache?: Cache;             // shared compile cache; omit for a private per-engine cache
  secretRoots?: string[];    // default: [] — top-level context keys redacted in error messages
  regex?: "linear" | "native" | LinearRegexEngine; // default: "linear" (root) / "native" (core) — engine of matches() / capture() / captures()
  builtins?: readonly BuiltinCategory[]; // default: every category (root), none (core) — the built-ins to register
  filters?: Record<string, FilterFn | ContextFilterFn>;
}

interface EvaluationOptions {
  callHostFunction?: (name: string, args: Value[], asyncMode: boolean) => Value | Promise<Value>;
  runtimeValues?: Readonly<Record<string, Value>>;
}
```

`regex: "linear"` runs RE2 syntax in linear time — no lookaround or backreferences, any subject length.
`"native"` runs JavaScript's `RegExp` behind static guards and a 100 000-character subject cap. An engine
object (`linearRegex` from `@tavnit-ts/tavnit/regex-linear`) is `"linear"` with that engine. `builtins` takes
categories from `@tavnit-ts/tavnit/builtins/<name>` — see [Lean engines](#lean-engines-and-built-in-selection). See
[`matches`](builtins-strings.md) and [Runtime Limits](security.md#runtime-limits).

**`FilterFn`** — custom filter function signature (see [Filter Signature](#filter-signature)):

```typescript
type FilterFn = (value: Value, ...args: Value[]) => Value | Promise<Value>;
```

**`Cache`** — shared cache object returned by `createCache()` (see
[Shared Cache](#shared-cache)). Treat it as opaque; it is
passed to `createEngine({ cache })` and nothing else.

**`Resolver`** (from `@tavnit-ts/tavnit/host`) — opaque lazy async context root. Placed as a top-level value in
`DataContext`; when the evaluator accesses a member or index on it, it calls the
provided async function instead of doing a plain property lookup. Equivalent to
LiquidJS Drops. Create with `resolve()` (see [Lazy Async Context — `Resolver` and `resolve()`](#lazy-async-context--resolver-and-resolve)).

```typescript
type Resolver  // opaque — create with resolve(), place in DataContext
```

**Date/time types** — `Instant`, `PlainDate`, `PlainTime`, `PlainDateTime`,
`Duration` are exported classes (see [Date and Time](datetime.md#date-and-time)), opaque to
expressions: internals are not accessible, and values are created only by the
built-in date functions.

**`serialiseValue(value)` / `deserialiseValue(value)`** — persistence codec for
date/time values. `serialiseValue` replaces each date/time wrapper in a `Value`
tree with its tagged map — the form `json()` prints, see
[Serialisation](builtins-objects.md#serialisation) — and `deserialiseValue`
revives those maps into live wrappers. Use them around any JSON or YAML store
that keeps values between evaluations. A `ZonedDateTime` passes through
unencoded and is never revived.

### Lazy Async Context — `Resolver` and `resolve()`

A `Resolver` is an opaque lazy async context root. Instead of eagerly loading all
keys into the `DataContext` object, you place a `Resolver` at one (or more)
top-level keys. When an expression accesses `state.someKey`, the engine calls your
async function with `"someKey"` as the argument and awaits the result. This is
the Tavnit equivalent of LiquidJS Drops.

```typescript
import { createEngine } from "@tavnit-ts/tavnit";
import { resolve } from "@tavnit-ts/tavnit/host";

const engine = createEngine({ ... });

// resolve(fn) wraps an async key→value function as a Resolver
const stateResolver = resolve(async (key) => kvStore.get(key));

// Place it as a top-level DataContext value
const result = await engine.evaluate("state.balance > 0", {
  state: stateResolver,
});
// Accessing state.balance calls kvStore.get("balance") and awaits the result.
```

`resolve()` signature:

```typescript
function resolve(fn: (key: string) => Promise<Value>, staticValues?: Readonly<Record<string, Value>>): Resolver
```

**Rules and limits:**

- `staticValues` supplies keys the resolver can read synchronously. Other keys use `fn`.
  Capture these values once per evaluation when the backing store can change.

- `Resolver` values can only be placed at **top-level `DataContext` keys**.
  They cannot be stored inside array or object literals, or nested inside other
  values. A `Resolver` reaching a filter as an argument is resolved on member /
  index access, not rejected.
- Resolvers **are supported inside arrow function bodies** passed to collection
  builtins (`filter`, `map`, `sort`, `find`, `some`, `every`, `reduce`, `flatMap`,
  `uniqBy`, `groupBy`). The async evaluator path uses an async-aware `invokeFn`,
  so every top-level `Resolver` is reachable from a lambda body:
  ```typescript
  // ✓ Resolver access inside arrow body — works correctly
  items | filter(x => x.date > context.since)
  items | map(x => state.prefix + x.name)
  items | sort(x => x.score * state.factor)
  ```
- When any top-level `DataContext` value is a `Resolver`, the engine
  automatically routes to the async evaluator each expression that names a
  `Resolver` key or a custom filter; the rest of the expressions, which cannot
  meet anything to await, take the faster synchronous path. No manual flag is needed.
- `render()` and `renderObject()` benefit automatically — both call
  `engine.evaluate()` internally.

```typescript
// Practical example — lazy KV integration
const engine = createEngine({ secretRoots: ["secrets"] });

const result = await engine.renderObject(adfActionArgs, {
  args:    { userId: "u42" },
  state:   resolve(async (key) => redisClient.get(`state:${key}`)),
  secrets: resolve(async (key) => secretsManager.get(key)),
});
```

### Error Types

Every `Engine` method throws `ExpressionError` — for expression, template and
block-tag syntax, value-template directives, runtime errors and limits alike.
Its `errors` array carries the individual diagnostics:

```typescript
interface SourcePosition {
  line: number;    // 1-based
  column: number;  // 1-based
}

interface SourceLocation {
  source: string;          // the expression, or the whole template for a render
  start?: SourcePosition;  // where the failing token or node starts
  end?: SourcePosition;    // where it ends (exclusive), when it has a span
}

interface Diagnostic {
  code?: string;             // stable code such as "TAV_LIMIT_ITERATIONS"; set on every error the engine raises
  severity?: "error" | "warning"; // absent means "error"
  message: string;
  location?: SourceLocation;
  path?: Array<string | number>; // value templates: keys / indexes to the failing node, at compile or run time
  limit?: string;            // limit errors: "iterations", "steps", "timeout", "output", "depth" or "string"
  value?: number;            // limit errors: the value of the limit
  option?: string;           // limit errors: the EngineOptions field that raises it
  access?: string;           // null access, unknown name or field, bad context value: the access path, such as "a.b"
}

class ExpressionError extends Error {
  readonly errors: Diagnostic[];
  format(options?: FormatOptions): string;
}

interface FormatOptions {
  name?: string; // what the source is — a file path or field name — printed before the position
}

function formatDiagnostic(diagnostic: Diagnostic, options?: FormatOptions): string;
```

The codes are listed in [Error codes](errors.md#error-codes); `ERROR_CODES`, exported from
`@tavnit-ts/tavnit/internal`, holds the same list. Branch on `code`, never on `message`.

**Context validation** — `evaluate`, `render` and `renderObject` check the data context first and throw an
`ExpressionError` with code `TAV_CONTEXT` for a function, a `BigInt`, a symbol, a `Map`, a `Set`, a `Promise`, a `RegExp`, an `Error`, a binary buffer or an invalid
`Date`, and in strict mode for an instance of any other named class; serialising a cycle raises it too. A valid `Date` becomes an instant. See [Context](errors.md#context).

### Linting value templates

These functions are exported from `@tavnit-ts/tavnit/internal`.

`lintValueTemplate()` currently suppresses `TAV001`–`TAV004` style diagnostics; `TAV005` is off unless
`blankIdiom: true` is passed.
It still validates templates and lint options. The retained `TAV001` rule identifies an inline object literal with more than two
direct fields, which is usually clearer as a `_` / `$_` subtree.
`TAV002` flags an expression over `maxExpressionLength` characters (default 300),
`TAV003` ternaries nested deeper than `maxTernaryDepth` (default 2), `TAV004` more
than `maxLambdas` lambdas in one expression (default 2). `TAV005` identifies
blank idioms (`(x ?? '') == ''` instead of `blank(x)`) and runs only with `blankIdiom: true`. `TAV001`–`TAV004` are temporarily disabled. `TAVNIT_LINT_CODE` contains the stable codes, `TavnitLintCode` is their union,
`LintDiagnostic` is the warning shape, and `ValueTemplateLintOptions` configures
the threshold.

```ts
import { lintValueTemplate } from "@tavnit-ts/tavnit/internal";

const warnings = lintValueTemplate(template, { maxInlineObjectFields: 2 });
```

Each warning has `severity: "warning"`, a stable `TAVxxx` `code`, and the same
source `location` and value-tree `path` fields as an error diagnostic.

`fixBlankIdiom(template)` rewrites every `TAV005` idiom of the template's `${{ }}`
spans to `blank(x)` / `filled(x)` and returns the new template, or `undefined`
when nothing matched. A whitespace-only string counts as blank, so the untrimmed
forms become slightly broader. Block-tag conditions are linted but not rewritten.

`fixInlineObject()` rewrites the first `TAV001` finding of a single-span template:
the record becomes a value tree (`body`, one `${{ }}` leaf per field, nested
records as nested trees) and `host` is the template with `_` in the record's
place — the `$_` host. `host` is `undefined` when the record was the whole
expression. It returns `undefined` when there is nothing to rewrite or no
faithful rewrite exists: text around the span, an expression that already uses
`_`, or a key that would read as a directive (`_`, `$_`, `$if`, `$unless`, `...`).
`InlineObjectFix` is its result type.

```ts
import { fixInlineObject } from "@tavnit-ts/tavnit/internal";

fixInlineObject("${{ rows | map(r => ({ id: r.id, name: r.name, n: 0 })) }}");
// { host: "${{ rows | map(r => _) }}",
//   body: { id: "${{ r.id }}", name: "${{ r.name }}", n: 0 } }
```

`ExpressionError.message` is the message of `errors[0]`, so a plain `catch (e)`
that reads `.message` gets a usable string without inspecting the array.

**Locations.** A syntax error points at its token. A runtime error points at the
node that raised it: the property for `a.b` on `null`, `callee(args)` for a
failing call or pipe step, the whole operation for an operator. A custom
filter's own `Error` is reported at its call. For `render()` / a text template,
`source` is the whole template and positions are the template's own lines and
columns; a value-template leaf keeps its expression as `source` and adds `path`.

**Printing.** `error.format()` prints every diagnostic — position, message, the
value-template path and the source line with a caret under the span — and
separates diagnostics with a blank line. `formatDiagnostic` prints one:

```typescript
try {
  await engine.evaluate("x | map(v => v.id)", {});
} catch (e) {
  if (e instanceof ExpressionError) console.error(e.format({ name: "rules.yaml" }));
}
// rules.yaml:1:5: error: map() requires an array, got null
//   1 | x | map(v => v.id)
//     |     ^^^^^^^^^^^^^^
```

The low-level `parse()` and `evaluate()` / `evaluateAsync()` functions throw
`ParseError` and `EvaluationError` instead: separate exported classes, not
subclasses of `ExpressionError`. `extractSpans()` throws `TemplateError`, whose
`offset` is the template index where the problem starts; `tokenize()` throws
`LexError` with its `position`.

Every message, its cause and its fix: [Error Catalog](errors.md#error-catalog).

### Static type checking

These functions are exported from `@tavnit-ts/tavnit/internal`. They check an expression against the
types of the names it reads and report an operation that throws for a value the contract permits. They never
evaluate. The findings and their codes (`TAV101`–`TAV109`, and `TAV201`–`TAV205` with `redundancy`) are in [errors.md](errors.md#type-findings).

A `TavType` describes a value: `null`, `boolean`, `number`, `string`, an array with an element type
(`arrayOf(element)`), an object (`objectOf(properties, open)`), a function result, a literal (`literalOf(value)`), a union (`unionOf(members)`)
or `unknown`, which asserts nothing and never produces a finding. Each object property is a `TavProperty`: its
type and a `Presence` of `required`, `optional` or `unknown`. Presence is independent of nullability, so a
property can be required and nullable (`nullable(type)`), or optional and non-null when present.
`includesNull(type)` and `withoutNull(type)` test and strip `null`; `formatType(type)` prints a type as a
finding shows it.

An array type can be known to hold at least one element (`arrayOf(element, true)`, printed `[T, ...T[]]`).
`isNonEmptyArray(type)` tests it and `asNonEmpty(type)` marks the array members of a type. The checker learns it
from a literal, from a contract, and from a guard that forces one element (`size(xs) > 0`, `filled(xs)`,
`!isEmpty(xs)`); `map`, `sort`, `reverse`, `uniqBy` and `concat` keep it, and over such an array `first`, `last` and
`xs[0]` have the element type without `null`.

A `TypeEnvironment` holds the `names` an expression can read, optional `functions` (a `HostFunctionType` gives
the result type of a host function; a built-in of the same name wins) and `closed`, which reports a name the
environment does not declare (`TAV103`) instead of typing it `unknown`. `assume` lists conditions the host
knows to hold where the expression runs (`TypeAssumption`: a parsed `condition` and whether it is `truthy`),
such as the `if:` of the step that evaluates it; each narrows the paths it reads, as a ternary condition does.
`redundancy: true` also reports a test or fallback the types already decide (`TAV201`–`TAV205`: a `??` whose
left side is never or always null, a null comparison with a fixed answer, a condition that is always truthy or
falsy); they are warnings and off by default.

A `TAV201` finding carries `dropFallback`, a `CoalesceFix`: the index of its `${{ }}` span in the template and the
`ExpressionSpan` (start and end, in the expression's own line and column) of each operand of the `??`.
`fixRedundantCoalesce(template, fixes)` removes the fallbacks those spans name and returns the new template, or
`undefined` when nothing changed; it keeps the parentheses around either operand, and works on the parsed value
or on the raw source of the same expressions. `redundantCoalesceRemovals(template, fixes)` returns the ranges
it would remove, for a host that maps them onto text written differently from its value (a folded block scalar).

`checkExpression(node, environment)` and `checkExpressionSource(source, environment)` return the
`TypeFinding[]` of one expression; the second throws the parser's error for source that does not parse.
`checkTemplate(template, environment)` checks every expression of a text template and maps each finding to
the template's line and column: the `${{ }}` spans, the conditions of `${% if %}` and `${% elif %}`, the iterable
of `${% for %}` and the spans inside each block. A branch body is checked under its condition and the negation of
the conditions before it; a `${% for %}` body reads its variable and `forloop` as `unknown`. Inside a block it
reports only the findings that throw, since a `dropFallback` indexes the top-level spans. It returns no findings
for a template that does not parse. `TAVNIT_TYPE_CODE`
holds the stable codes and `TavnitTypeCode` is their union. A finding has `code`, `severity` (`error` or
`warning`), `message`, `start`, `end`, and optionally `access`, `receiverType` and `hint`.

The checker follows the strict evaluator: a plain `.` or `[]` on an object without the key throws; the left side
of `??` and the receiver chain of `?.` read an absent key as `null`; a `.` on a `null` always throws; an array
index out of range is `null`. Guards (`x`, `x != null`, `type(x) == "array"`, `!x`, `&&`, `||`, a ternary
condition) narrow the paths they read; a `type()` test also narrows a union to the member of that kind. A free-form
object, one that declares no property, asserts nothing about its keys. A call to a built-in that is not typed has an `unknown` result.

The primitive types are the constants `NULL`, `BOOLEAN`, `NUMBER`, `STRING` and `UNKNOWN`.

```ts
import { checkTemplate, objectOf, STRING } from "@tavnit-ts/tavnit/internal";

const args = objectOf({ name: { type: STRING, presence: "optional" } }, false);
const findings = checkTemplate("Hi ${{ args.name }}", { names: { args } });
// [{ code: "TAV101", severity: "error", … }]: a plain read of an optional property
```
