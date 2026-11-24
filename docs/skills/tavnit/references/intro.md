# Tavnit — Expression Language User Guide

<!-- contents -->
**Contents**

- [Quick Start](#quick-start)
- [Concepts](#concepts)
- [Overview](#overview)
<!-- /contents -->

Tavnit is a _constrained expression evaluator_ with optional text-interpolation
embedding. It is not a general-purpose language: there are no statements and no
side effects. Expressions are a safe, constrained subset of
TypeScript expression syntax — operators, property access, function calls, and
arrow functions — evaluated against a data context supplied by the host
application and returning a single typed value. Control flow over templates is a
separate construct — see [Block Tags](block-tags.md#block-tags). Tavnit values map directly to
TypeScript types; the TypeScript API uses concrete types throughout.

---

## Quick Start

```bash
npm install @tavnit-ts/tavnit
```

For a bundle-size-sensitive host, see [Lean engines](typescript-api.md#lean-engines-and-built-in-selection).

```typescript
import { createEngine } from "@tavnit-ts/tavnit";

const engine = createEngine();

// Evaluate an expression — result type is preserved
const total = await engine.evaluate("price * qty", { price: 10, qty: 3 });
// => 30  (number)

// Render a template string containing ${{ }} spans — always returns string
const path = await engine.render("/orders/${{ id }}/details", { id: 42 });
// => "/orders/42/details"
```

Register custom filters at engine creation time:

```typescript
import { createEngine } from "@tavnit-ts/tavnit";
import type { Value } from "@tavnit-ts/tavnit";

const engine = createEngine({
  filters: {
    // callable as usd(v) or v | usd()
    usd: (v: Value): Value => `$${Number(v).toFixed(2)}`,

    // callable as truncate(v, n) or v | truncate(n)  — built-in, shown for illustration
  },
});

const label = await engine.render("Total: ${{ price | usd }}", { price: 19.9 });
// => "Total: $19.90"
```

See [TypeScript API](typescript-api.md#typescript-api) for engine configuration, filter
registration, engine derivation, and error handling.

---

## Concepts

A few terms used throughout this document.

**Expression** — A Tavnit expression is a syntactic unit enclosed in `${{ }}`.
It combines identifiers, operators, function calls, and literals to produce a
single typed value. Expressions have no side effects and no access to I/O.
Individual built-ins are not deterministic — `now()`, `uuid()`, and
`randomString()` read the clock or draw randomness — but no expression can
write to the host.

**Value** — The result of evaluating an expression. Tavnit values map directly
to TypeScript types: `string`, `number`, `boolean`, `null`, `Value[]` (array),
`{ [key: string]: Value }` (object), and the date types `Instant`, `PlainDate`,
`PlainTime`, `PlainDateTime`, and `Duration`. See [Exported Types](typescript-api.md#exported-types).

**Filter (function)** — A named callable registered with an engine. Built-in
filters cover common operations; custom filters extend the set with domain
logic. Filters are callable as `fn(value, args)` or via the pipe operator
`value | fn(args)`. See [Built-in Functions](builtins.md#built-in-functions) and
[Filter Registration](typescript-api.md#filter-registration).

**Template** — A string containing one or more `${{ expr }}` spans and/or
`${% if/for %}` block tags embedded in surrounding text. Rendering evaluates
each span and block, substitutes the results, and always returns `string`. See
[Embedding](embedding.md#embedding) and [Block Tags](block-tags.md#block-tags).

**Engine** — An isolated evaluator instance created with `createEngine()`. Each
engine has its own filter registry, resource limits, and compile cache.
Engines can be derived from a parent to inherit filters; `derive()` and
`createCache()` deliberately share one compile cache between engines. See
[Engine Instantiation and Isolation](typescript-api.md#engine-instantiation-and-isolation).

**Parse** — Converting a source expression string into a parsed form.
Happens once per unique expression string; subsequent evaluations of the same
string hit the cache. Parsing can be done explicitly with
`engine.parse()` for early syntax validation at load time. See
[Parse API](typescript-api.md#parse-api).

**Evaluate** — Walking the AST against a data context to produce a `Value`.
`engine.evaluate()` evaluates a bare expression; `engine.render()` evaluates
all `${{ }}` spans in a template string. See [Core Evaluation API](typescript-api.md#core-evaluation-api).

**Compile** — `engine.compile()` parses a Tavnit arrow expression string and
returns a `FilterFn` that can be registered as a named filter on a derived
engine. Enables writing filter logic in Tavnit rather than TypeScript. See
[Lambda Compilation](typescript-api.md#lambda-compilation).

---

## Overview

Tavnit expressions appear inside `${{ }}` delimiters embedded in text values.
They resolve identifiers from a host-supplied data context, apply operators and
registered filter functions, and return a value. The host controls what data is
in scope, what functions are registered, and what resource limits apply.

### Design Goals

| Goal | Rationale |
|---|---|
| TypeScript expression semantics | Expressions are a safe, constrained subset of TypeScript. Target authors already know TypeScript; LLMs have the highest TypeScript training coverage. No new mental model, no silent divergence between what you write and what evaluates. |
| Correct operator semantics | `&&` before `\|\|`, `0` and `false` are falsy, `??` works on null only, `!` works. No surprises. |
| Pipe operator as composition sugar | Left-to-right filter chains are readable and match execution order. |
| [Security](security.md#security) | No `eval`, no prototype access, no `Function`, no global object. Pure expressions with configurable resource limits. Safety is structural, not a runtime guard. |
| Extensible filter registry | Custom filters are first-class; the built-in set is minimal. |
| YAML-safe delimiter | `${{ }}` keeps `{{ }}` out of YAML's way in block context, with no quoting requirement beyond the usual `: ` rule. |

### Intentional Exclusions

- **Statements** — no `let`, `const`, or arbitrary control flow inside
  `${{ }}` expressions. `let … in` is supported for local bindings within a
  single expression. Conditional and loop structure belongs in `${% if %}`/
  `${% for %}` block tags at the template level, not inside an expression span.
- **Custom operators** — operators are fixed and match TypeScript. Extensibility
  is through registered filter functions, not syntax.
- **String interpolation inside expressions** — template strings
  (`` `Hello ${name}` ``) are not supported inside `${{ }}`. Text embedding
  uses the outer delimiter pattern only.
- **Rejected additions** — considered and not added, because Tavnit names follow
  TypeScript / JavaScript and the language stays small:
  - `upper`, `lower`, `take`, `skip`, `unique`, `capitalize` and `slugify` are not
    TypeScript names. Use `toUpperCase`, `toLowerCase`, `slice` and `uniqBy`; a host
    that wants `capitalize` or `slugify` registers its own filter.
  - Comments inside `${{ }}`, template strings and integer division `//` (use
    `floor(a / b)` or `round(a / b)`) stay out of the grammar (review finding F9).
  - Hexadecimal, binary and octal literals (`0x10`, `0b1`, `0o7`) raise a parse
    error (F27); `.5` and `1_000` are accepted.
  - Liquid names (`upcase`, `downcase`, `plus`, `minus`, `times`, `dividedBy`,
    `modulo`) and the duplicates `toBool` and `random_string` were removed, not
    aliased (F26, F13); see [Migrating from Liquid](other-engines.md).
