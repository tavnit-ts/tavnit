# Changelog

## 0.2.0

The first release as `@tavnit-ts/tavnit`. Earlier versions were published under another name (0.1.x); the
list below is what changed since 0.1.x.

### Removed

- `engine.evaluate(valueTree)` and `engine.evaluate(valueTemplate)`: use `renderObject`.
- `engine.evaluateTextTemplate()`: use `render`.
- `Resolver`, `resolve` and `EvaluationOptions` from the root and `core` entry points: import them from `@tavnit-ts/tavnit/host`.

### Breaking

- **Breaking, in strict mode:** `?.` is an optional access. `x?.key` and `x?.[k]` read `null` when `x` is `null`, when `x` is a name that is not in the context, and when `x` is an object without that key. Any value behind `?.` (an array, a string, a number, a boolean) that lacks the property reads `null` too. A plain `.` stays an error. A typo behind `?.` is no longer reported; use `.` where the key must exist.
- **Breaking:** `strict: true` and `divisionByZero: "error"` are the defaults. A name that is not in the context, a field the value does not have, a property of a type that has none (`a.length` on an array) and `1 / 0` raise an `ExpressionError` instead of reading as `null` or `Infinity`. Migration: fix the template (`size(a)`, `x ?? default`, a guard before a division), or keep the old reading with `createEngine({ strict: false })` (and `divisionByZero: "infinity"` for a strict engine that divides by zero).
- **Breaking:** `engine.parseTextTemplate()` returns an opaque `TextTemplate` (exported from the root entry point) in place of an array of internal nodes. A tool that walks the nodes reads `template.nodes` and passes it to `textTemplateExpressions` from `@tavnit-ts/tavnit/internal`.
- **Breaking:** `timeoutMs` has no default any more. It was a 100 ms wall-clock limit, so the same template passed on an idle machine and failed on a loaded one. A host that wants the guard sets it (`createEngine({ timeoutMs: 100 })`). The deterministic budgets replace it: the new `maxSteps` (default 10 000 000 expression nodes per engine call) and `maxIterations`.
- **Breaking:** the unit of `maxIterations` is the engine call, and its default is 1 000 000 (was 10 000 per expression). One `evaluate`, `render` or `renderObject` call has one iteration budget, shared by the collection built-ins, the `${% for %}` loops, all spans of a template and all leaves of a value tree. A `map` over 100 000 items now passes by default.
- **Breaking:** a value from the data context is checked as an expression reads it, by name, field or index (not by a walk over the whole context before the call, which cost 17% of a warm screen render). A function, a `BigInt`, a symbol, a `Map`, a `Set`, a `Promise`, a `RegExp`, an `Error`, a binary buffer and an invalid `Date` raise an `ExpressionError` with code `TAV_CONTEXT` that names the path (strict mode refuses an instance of any other named class too); serialising a cycle raises it too (reading through a cycle still works). A valid `Date` becomes an instant (it used to pass through opaque and render as a quoted JSON string).
- **Breaking:** error messages changed. A null access reads `` `a.b` is null, cannot read `c` `` (was `Cannot access property 'c' on null`); the limit messages name the value and the option that raises it (`Iteration limit 1000000 exceeded; raise maxIterations`). Code that matches message text moves to `diagnostic.code`.
- **Breaking:** `matches()`, `capture()` and `captures()` run a linear-time regular-expression engine (RE2 syntax, `re2js`) by default. No pattern can run away, and a subject may be of any length. Lookahead, lookbehind and backreferences are not part of RE2: the engine reports which one a pattern uses. `.`, `\s`, `\S`, `\uXXXX` and `\cX` keep their JavaScript meaning. An astral character counts as one. `\p{…}` and the inline flags `(?i)`, `(?s)`, `(?m)` now work. `createEngine({ regex: "native" })` restores the JavaScript `RegExp` with its guards (lookahead and backreferences work, lookbehinds stay refused).
- **Breaking:** Tavnit names follow TypeScript / JavaScript; the Liquid names are removed, not aliased (an expression that uses one raises `TAV_UNKNOWN_FUNCTION`). Migration:
  - `upcase` is `toUpperCase`, `downcase` is `toLowerCase`.
  - `plus`, `minus`, `times`, `dividedBy`, `modulo` are removed: use `+`, `-`, `*`, `/`, `%`; parenthesise to pipe the result (`(a * b) | toFixed(2)`).
  - `random_string` (the deprecated alias) is removed: use `randomString`.
  - `toBool` is removed: use `bool`.
  - `base64urlEncode` no longer treats a 64-character lowercase hex string as a SHA-256 digest: it encodes the UTF-8 bytes of its argument only. For a digest use the new `base64urlEncodeHex` (`sha256(x) | base64urlEncodeHex`).

