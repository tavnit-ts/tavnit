## Values and Types

<!-- contents -->
**Contents**

- [Lexical Structure](#lexical-structure)
- [Literals](#literals)
- [Truthiness](#truthiness)
- [Property Access and Optional Chaining](#property-access-and-optional-chaining)
- [Null and Error Propagation](#null-and-error-propagation)
- [Strict mode](#strict-mode)
- [Function Values](#function-values)
- [Precedence Table](#precedence-table)
- [Arithmetic and String `+`](#arithmetic-and-string-)
- [Keyword Aliases](#keyword-aliases)
- [Function Calls and Pipe](#function-calls-and-pipe)
- [Arithmetic](#arithmetic)
- [Comparison](#comparison)
- [Logical and Nullish Coalescing](#logical-and-nullish-coalescing)
- [Membership (`in`)](#membership-in)
- [Ternary](#ternary)
- [Unary NOT](#unary-not)
- [Arrow Functions](#arrow-functions)
- [`let … in` Binding](#let--in-binding)
<!-- /contents -->

### Lexical Structure

**Strings** — double-quoted or single-quoted. Supported escape sequences:

| Sequence | Meaning |
|---|---|
| `\\` | backslash |
| `\"` | double quote (in double-quoted strings) |
| `\'` | single quote (in single-quoted strings) |
| `\n` | newline |
| `\t` | horizontal tab |
| `\r` | carriage return |

Multiline string literals are not supported.

**Numbers** — integer or floating-point decimal, with an optional exponent. A leading dot
(`.5`) and `_` between digits (`1_000_000`) are accepted:

```
42      -7      3.14      -0.5      .5      1e3      1.5e-3      2E+6      1_000_000
```

`.5` is a number only where a value can start: `a.5` is still a property access error.
Hexadecimal, octal, and binary literals (`0x10`) are not supported and raise a parse error;
write the decimal number. A literal that overflows (`1e999`) is the parse error
`Number literal is too large`.

Every number is an IEEE 754 double, as in JavaScript: integers are exact up to
2^53 (`9007199254740991`); above that, precision is lost silently — `9007199254740993`
reads as `9007199254740992`. There is no `BigInt` type. An identifier that does not
fit in 2^53 travels as a string.

**Identifiers** — start with a BMP Unicode letter or `_`, followed by any combination of
BMP Unicode letters, digits, or `_`. Identifiers are case-sensitive. The following words
are reserved and cannot be used as identifiers: `true`, `false`, `null`,
`and`, `or`, `not`, `in`, `let`.

**Whitespace** — spaces and tabs between tokens are insignificant.

### Literals

```
"string"            'single-quoted string'
42                  3.14
true                false
null
[1, 2, 3]           // array literal
{ key: value }      // object literal — keys are bare identifiers or quoted strings
{ "key": value }    // quoted form — identical meaning
```

Array and object literals may contain arbitrary expressions as elements or
values.

### Truthiness

Tavnit uses JavaScript truthiness throughout:

| Value | Truthiness |
|---|---|
| `null` | falsy |
| `false` | falsy |
| `0`, `0.0`, `NaN`, `""` | falsy |
| Everything else | truthy (including `[]` and `{}`) |

```tavnit
count || 200      // falls back to 200 when count is null, 0, or ""
count ?? 200      // falls back only on null; preserves 0 and false
enabled ?? true
```

### Property Access and Optional Chaining

```tavnit
user.id                              // dot notation — static path
order.customer.name
user?.contact?.email ?? "unknown"    // `?.` per step — one guard covers one access
record[fieldName]                    // bracket notation — dynamic key
record["id"]                         // bracket with literal key (same as dot)
```

Dot and bracket notation can be mixed freely. Optional chaining applies to
both: `record?.[fieldName]`.

`?.` guards **one access — it does not short-circuit the rest of the chain** the
way JavaScript does. `a?.b` yields `null` when `a` is null, and the
next `.c` then throws on that `null`:

```tavnit
user?.address?.city        // null when either receiver is null
user?.address.city         // throws when address is null — one guard is not enough
(items | first)?.id ?? 0   // guard the pipe result, then coalesce it
```

So once a step can yield `null`, every step after it needs its own `?.` — or a
`??` before the next `.` to stop the chain there. A leading `!= null &&` guard
works too, because `&&` / `||` (and `and` / `or`) do short-circuit:

```tavnit
state.tracker?.count ?? 0                        // ?. then coalesce
state.tracker != null && state.tracker.count > 0 // boolean test — `&&` short-circuits
```

`?.` also works on the result of a parenthesised pipe expression. When a pipe
chain may return `null` (e.g. `first`, `last`, `find`), wrap it in parentheses
and chain `?.`:

```tavnit
(items | first)?.id                                         // null if items is empty
(items | find(x => x.status == "failed"))?.message ?? "none"
(results | last)?.date ?? '?'
```

The parentheses are optional — `items | first?.id` parses as `(items | first)?.id`
too. They are still worth writing when the chain continues with another pipe step.

### Null and Error Propagation

`null` is the one absent value: a name missing from the context reads as `null` (an error in
[strict mode](#strict-mode)), and so does an `undefined` the host supplies — a context value or a filter result.

**Property access on null** — accessing `.prop` or `[key]` on a
`null` value throws an evaluation error. Optional chaining turns
that one access into `null` instead:

```tavnit
user?.address?.city    // null when either receiver is null
user.address.city      // throws if user or address is null
```

**A null key is a different error.** `?.` guards the receiver, not the subscript:
`index[key]` with a null `key` throws `Object key must be a string or number, got
null`, and `?.[key]` does not help because the receiver is fine. Coalesce the key itself to a value that cannot be a real one:

```tavnit
index[id ?? 0]?.name ?? ""     // id may be null — a missing key yields null
index?.[id]                    // does NOT help: the key, not the receiver, is null
```

This bites exactly where indexes are most useful — looking a record up by a
foreign key that an external payload leaves empty.

Use `?.` where the receiver can genuinely be null — a value the host
may omit, a `find` / `first` / `last` result, an optional field of an external
payload. It is not needed where the expression already guarantees the receiver:
an object or array literal, a `let`-bound value, a value the caller's contract
makes obligatory. The engine cannot tell these apart — the guarantee comes from
the data contract, not from the expression, and an unnecessary `?.` costs
nothing but hides which contract the expression is relying on.

The guarantee holds **per step**, so it decides each `.` in a path separately:
`a.b.c` needs no `?.` when the contract makes `a.b` obligatory and non-null, and
needs one at `b` and again at `c` when either can be null. A contract that
describes nested objects or array elements supplies the guarantee at every depth
it covers:

```tavnit
order.customer.name          // contract: customer is obligatory, non-null
order.customer?.name ?? ""   // contract: customer may be absent
rows | map(r => r.id)        // contract: every element has a non-null id
```

**Absent keys** — in lenient mode (`strict: false`), and on the left side of `??` or in the receiver
chain of `?.` in strict mode, a key missing from an object reads as `null`; that alone is
not an error, but the next `.` on the `null` throws. A plain `.` in strict mode, the default, throws at the
absent key itself (see [Strict mode](#strict-mode)). This holds at every level,
including a top-level name the host did not provide at all:

```tavnit
totals?.count ?? 0    // safe even if host omits totals entirely
totals.count          // throws at `.count` — `totals` itself is null
state.tracker.count   // throws at `.count` — the absent `tracker` is null
```

**Coming from LiquidJS** — LiquidJS returned `nil` silently for any depth of
member access on a nil value: `nil.foo.bar → nil`. Tavnit throws at the first
nil step and does not short-circuit, so a chain that may traverse a not-yet-set
key needs `?.` on every step from that key to the end:

```tavnit
state.tracker?.count | default(0)   // safe: tracker may not be written yet
secret.credentials?.apiKey          // safe: credentials may not exist
```

**Unregistered functions** — calling a function name that is neither a built-in
nor a registered custom filter throws immediately.

**Built-in type errors** — built-in functions throw a descriptive error if
given an incompatible argument type (e.g. `size(42)`).

**Arithmetic edge cases** — a zero divisor is an error with code `TAV_DIVISION_BY_ZERO` by
default (`divisionByZero: "error"`, which [strict mode](#strict-mode) implies). The engine option
`divisionByZero: "infinity"` (also the default of `strict: false`) keeps the JavaScript result:
`n / 0` → `Infinity`, `0 / 0` → `NaN`.
Hosts must validate numeric inputs if `Infinity` and `NaN` are problematic for downstream consumers.

**Runtime limit errors** — exceeding `maxDepth`, `maxIterations`, `maxSteps` or an opt-in
`timeoutMs` (see [Runtime Limits](security.md#runtime-limits)) throws a runtime limit
error that propagates to the host's `evaluate` call as a thrown exception. Every error has a
stable `code`; see [Error codes](errors.md#error-codes).

### Strict mode

By default Tavnit is strict: a name that is not in the context, a field the object does not have,
and any property of an array, a string or a number are errors with a suggestion of the nearest
known name, and a division by zero is an error (unless `divisionByZero` says otherwise). The engine
option `strict: false` is the lenient reading: all three read as `null`, so a typo renders as an
empty string and `items.length` is `null`.

```typescript
const engine = createEngine(); // strict: true
await engine.evaluate("custmer.name", { customer: { name: "Ann" } });
// ExpressionError: Unknown name 'custmer'; did you mean 'customer'?
await engine.evaluate("customer.nmae", { customer: { name: "Ann" } });
// ExpressionError: `customer` has no property 'nmae'; did you mean 'name'?
await engine.evaluate("items.length", { items: [1, 2] });
// ExpressionError: `items` has no property 'length'; use size(items) to count
```

Strict mode does not change these rules:

- A name present in the context with the value `null` is known: `{ nickname: null }` reads as `null` without error.
  Pass `null` for an optional name.
- The left side of `??` names its default, so `nickname ?? "none"`, `user.nickname ?? "none"` and
  `index[key] ?? 0` read a missing name or key as `null` even in strict mode. The same holds for a chain
  on that left side. `?.` makes the access optional: a `null` receiver, an absent name (`nobody?.name`) and a key the object does not have (`user?.nmae`) all read as `null`, as in JavaScript. Any other value behind `?.` (an array, a string, a number, a boolean) reads as `null` too, so `items?.length` is `null`; only a plain `.` keeps the `size(items)` hint. A plain `.` stays strict.
- An array index out of range (`items[5]`) is `null`: the length of the data is not part of the template's shape.
- A `null` receiver still raises its own error, `` `a.b` is null, cannot read `c` ``, in both modes.

`engine.derive({ strict: false })` returns a lenient child; `derive()` without the option inherits
the parent's mode. Strict is the default; `createEngine({ strict: false })` keeps the old lenient reading.

**Date values in the context** — a valid JavaScript `Date` in the data context is converted to an
instant (the type `now()` returns), so `d | format("yyyy-MM-dd")` and the date arithmetic work on it and
`${{ d }}` renders its ISO 8601 string. An invalid `Date`, a function, a `BigInt`, a `Map`, a `Set`, a `Promise`, a `RegExp`, an `Error` and a
binary buffer are rejected with `TAV_CONTEXT`, as is an instance of any other named class in strict mode; so is serialising a cycle — see [Context](errors.md#context).

### Function Values

Arrow expressions create **function values** — a distinct Tavnit type. Function
values can be passed to higher-order built-ins and bound to names with `let`.
They cannot appear at the top level of a `${{ }}` embedding (a type error), and
cannot be stored inside array or object literals.

```tavnit
// Passed directly as arguments to higher-order built-ins
items | reduce((acc, x) => acc + x.price, 0)

// Bound with let, reused in the same expression
let eligible = x => x.active && x.balance > 0
in some(plans, eligible) && !every(plans, eligible)
```

Function values close over data-context identifiers and `let`-bound names in
scope at the point the lambda is created. Closures are read-only — nothing
inside a lambda body can mutate captured values.

Data-context values are **not** callable. Only registered built-ins and custom
filters may appear in call position — a `let`-bound function value has to be
passed to a higher-order builtin (`map(f)`, `filter(f)`), and a data-context
value is never callable, even one that carries a function.

Which names are registered is the host's decision, and it is not always visible
from the expression: beyond the built-ins, a host adds functions of its own, so
`commentCard(row)` may be a host function rather than a built-in. A name that is
neither throws `Unknown function 'name'` at evaluation time.

Arrow syntax is described in [Arrow Functions](#arrow-functions). Date types
are described in [Date and Time](datetime.md#date-and-time).

---

## Operators

### Precedence Table

Listed from highest to lowest. Operators on the same row have equal precedence.

| Level | Operator(s) | Description | Assoc. |
|---|---|---|---|
| 1 | `(expr)` | Grouping | — |
| 2 | `.` `?.` `[key]` `?.[key]` | Property / index access | left |
| 3 | `fn(args)` | Function call | left |
| 4 | `!` `not` `-` | Unary NOT, unary minus | prefix |
| 4a | `**` | Exponentiation | right |
| 5 | `*` `/` `%` | Multiplicative | left |
| 6 | `+` `-` | Additive | left |
| 7 | `<` `>` `<=` `>=` | Relational | left |
| 8 | `==` `!=` | Equality | left |
| 9 | `in` | Membership | left |
| 10 | `&&` `and` | Logical AND | left |
| 11 | `\|\|` `or` | Logical OR | left |
| 12 | `??` | Nullish coalescing | left |
| 13 | `? :` | Ternary | right |
| 14 | `\|` | Pipe | left |
| 15 | `=>` | Arrow function | right |
| 16 | `let … in` | Local binding | — |

As in JavaScript, a unary operator (`-`, `!`, `not`) directly before `**` is a parse error:
`-2 ** 2` fails with `Unary operator '-' cannot be the left operand of '**'`. Write `(-2) ** 2`
(`4`) or `-(2 ** 2)` (`-4`). The right operand may carry a sign: `2 ** -1` is `0.5`.
`2 ** 3 ** 2` is `2 ** (3 ** 2)`, which is `512`; `-a * b` is `(-a) * b`.

`??` cannot be mixed with `||` or `&&` without parentheses — this matches
JavaScript. The parser rejects the combination.

`let … in` has the lowest precedence of all: the body after `in` extends as
far right as possible. Arrow (`=>`) is next lowest: the body captures
everything to its right, including pipe steps. Pipe (`|`) is next: the entire
left-hand expression is passed to the right-hand filter.

> **Precedence and reach:** In a Pratt parser, a *lower* precedence level means
> an operator's operand extends *further* to the right — it consumes more of the
> expression, not less. This is the opposite of the usual intuition ("lower
> precedence = evaluated last = outer wrapper"). For prefix/continuation operators
> like `=>` and `let … in`, a lower level simply means the right-hand body keeps
> consuming tokens until it hits something of equally low or lower precedence.
> Concretely: `x => x.price | round(2)` parses as
> `x => (x.price | round(2))`, not `(x => x.price) | round(2)`,
> because `=>` (level 15) is lower than `|` (level 14) and therefore its body
> absorbs the trailing pipe step.

**Pipe vs. arithmetic / comparison — no parentheses needed.** Pipe (`|`, level 14)
is the lowest-precedence *infix* operator, but a pipe step consumes only the
filter name and its argument list. Operators written **after** the pipe belong to
the surrounding expression and are evaluated on the pipe's result:

```tavnit
// parses as: ((now() | toEpochSeconds()) + expires_in) - 30
now() | toEpochSeconds() + expires_in - 30

// parses as: (now() | toEpochSeconds()) < threshold
now() | toEpochSeconds() < threshold
```

Operators written **before** the pipe are part of the value the pipe receives —
that is the one shape to watch for:

```tavnit
// parses as: (-5 + 2) | abs()  => 3, not -3
-5 + 2 | abs()
```

The same holds for `??`: it is level 12, so `a ?? b | fn()` parses as
`(a ?? b) | fn()` — see the trap below.

**`??` vs pipe — a common trap.** `??` is level 12 (higher precedence than pipe at level 14), so `a ?? b | fn()` parses as `(a ?? b) | fn()`, not `a ?? (b | fn())`. This bites the "optional arg, fall back to computed default" pattern:

```tavnit
// WRONG — parses as: (args.date ?? today()) | format("yyyy-MM-dd")
// When args.date is a string, format() receives a string and throws.
args.date ?? today() | format("yyyy-MM-dd")

// Correct — use function-call form to avoid the pipe entirely
args.date ?? format(today(), "yyyy-MM-dd")

// Also correct — explicit parentheses
args.date ?? (today() | format("yyyy-MM-dd"))
```

The safest fix for any `a ?? expr | filter()` pattern is to rewrite the right side
using function-call syntax instead of pipe.

### Arithmetic and String `+`

The `+` operator follows JavaScript semantics:

- **Both numbers** → numeric addition.
- **Either operand is a string** → the other primitive (`string`, `number`, `boolean`, `null`) is
  coerced to a string and the results are concatenated. Arrays and objects still throw.

```tavnit
"item-" + count             // "item-3" — number coerced to string
count + "-item"             // "3-item"
price + tax                 // 28.5 — both numbers, numeric addition
"flag: " + true             // "flag: true"
str(count)                  // still works — explicit coercion remains valid
```

Arrays and object values are not coerced — mixing a string with an array or object throws
`"Operator '+' requires two numbers or two strings"`.

### Keyword Aliases

Three word-form aliases are accepted alongside their symbolic counterparts,
with identical precedence and semantics:

| Symbolic | Keyword |
|---|---|
| `&&` | `and` |
| `\|\|` | `or` |
| `!expr` | `not expr` |

```tavnit
active and not paused
a > 0 or b > 0
```

Keyword and symbolic forms may be mixed freely in the same expression.

### Function Calls and Pipe

**Function call syntax** — built-in and registered functions are invoked with
explicit parentheses. Calls may appear anywhere in an expression, including as
arguments to other functions:

```tavnit
json(payload)
size(items)
messages | filter(x => toInstant(x.date) > subtract(now(), { days: 3 }))
```

**Qualified names** — a filter registered under a dotted name is called by that
name, in the call form and in the pipe:

```tavnit
connection.get({ connectionId: id })     // not get(...) — that is the built-in
items | connection.list
```

A dotted callee is a *name*, not a method call on a value: it resolves in the
filter registry exactly as `get` would, and `a.b(1)` is an error unless
something registered `a.b`. Hosts use this to keep a name that a built-in
already owns reachable — `connection.get(...)` names the host's function while
`get(...)` stays the built-in.

**Pipe operator** — `|` is syntactic sugar for function application:

```
value | fn(arg1, arg2)    ≡    fn(value, arg1, arg2)
value | fn                ≡    fn(value)
```

```tavnit
// Pipe form
config.model | default("gpt-4.1")
config.debug | default("false") | bool()

// Equivalent function-call form
default(config.model, "gpt-4.1")
bool(default(config.debug, "false"))
```

Multi-step chains read left-to-right in execution order:

```tavnit
messages | concat(freshMessages) | uniqBy(x => x.chatId + "|" + x.id)
items | filter(x => x.status == "ok") | map(x => x.id) | join(",")
```

**Style guidance — prefer pipe when possible.** Pipe reads left-to-right and
matches execution order, making it easier to follow the data flow. Use
function-call syntax when:

1. **No subject to pipe from** (e.g. `now()`, `uuid()`)
2. **Value is a non-first argument** of the outer call
3. **The value itself is a compound expression the pipe would absorb** — `a + b | fn()` pipes `(a + b)`. Use function-call form when the arithmetic is meant to happen *after* the filter.

```tavnit
// Prefer pipe — pure transformation chains
args.name | toUpperCase
args.name | toUpperCase | truncate(80)
items | filter(x => x.active) | map(x => x.id) | join(",")

// Function-call required — no subject, or value is not the first argument
now()
uuid()
replace(tpl, "{name}", args.name | toUpperCase)   // piped value is the 3rd arg

// Both forms work — the operator applies to the pipe result
items | size == 0                       // == (items | size)
event.date | toInstant() > now()        // > (event.date | toInstant())
now() | toEpochSeconds() + expires_in   // + (now() | toEpochSeconds())
plan.startDate | toPlainDate() <= today()

// Function-call required — the operand would be absorbed into the pipe subject
toEpochSeconds(now()) + expires_in      // NOT: now() | (toEpochSeconds() + expires_in)
f(x) && g(y)                            // NOT: (x | f()) && y | g()
```

`x | f() && y | g()` genuinely differs: `&&` is lower than pipe, so it parses as
`((x | f()) && y) | g()`. Keep boolean combinations in function-call form.

Pipe survives parsing as a distinct `PipeNode`; the evaluator normalises it to a
function call at evaluation time.

### Arithmetic

`+`, `-`, `*`, `/`, `%`, `**` on numbers. No implicit string-to-number coercion.

`+` is the one arithmetic operator that coerces: with a string on either side it
concatenates (see [Arithmetic and String `+`](#arithmetic-and-string-)). Every other
operator throws on a non-number, so `"3" * 2` is an error where `"3" + 2` is `"32"`. Use
`num(v)` to convert first. `**` follows JavaScript for numbers: `2 ** 0.5` is the square
root, `0 ** -1` is `Infinity`.

`+` on two strings performs concatenation:

```tavnit
price * qty               // 30
firstName + " " + lastName    // "Jane Doe"
(a + b) * c
```

### Comparison

`==`, `!=`, `<`, `>`, `<=`, `>=`. `==` and `!=` use strict equality — no type
coercion. Date types (`Instant`, `PlainDate`) are compared using their natural
temporal ordering — see [Date and Time](datetime.md#date-and-time).

`<`, `>`, `<=` and `>=` take two numbers, two strings or two dates of one type. Strings
compare by UTF-16 code unit, as in JavaScript: `"a" < "b"` is `true`, `"10" < "9"` is
`true` (compare numbers, not digit strings, when the order is numeric), and ISO dates held
as strings (`"2026-01-05" < "2026-02-01"`) order correctly. For text in a language use
`sort({ locale })`. A mixed pair (`1 < "a"`) raises `Operator '<' requires two numbers or two strings`.

The exact rules of `==` and `!=`:

- Scalars compare by value and type: `1 == 1`, `"a" == "a"`, `null == null`; `1 == "1"` is
  `false`, `0 == false` is `false`, `0 == null` is `false`.
- `NaN == NaN` is `false`.
- Arrays and objects compare by **reference**, not by content: `[1] == [1]` is `false`,
  `{ a: 1 } == { a: 1 }` is `false`. Two reads of the same context value are the same
  reference, so `items == items` is `true`.
- Two dates of the same type compare by value.

For structural equality use [`deepEquals(a, b)`](builtins-types.md#structural-equality):
`deepEquals([1, { a: 2 }], [1, { a: 2 }])` is `true`. To test whether an array holds a
scalar, use `x in arr` ([Membership](#membership-in)); it compares as `==` does.

### Logical and Nullish Coalescing

`&&` / `and` — returns the first falsy value or the last value. Short-circuits.

`||` / `or` — returns the first truthy value or the last value. Short-circuits.

`??` — returns the left operand unless it is `null`, in which
case it returns the right. Falls back only on `null`, not on `0`,
`false`, or `""`:

```tavnit
limit ?? 200               // 0 is preserved; falls back only on null
enabled ?? true
label ?? name ?? "unknown"
```

`??` cannot be mixed with `&&` or `||` without parentheses.

### Membership (`in`)

Tests whether a value is present in a string or array. Left operand is the
value to search for; right operand is the string or array to search within:

```tavnit
"urgent" in tags
id in allowedIds
```

**`in` with a null right-hand side throws.** If the collection is a state or
context array that has not been written yet, it evaluates to `null`. `in null`
throws `'in' right-hand side must be an array or string, got null`.
Guard uninitialized arrays with `?? []`:

```
// LiquidJS — silently returns false when whitelist not yet set
state.whitelist.user_ids contains userId

// Tavnit — throws if user_ids is null; guard with ?? []
userId in (state.whitelist?.user_ids ?? [])
```

**A `null` left-hand side is safe.** `null in arr` returns `false` — the
needle is simply not present. No guard needed on the left side:

```tavnit
// No need to guard the needle
null in tags                       // false — safe
(user?.role ?? null) in roles      // fine — null is a valid needle
```

**An empty array is safe.** `value in []` returns `false` without throwing —
only a `null` right-hand side throws. The `?? []` guard is
needed only when the collection may be `null`, not when it may be empty:

```tavnit
// Unnecessary — size > 0 guard is not needed for `in`
!(args.id in (items != null && size(items) > 0 ? items : []))

// Correct — only guard against null
!(args.id in (items ?? []))
```

This is the most common migration surprise when porting `contains` conditions
that test membership in a collection stored in state.

### Ternary

`condition ? trueValue : falseValue`:

```tavnit
enabled ? "on" : "off"
timeout != null ? timeout : 30
count == 1 ? "item" : "items"
```

**Multi-branch mapping — use object lookup instead of nested ternaries.**
When mapping a value (typically a numeric or string code) to one of several
labels, nested ternaries become hard to read and fragile to extend:

```tavnit
// hard to read and error-prone to add a fourth case
status == 2 || status == 3 ? "inactive" : status == 4 ? "paused" : "ok"
```

The idiomatic alternative is an object-literal lookup by string key. This
reads as a table and adding a new case is a one-line edit:

```tavnit
// recommended — object lookup
({ "2": "inactive", "3": "inactive", "4": "paused" })[str(status)] ?? "ok"
```

`str(status)` converts the number to a string so it matches the literal keys.
The `?? "ok"` fallback handles any code not in the table.

### Unary NOT

`!value` and `not value` are equivalent:

```tavnit
!disabled
not disabled
!(a > 0 || b > 0)
```

### Arrow Functions

Arrow functions create function values (see [Function Values](#function-values)).
They are the usual way to produce one; a bare registered filter name is also a
function value (`map(ids, str)` calls `str` on every element).

**Syntax** — `param_spec => expr`:

| `param_spec` | Meaning |
|---|---|
| `x` | single parameter, no parentheses |
| `(x)` | single parameter, with parentheses |
| `(x, y)` | two parameters |
| `()` | zero parameters |

The body is a single expression. All operators, function calls, and pipe
chains are available inside the body:

```tavnit
x => x.active                              // field access
x => x.price * x.qty                       // arithmetic
(x) => x.active && x.balance > 0          // logical
(a, b) => a.score - b.score               // comparator
x => x.date | toInstant()                 // pipe inside body
```

**Precedence:** Arrow is level 15 — lower than pipe. The body captures as far
right as possible, including trailing `|` pipe steps:

```
x => x.price | round(2)   ≡   x => (x.price | round(2))
```

Parentheses are needed when a lambda is the **alternate** branch of a ternary
(`false ? 1 : x => x` fails to parse — write `false ? 1 : (x => x)`) or when
argument boundaries would otherwise be ambiguous. The consequent branch needs
none: `true ? x => x : 1` parses.

**Arity-based dispatch in `sort`:** when the second argument to `sort` is a
function value, the evaluator dispatches on its parameter count:

- **1 parameter** — key extractor: sort ascending by the returned value
- **2 parameters** — comparator: must return negative / zero / positive

```tavnit
items | sort(x => x.price)                      // ascending by price
items | sort(x => x.price) | reverse()           // descending
items | sort((a, b) => b.score - a.score)        // custom comparator
```

### `let … in` Binding

`let … in` names a subexpression once and makes it available inside the body.
It is the only way to avoid repeating a subexpression verbatim within a single
`${{ }}` span.

**Syntax:**

```
let name = expr in body
let name1 = e1, name2 = e2, … in body
```

Each binding is `name = expr`. Multiple bindings are comma-separated and are
evaluated sequentially — later bindings may reference earlier names. The body
is any Tavnit expression.

```tavnit
// name a predicate and use it twice without repeating it
let eligible = x => x.active && x.balance > 0
in some(plans, eligible) && !every(plans, eligible)

// name an intermediate value to avoid recomputing it
let subtotal = price * qty
in subtotal > 0 ? subtotal : 0

// multiple bindings — each may reference earlier ones
let base = price ?? 0, tax = base * 0.2
in base + tax
```

**Scoping** — each bound name is visible only within the `in` body (and within
subsequent bindings in the same `let`). A name is **not** in scope inside its
own binding expression, so self-referential or recursive definitions are
impossible.

**Immutability** — bound names cannot be reassigned. Nothing inside the body
can mutate a captured binding.

**Precedence** — `let … in` is level 16, the lowest in the table. The body
after `in` extends as far right as possible:

```
let x = a in b | fn   ≡   let x = a in (b | fn)
```

Reserved-name restrictions apply to bound names (see [Security](security.md#security)).

---
