## Errors and Troubleshooting

<!-- contents -->
**Contents**

- [Error codes](#error-codes)
- [Error Catalog](#error-catalog)
- [Engine option errors](#engine-option-errors)
- [Lint findings](#lint-findings)
- [Type findings](#type-findings)
- [Silent Failures](#silent-failures)
- [Parser Quirks](#parser-quirks)
<!-- /contents -->

Every `Engine` method throws `ExpressionError`. Its `errors` array holds one or
more diagnostics, each with a stable `code` (see [Error codes](#error-codes)), a
`message`, a `location` — the source and the 1-based line / column span of the
failing token or node — and, for a value template, the `path` of keys and indexes
to the failing node. A limit error adds `limit`, `value` and `option`; a null
access, an unknown name or an unknown field adds `access`. `error.format()`
prints them with the source line and a caret:

```
rules.yaml:1:5: error: map() requires an array, got null
  1 | x | map(v => v.id)
    |     ^^^^^^^^^^^^^^
```

See [Error Types](typescript-api.md#error-types). Messages name types as
`type(v)` does: `null`, `array`, `object`, `instant`, `plaindate`, ….

### Error codes

Branch on `diagnostic.code`, never on the message text: a message may be reworded, a code stays.

| Code | Raised for |
|---|---|
| `TAV_SYNTAX` | A template, expression or value-tree directive that does not parse |
| `TAV_RUNTIME` | Any other evaluation error, including a built-in's argument error |
| `TAV_TYPE` | An operator, an index or a `for` iterable given a value of the wrong type |
| `TAV_NULL_ACCESS` | `.x` or `[i]` on `null`; `access` holds the path that is `null` |
| `TAV_UNKNOWN_NAME` | Strict mode: a name that is not in the context; `access` holds the name |
| `TAV_UNKNOWN_PROPERTY` | Strict mode: a field or property the value does not have; `access` holds the path |
| `TAV_UNKNOWN_FUNCTION` | A function that is neither a built-in nor registered |
| `TAV_DIVISION_BY_ZERO` | `/` or `%` by zero while `divisionByZero` is `"error"` |
| `TAV_LIMIT_ITERATIONS` | More than `maxIterations` items or loop iterations in one call |
| `TAV_LIMIT_STEPS` | More than `maxSteps` expression nodes in one call |
| `TAV_LIMIT_TIMEOUT` | The opt-in `timeoutMs` guard ran out |
| `TAV_LIMIT_OUTPUT` | A render produced more than `maxOutputBytes` |
| `TAV_LIMIT_DEPTH` | Expression nesting deeper than `maxDepth` |
| `TAV_LIMIT_STRING` | A string longer than `maxStringLength` |
| `TAV_LIMIT_STACK` | The JavaScript stack ran out on deeply nested data |
| `TAV_CONTEXT` | The context holds a value Tavnit cannot read; `access` holds its path |
| `TAV_ASYNC` | An async filter or a `Resolver` on the synchronous path |
| `TAV_ASYNC_REQUIRED` | `evaluateSync()`, `renderSync()` or `renderObjectSync()` met an async filter or a `Resolver`; the message names it. Use the async method |
| `TAV_HOST` | An error thrown by a host's own filter |
| `TAV_USAGE` | A wrong call to the engine API: a reserved filter name, `compile()` without an arrow |

A limit diagnostic carries `limit` (`iterations`, `steps`, `timeout`, `output`, `depth` or
`string`), `value` (the limit) and `option` (the `EngineOptions` field that raises it):

```typescript
try {
  await engine.evaluate("items | map(x => x)", { items });
} catch (error) {
  const [diagnostic] = (error as ExpressionError).errors;
  // diagnostic.code === "TAV_LIMIT_ITERATIONS", diagnostic.option === "maxIterations"
}
```

### Error Catalog

Grouped by the phase that raises the error. `x` / `f` stand for a name from the source.

#### Template syntax

Raised while splitting a text template into literal text, `${{ }}` spans and
`${% %}` block tags — before any expression is parsed.

| Message | Cause | Fix |
|---|---|---|
| `Unterminated expression span` | `${{` with no closing `}}`; a `}}` inside a string literal or an open `{ … }` does not count | Close the span, the string and the braces |
| `Unterminated block tag` | `${%` with no closing `%}` | Close the tag |
| `Empty block tag` | `${% %}` | Write a tag name, or escape a literal `${%` as `$\{%` |
| `Unknown tag 'foo'` | Tag name other than `if`, `elif`, `else`, `endif`, `for`, `endfor` | Use a supported tag; logic beyond them belongs in an expression |
| `Unterminated 'if' block`, `Unterminated 'for' block` | No matching `${% endif %}` / `${% endfor %}` | Add the closing tag |
| `Unexpected 'endif' tag` (also `elif`, `else`, `endfor`) | A structural tag outside its block | Remove it or add the opening tag |
| `Expected an identifier for loop variable in 'for' tag` | `${% for 1 in y %}`, `${% for %}` | Name the loop variable |
| `Expected 'in' after loop variable in 'for' tag` | `${% for x of y %}`, `${% for in y %}` | `${% for x in y %}` |
| `Expected an iterable expression in 'for' tag` | `${% for x in %}` | Add the array expression |

#### Expression syntax

Raised by the parser; `location` points at the offending token.

| Message | Cause | Fix |
|---|---|---|
| `Unexpected token ')'` | Stray or unmatched token | Fix the syntax at the reported column |
| `Unexpected character '@'` | A character outside the grammar: `@`, `#`, `;`, a backtick | Remove it; strings take `"` or `'` |
| `Unterminated string literal` | A string with no closing quote | Close the string |
| `Hexadecimal, binary and octal number literals are not supported; write the decimal number` | `0x10`, `0b101`, `0o7` | Write the decimal number |
| `Number literal is too large` | A literal that overflows to Infinity (more than about 308 digits) | Use a smaller number |
| `Unexpected end of expression` | Expression stops mid-way: `a +`, `x ==` | Complete the expression |
| `Unterminated object literal` | A `{` with no matching `}`: `{ id: 1` | Close the brace |
| `Unterminated array literal`, `Unterminated argument list` | A missing `]` or `)`: `[1, 2`, `f(1, 2` | Close the bracket |
| `Empty parentheses '()' are only valid before '=>'` | `()` as a value | Write a value, or `() => …` for a function of no arguments |
| `Unary operator '-' cannot be the left operand of '**'; write (-a) ** b or -(a ** b)` (likewise `!` and `not`) | `-2 ** 2`, `!a ** b` | Write `(-2) ** 2` or `-(2 ** 2)` |
| `Expected In, got ''` | A ternary as the last `let` binding swallowed the `in` | Parenthesize the ternary |
| `&& and \|\| cannot be mixed with ?? without parentheses`, `?? cannot be mixed with && or \|\| without parentheses` | `a ?? b \|\| c`, `a && b ?? c` | Parenthesize: `(a ?? b) \|\| c` |
| `Access to reserved name 'constructor' is not allowed` | A prototype name as a property, arrow parameter or `let` name — also from `path()` at runtime | Rename the key; see [Grammar Restrictions](security.md#grammar-restrictions) |
| `Arrow function parameter must be a plain identifier` | A lambda as the last ternary branch: `c ? 1 : x => x` parses `(c ? 1 : x) => x` | Parenthesize the lambda: `c ? 1 : (x => x)` |
| `Unexpected token 'contains'` | Liquid's `contains` operator | `"a" in tags`, `includes(str, sub)` |
| `Only named functions can be called directly` | Calling an expression result: `(f)(2)`, `x.y()(1)` | Call a built-in or registered function by name |

#### Evaluation

| Message | Cause | Fix |
|---|---|---|
| `` `a.b` is null, cannot read `c` `` | `.c` on a missing value — the most common runtime error; the message names the path that is `null` (`Value is null, cannot read …` when the receiver is not a plain path such as `a.b`) | `?.` on each step that may be null — see [Null and Error Propagation](language.md#null-and-error-propagation) |
| `` `a.b` is null, cannot read an index `` | `[i]` on a missing value | `?.[i]` |
| `Unknown name 'custmer'; did you mean 'customer'?` | Strict mode only: a name that is not in the context or in scope; the suggestion is the nearest known name | Fix the spelling, or pass the name as `null` when it is optional — see [Strict mode](language.md#strict-mode) |
| `` `user` has no property 'nmae'; did you mean 'name'? `` | Strict mode only: a field the object does not have, or a property of a type that has none | Fix the spelling; for an optional field write `user.nmae ?? default` |
| `` `items` has no property 'length'; use size(items) to count `` | Strict mode only: `.length`, `.len` or `.count` on an array or a string | `size(items)` |
| `Division by zero; set divisionByZero to "infinity" to allow it`, `Modulo by zero; set divisionByZero to "infinity" to allow it` | `/` or `%` with a zero right side while `divisionByZero` is `"error"` (the strict default) | Guard the divisor, or set `divisionByZero: "infinity"` |
| `Cannot index into number` (or `string`, `boolean`) | Indexing a scalar | Check the data shape |
| `Object key must be a string or number, got null` | The *key* is `null` — `index[id]` with `id` null | Coalesce the key: `index[id ?? 0]` |
| `Array index must be a number, got string` | `arr["a"]` | Index arrays by number; look up objects with `find` / `keyBy` |
| `Unknown function 'f'`, `Unknown function 'f'; did you mean 'g'?` | Not a built-in and not registered; also a `let`-bound lambda in call position, or a dotted `a.b(...)` nobody registered | Check the spelling against [Built-in Functions](builtins.md#built-in-functions); pass a local lambda to a higher-order built-in instead of calling it |
| `Expected a function value, got null` (or another type) | A higher-order built-in got a value instead of a lambda: `map(x.id)` | Write the arrow: `map(x => x.id)` |
| `Operator '-' requires numbers, got string and number` (also `*`, `/`, `%`, `**`) | Arithmetic across types | Convert with `num()` / `parseInteger()` |
| `Operator '<' requires two numbers or two strings, got number and string` (also `>`, `<=`, `>=`) | Ordering a mixed pair | Convert one side: `num(x) < 3` |
| `Operator '>' cannot compare instant and plaindate; convert one to the other's type (toInstant, toPlainDate)` | Ordering two date values of different kinds | Convert both to one type first |
| `Operator '+' requires two numbers or two strings, got string and object` | `+` with an array or object operand | Serialise with `json()`, or use `concat` for arrays |
| `Unary minus requires a number, got string` | `-x` on a non-number | Convert first |
| `'in' right-hand side must be an array or string, got null` | `x in null` | `x in (list ?? [])` |
| `'in' with a string right-hand side requires a string left-hand side, got number` | `1 in "abc"` | `str(1) in "abc"` |
| `Function values cannot be stored inside array literals`, `Function values cannot be stored inside object literals` | A lambda placed in `[…]` or `{…}` | Bind it with `let` and pass it on |
| `Resolver values cannot be stored inside array literals`, `Resolver values cannot be stored inside object literals` | A `Resolver` from the context placed in `[…]` or `{…}` | Read the value you need from it: `[users.alice]` |
| `Resolver key must be a string or number, got null` | `resolver[k]` with a non-scalar `k` | Coalesce the key |
| `Async filter used as a function value — use engine.evaluate() for async support` | An async filter passed by name to a higher-order built-in on the synchronous path | Put a `Resolver` in the context, or make the filter synchronous |
| `Function values cannot be used as a top-level expression result` | A span renders a lambda | Call a higher-order built-in with it |

#### Built-in arguments

Every built-in validates its input and names itself in the message.

| Message | Cause | Fix |
|---|---|---|
| `map() requires an array, got null` (also `join`, `keys`, `first`, …) | A collection built-in given `null` — only `size(null)` returns `0` | Guard the input: `(list ?? []) \| map(…)` |
| `append() requires a string, got array` (also `includes`) | A string-only built-in given an array | Arrays: `concat(arr, [item])`, `x in arr` |
| `toFixed() requires a number, got string` | Wrong argument type | Convert with `num()` first |
| `str() cannot convert array — use json(v) to serialise` (also `object`, `NaN`, `Infinity`) | `str()` on a non-scalar | `json(v)` |
| `num() cannot convert "abc" to a number` | Not a finite number | Validate the input; `parseFloat` / `parseInteger` for lenient parsing |
| `parseInteger() cannot parse "a" as an integer` | Not an integer string | Validate the input |
| `Invalid Instant string: "…"`, `Invalid PlainDate string: "…"`, `Invalid Duration string: "…"` | Not ISO 8601 | Fix the string, or use `parsePlainDate(str, format)` |
| `Cannot convert to Instant: "…"`, `Cannot convert to PlainDate: "…"`, `Cannot convert to PlainTime: "…"` | `toInstant` / `toPlainDate` / `toPlainTime` given an unparsable string | Fix the string |
| `Invalid timezone: "…"` | Not an IANA zone name | `"Europe/Berlin"`, `"UTC"` |
| `Invalid duration object`, `duration field "days" must be a number, got string` | A duration literal with an unknown or non-numeric field | Fields: `years` … `milliseconds`, numbers only |
| `Expected a Duration or duration-like object, got string` | `add` / `subtract` given something other than a duration | `add(d, { days: 1 })` |
| `Cannot parse "…" with format "…"` | Input does not match the pattern | Fix the value or the pattern |
| `format() requires an Instant, PlainDate, PlainTime, PlainDateTime, or ZonedDateTime` | `format` on a string | Convert first: `toInstant(v) \| format(…)` |
| `Invalid regular expression: …` | A pattern the regex engine cannot compile (RE2 syntax by default; in native mode, one `safe-regex2` accepts and `RegExp` rejects) | Fix the pattern syntax |
| `` `f()` pattern uses a lookahead / a backreference, which the linear regex engine does not support; set regex: 'native' on the engine `` | `matches` / `capture` / `captures` with `(?=…)`, `(?!…)`, `\1` or `\k<n>` | Rewrite the pattern, or derive an engine with `regex: "native"` |
| `` `f()` pattern uses a lookbehind, which the linear regex engine does not support and the native engine refuses `` | `(?<=…)` or `(?<!…)` in a pattern | Rewrite the pattern; no mode runs a lookbehind |
| `Potentially unsafe regular expression: …` | Native mode only: a pattern that does not parse, or risks exponential backtracking (`(a+)+`, `(a\|aa)+`, a backreference inside a repeated group) | Fix the syntax; remove nested unbounded quantifiers and alternation inside repeated groups |

#### Context

Raised when an expression reads, by name, field or index, a value from the data context that Tavnit cannot read.
The message names the path of the read, for example: Context value `user.cb` is a function; …. A value the expression never reaches is not looked at.

| Message | Cause | Fix |
|---|---|---|
| `is a function; Tavnit does not call functions from data (register a filter instead)` | A function in the context | Register it as a filter, or pass its result |
| `is a BigInt; convert it to a number or a string` | A `BigInt` in the context | `Number(v)` or `String(v)` |
| `is a symbol` | A symbol in the context | Remove it |
| `is an invalid Date` | A `Date` whose time is `NaN` | Pass a valid `Date` or an ISO string |
| `Cannot serialise a value that contains a cycle; a context must be a tree` | A cycle in the context, met when `json()` or a render serialises it (reading `a.self.name` works) | Break the cycle, or pass the fields needed |
| `is a Map; convert it with Object.fromEntries()`, `is a Set; convert it with Array.from()` | A `Map` or a `Set` | Convert it |
| `is a Promise; await it before the call, or pass a resolve() root` | A pending `Promise` | Await it, or use `resolve()` |
| `is an instance of Foo; pass a plain object, array, string, number, boolean, null or Date` | A `RegExp`, an `Error`, a binary buffer, and, in [strict mode](language.md#strict-mode) only, an instance of any other named class | Pass `{ ...instance }` or the fields needed |

In lenient mode (`strict: false`) an instance of the host's own class is read through its own properties, as before; the default strict mode refuses it. An instance of an anonymous class is plain data, so `process.env` passes. A valid `Date` is not an error: the engine converts it to an instant, so `format(d, "…")` and the date
arithmetic work on it. A plain object, an array, a string, a number, a boolean, `null` and `undefined` pass
unchanged; `NaN` and `Infinity` stay numbers. The check happens on every read, so a context changed after a call is seen; a
`Date` inside a list is converted when it is read by index or by a lambda parameter, not when the whole list is handed to a built-in.

#### Value templates

Raised while compiling or evaluating a YAML/JSON tree; `path` names the node.

| Message | Cause | Fix |
|---|---|---|
| `Object spread requires a plain object, got number` | `"...": ${{ expr }}` returned a non-object | Return an object, or `null` to merge nothing |
| `Array spread requires an array, got object` | `- ...: ${{ expr }}` returned a non-array | Wrap one item as `[item]` |
| `$if / $unless must be a boolean literal or a single expression span` | `$if: yes`, or text around the span | `$if: ${{ cond }}` |
| `` block tags are not supported inside a `_` body `` | `${% %}` inside a `_:` subtree | Use `$if` guards in the subtree |
| `` `$_` must be the only key in its mapping, got: … `` | Extra keys next to a `$_` value | Move them into the value tree |
| `` `$_` must be the only sibling of its `_` body, got: … `` | Extra keys next to a `$_` / `_:` pair | Move them into the `_` body |
| `` `$_` must be a single expression span that references `_` `` | A `$_` / `_:` host does not use `_` | Reference `_` in the host expression |
| `` a "..." host with a `_` body is not supported — use `$_` `` | Spread and hole on one node | Use `$_` |
| `` … has no sibling expression span that references `_` `` | A `_:` body nothing uses | Reference `_` from a sibling span, or remove the body |

#### Limits

| Message | Cause | Fix |
|---|---|---|
| `Recursion depth limit 50 exceeded; raise maxDepth` | Expression nesting deeper than `maxDepth` | Flatten the expression; raise `maxDepth` only for legitimate nesting |
| `Iteration limit 1000000 exceeded; raise maxIterations` | Collection built-ins and `${% for %}` loops together processed more than `maxIterations` items in one engine call | Filter earlier in the chain, or raise `maxIterations` — see [Runtime Limits](security.md#runtime-limits) |
| `Step limit 10000000 exceeded; raise maxSteps` | One engine call visited more than `maxSteps` expression nodes | Simplify the expression, or raise `maxSteps` |
| `The 'for' iterable must be an array` | `${% for x in expr %}` where `expr` is not an array | `(expr ?? [])`, or `keys(obj)` / `values(obj)` for an object |
| `Output size limit of 1048576 bytes exceeded; raise maxOutputBytes` | One render produced more than `maxOutputBytes` | Raise `maxOutputBytes`, or render less |
| `Expression nested deeper than 500 levels` | The parser met more than 500 nested levels, or a chain (`1+1+…`, `\| f \| f …`) that long; the limit is fixed | Split the expression; use a collection built-in instead of a long chain |
| `Expression or data nested too deeply` | The JS stack ran out while walking deeply nested data | Flatten the data |
| `` `f()` result exceeds 10000000 characters; raise maxStringLength `` / `` `indent()` result exceeds 10000000 characters `` / `String result is too long` | A string built-in (`padStart`, `padEnd`, `indent`, `replace`, `replaceAll`, `append`, `join`, `joinFilled`) would produce more than `maxStringLength` (default 10 000 000) characters | Produce less text, or raise `maxStringLength` |
| `` `f()` subject is longer than 100000 characters `` | Native mode only: `matches` / `capture` / `captures` on a string over `maxRegexInput` (default 100 000) characters | Cut the subject first (`truncate`, `slice`), or raise `maxRegexInput` |
| `Evaluation timed out after 100 ms; raise timeoutMs` | `timeoutMs` is set, and an AST node was reached after it ran out | Raise or drop `timeoutMs` — see [Runtime Limits](security.md#runtime-limits) |

#### Engine setup

Raised by the host's own calls, not by an expression.

| Message | Cause | Fix |
|---|---|---|
| `Cannot register filter with reserved name 'constructor'` | A prototype name in `filters` | Rename the filter |
| `compile() requires an arrow expression at the top level (e.g. 'x => x.active')` | `compile()` given another expression | Pass an arrow |
| `Filter 'f' is async — use engine.evaluate() for async filter support` | An async filter on the synchronous path — no `Resolver` in the context, or inside a compiled lambda | Put a `Resolver` in the context, or make the filter synchronous |
| `Resolver requires async evaluation — use engine.evaluate()` (or `Resolver 'state' requires …` when the root is named) | A `Resolver` was read or returned by the low-level synchronous `evaluate()` | Evaluate through the engine |
| `Resolver 'state' requires async evaluation; evaluateSync() cannot wait for it, use evaluate()` (code `TAV_ASYNC_REQUIRED`) | `evaluateSync`, `renderSync` or `renderObjectSync` read a `Resolver` root | Use `evaluate`, `render` or `renderObject` (the message names it) |
| `Filter 'f' is async; evaluateSync() cannot wait for it, use evaluate()` (code `TAV_ASYNC_REQUIRED`) | The same methods called an async filter | Use the async method, or make the filter synchronous |
| `` `matches()` needs a regular-expression engine: pass regex: linearRegex (from '@tavnit-ts/tavnit/regex-linear') or regex: 'native' to createEngine `` (likewise `capture()` and `captures()`; code `TAV_USAGE`) | `regex: "linear"` on an engine from `@tavnit-ts/tavnit/core` that was given no engine object | Pass `regex: linearRegex`, or `regex: "native"` |
| `Temporal is not available: this runtime has none; call installTemporalPolyfill() from '@tavnit-ts/tavnit/temporal-polyfill' first` (code `TAV_USAGE`) | A date/time built-in, a comparison of date values or `deserialiseValue` ran on a runtime without `Temporal`, on an engine from `@tavnit-ts/tavnit/core` | Call `installTemporalPolyfill()` once at start-up, or run on a runtime with `Temporal` |

`secretRoots` replaces a matching top-level string value with `[redacted]` in
every message — see [Secret Values in Diagnostics](security.md#secret-values-in-diagnostics).

### Engine option errors

`createEngine()` and `derive()` throw a `RangeError` — not an `ExpressionError` — saying
`maxStringLength must be a positive finite integer, got 0` (likewise `maxRegexInput` and `maxSteps`) when the
value is not a positive integer.

### Lint findings

Lint findings are warnings, not `ExpressionError`s. `lintValueTemplate()` throws
`maxInlineObjectFields must be a non-negative integer` when configured with an
invalid threshold. `TAV001` is temporarily disabled; its retained message says `Inline object literal has N fields; move the value tree to a '_' / '$_' subtree.`
The same applies to `maxExpressionLength must be a non-negative integer`, `maxTernaryDepth must be a non-negative integer`
and `maxLambdas must be a non-negative integer`.

| Code | Finding | Fix |
|---|---|---|
| `TAV002` | Temporarily disabled. | Split into steps, a value tree or a lookup table |
| `TAV003` | Temporarily disabled. | `firstFilled()`, a lookup object or a `$if` guard |
| `TAV004` | Temporarily disabled. | Split into steps or a named host function |
| `TAV005` | Temporarily disabled. | `fixBlankIdiom()` remains available. |

### Type findings

A type checker, in `@tavnit-ts/tavnit/internal` (`checkExpression`, `checkTemplate`), reports an operation that
throws for a value a data contract permits. It is a tool API for hosts, not an engine option: it never runs
during evaluation. An error is an operation the contract proves can throw; a warning is one the contract does
not decide.

| Code | Severity | Message | Fix |
|---|---|---|---|
| `TAV101` | error | `'a.b' is optional: the key can be absent, and a plain read of an absent key throws.` | `x?.key`, or `x.key ?? default` for a read that no further `.` follows |
| `TAV102` | error | `'a.b' can be null, so reading 'c' can throw.` | `x?.key` |
| `TAV103` | error | `Unknown name 'x'.` (closed environment only) | Declare the name |
| `TAV104` | error | `'a' has no property 'b'; the key is never present.` | Fix the name |
| `TAV105` | warning | `'a' does not declare 'b', so the contract does not say whether it is there.` (an open object that declares no property at all is free-form and reports nothing) | `x?.key ?? default` |
| `TAV106` | error | `trim() rejects null, and 'a' can be null.` | `x ?? default` |
| `TAV107` | error | `'a' is a string and has no property 'b'.` (a union with an object member reports nothing: a `type()` test tells the members apart) | `size(x)` for a length |
| `TAV108` | error | `The subscript 'k' can be null, and a null key throws.` | `index[id ?? ""]` |
| `TAV109` | warning | `'a.b' is not declared required, so the contract does not say whether the key is there.` | `x?.key` |
| `TAV201` | warning | `'a.b' is string and is never null, so the '??' fallback is never taken.` | Drop the `?? …` |
| `TAV202` | warning | `'a' is always null, so '??' always takes the right side.` | Drop the left side |
| `TAV203` | warning | `'a' is string and is never null, so this comparison is always true.` (also `always null`, `always false`) | Drop the test |
| `TAV204` | warning | `'a' is { … }[], which is always truthy, even when empty, so this condition never varies.` (an array or object is truthy empty; `null` is never) | `size(a) > 0` for an array |
| `TAV205` | warning | `'a' is a schema type that excludes the compared literal, so this comparison has a fixed result.` | Correct the comparison or schema |

`TAV201`–`TAV205` are the redundancy findings: a test or fallback the types already decide. They are off unless the
`TypeEnvironment` sets `redundancy: true`, and a read that already raised a finding raises none of them.

### Silent Failures

These produce a wrong result and no error.

| Symptom | Cause | Fix |
|---|---|---|
| The value is the string `"$"` | A span inside a YAML flow collection `{ … }` / `[ … ]` | Block mappings — see [Never put a span in a flow collection](embedding.md#never-put-a-span-in-a-flow-collection) |
| A key holds a nested mapping instead of the value | Unquoted `: ` inside the scalar, e.g. a ternary with `: null` | Quote the scalar — see [YAML Quoting Rules](embedding.md#yaml-quoting-rules) |
| A condition is always false | A name missing from the context reads as `null`: Liquid's `empty`, `nil`; a typo reads the same | `size(v) == 0`, `null`; create the engine with `strict: true` to turn a typo into an error |
| `${{ typo }}` renders as an empty string | A name or field that is not there reads as `null` when the engine is created with `strict: false` | Leave `strict` at its default, `true` — see [Strict mode](language.md#strict-mode) |
| `a.length` is `null` | An array or a string has no properties; `strict: false` reads any property of it as `null` | `size(a)` |
| A key is missing from the output | Its span evaluated to `null`, which omits the key | Coalesce if the key must stay: `${{ v ?? "" }}` |
| `{{ x }}` appears verbatim | `{{ }}` without `$` is literal text | `${{ x }}` |
| `[1] == [1]` is `false` | Arrays and objects compare by identity; date values compare by value | Compare fields, or `json(a) == json(b)` |
| A date comparison with `==` is `false` | `==` between different date types, or a date and a string | Convert both to one type |

### Parser Quirks

A **ternary as the last binding** of a `let` (immediately followed by
`in`) swallows the `in` — parenthesize it:

```
${{ let k = c.a ? "x" : "y" in { k: k } }}        # ERR: Expected In, got ''
${{ let k = (c.a ? "x" : "y") in { k: k } }}      # OK
```