### Added

- Added the engine option `undefinedIsAbsent` (default `false`): a context key set to `undefined` is no name, so it is an unknown name in strict mode and `null` otherwise, decided by the identifier node as it reads. `derive()` inherits it. A host that built its context by dropping `undefined` entries sets it instead.
- Changed the engine to decide the async path from the node: an expression is evaluated synchronously, the node that reaches a `Resolver` raises `TAV_ASYNC`, and the node is evaluated again on the async path (budgets restored) and remembered as async. The pre-call scan of the context is gone, except for a node that names a custom filter, which still takes the path chosen before it runs.
- Added `opaque(value)` to `@tavnit-ts/tavnit/host`: marks a host object (a stream, a handle) so the strict context check passes it through.
- Added `engine.evaluateSync()`, `engine.renderSync()` and `engine.renderObjectSync()`: the synchronous path without a promise. They throw `ExpressionError` with the new code `TAV_ASYNC_REQUIRED` when the source reads a `Resolver` or calls an async filter.
- Added `engine.analyze()` (free variables, called functions and their positions) and `engine.check()` (unknown variables and unknown functions, with the nearest name). Arity is not checked.
- Added the entry point `@tavnit-ts/tavnit/host` with `Resolver`, `resolve`, `contextFilter`, `ContextFilterFn`, `EvalContext` and `EvaluationOptions`.
- Added subpath exports and a lean entry point, so a bundle holds only what a host selects: `@tavnit-ts/tavnit/core` (`createEngine` with no built-in), `@tavnit-ts/tavnit/builtins` and `@tavnit-ts/tavnit/builtins/<name>` for the categories `types`, `strings`, `regex`, `collections`, `objects`, `yaml`, `encoding`, `crypto` and `datetime`, `@tavnit-ts/tavnit/regex-linear` (`linearRegex`) and `@tavnit-ts/tavnit/temporal-polyfill` (`installTemporalPolyfill()`). The engine options gain `builtins` (the categories to register; absent means every category from the root entry point, none from `core`) and `regex` accepts an engine object. The root entry point behaves as before: `createEngine()` registers every built-in, runs the linear regex engine and installs the Temporal polyfill when the runtime has no `Temporal`. `core` with the common built-ins bundles to about 24 KB gzip; the full root entry point is about 150 KB.
- Added the size gate `pnpm run size` (`scripts/check-size.mjs`): it bundles the entry points with Vite and fails when a gzip size exceeds its recorded ceiling by more than 5% or a lean bundle holds `re2js`, `yaml`, `safe-regex2` or the Temporal polyfill.
- Added the engine option `strict`: an unknown name, a field the value does not have and a property of a type that has none (`a.length` on an array or a string) are errors, with a "did you mean" suggestion. `??` still lets its left side name a default. Default: `true`.
- Added the engine option `divisionByZero: "error" | "infinity"`: `1 / 0` and `5 % 0` raise `TAV_DIVISION_BY_ZERO` or yield `Infinity` / `NaN`. Default: `"error"` in strict mode (the default), `"infinity"` otherwise. `derive()` inherits and overrides `strict`, `divisionByZero` and `maxSteps`.
- Added a stable `code` to every error (`TAV_SYNTAX`, `TAV_NULL_ACCESS`, `TAV_UNKNOWN_FUNCTION`, `TAV_LIMIT_ITERATIONS`, …; the list is in the skill's `errors.md` and in `ERROR_CODES` of `@tavnit-ts/tavnit/internal`), and the optional `Diagnostic` fields `limit`, `value`, `option` and `access`. An unknown function suggests the nearest name. The build fails when `errors.md` lacks a code.
- Added the built-in `base64urlEncodeHex(hex)`: decodes a hex string (even length, `[0-9a-fA-F]`; otherwise `TAV_TYPE`) to bytes and Base64url-encodes them.
- Added the built-ins `round`, `floor`, `ceil`, `abs`, `sum`, `min`, `max`, `range` and `deepEquals`, the operator `**` (right-associative; a unary operator directly before `**` is a parse error, as in JavaScript: write `(-2) ** 2` or `-(2 ** 2)`) and exponent number literals (`1e3`, `1.5e-3`).
- `sort` takes `{ locale }` (`sort(arr, { locale: "ru" })` or after a key extractor) and orders strings with a cached `Intl.Collator`; without it the order is unchanged.
- Added the engine options `maxStringLength` (default 10 000 000) and `maxRegexInput` (default 100 000), validated as positive integers; `derive()` inherits and overrides them.
- Added `sideEffects: false`, `engines.node >=24`, a `LICENSE` file and this changelog to the package.

### Changed

- A `}}` inside a string literal or after a closing `}` no longer ends a `${{ }}` span: `${{ "}}" }}` and `${{ {id: 1}}}` parse. A string that never closes still ends at the first `}}`, so the error names the string.
- `<`, `>`, `<=` and `>=` order two strings by UTF-16 code unit (`"a" < "b"`, ISO dates held as strings); a mixed pair raises `Operator '<' requires two numbers or two strings`. Ordering two date values of different kinds now says `Operator '>' cannot compare instant and plaindate; convert one to the other's type (toInstant, toPlainDate)`.
- Number literals accept a leading dot (`.5`) and `_` between digits (`1_000_000`). `0x10`, `0b1` and `0o7` raise `Hexadecimal, binary and octal number literals are not supported`.
- A lean engine without `Temporal` raises `TAV_USAGE` (`Temporal is not available: …`) on the first date value, and `regex: "linear"` without an engine object raises `TAV_USAGE` in `matches`, `capture` and `captures`; a lean engine defaults to `regex: "native"`. `yaml()` moved out of `json`'s category: the `yaml` category is the only one that bundles the `yaml` package.
- `builtinFilterNames` is a generated static list (`src/builtins/names.ts`) in place of the registry: importing it costs under 1 KB gzip, not 134 KB. The order of names follows the categories.
- Documented the exact rules of `==` (strict; arrays and objects by reference), the `+` against `*` coercion asymmetry, and that numbers are IEEE doubles exact up to 2^53.
- A number literal too large for a double (`1` followed by 309 digits) is a parse error, `Number literal is too large`, in place of `Infinity`.
- Added an `exports` map: the root entry point and `@tavnit-ts/tavnit/internal` for the lexer, parser, AST and low-level evaluator. Code that imported those from the root moves to the subpath.
- Robustness limits: a nesting limit in the parser, a string-length limit, and a stricter check of regular expressions, each with a clear error in place of a JavaScript one.
- `node:crypto` is no longer imported at load time, and `Buffer` is no longer used, so the package loads in a browser or an edge runtime. `sha256()` and `hmacSha256()` need `node:crypto` when called; `uuid()`, `ulid()`, `randomString()` and `timingSafeEqualHex()` use Web Crypto.
