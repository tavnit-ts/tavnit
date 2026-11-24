## Coming from Other Engines

<!-- contents -->
**Contents**

- [If You Know Liquid (LiquidJS / Shopify Liquid)](#if-you-know-liquid-liquidjs--shopify-liquid)
- [Engine Comparison Table](#engine-comparison-table)
<!-- /contents -->

Tavnit shares surface syntax with several expression and template engines —
`|` for pipe composition, `filter()` and `map()` by name, familiar arithmetic
operators. The sections below call out the points where Tavnit diverges from
what you may already know.

### If You Know Liquid (LiquidJS / Shopify Liquid)

The pipe `|` operator and filter-by-name style will look familiar. The key
differences:

- **Delimiter** — Tavnit uses `${{ }}`, not `{{ }}`. The dollar sign is
  required; it avoids YAML flow-mapping ambiguity and signals that the
  content is an expression, not a template tag.
- **Filter arguments** — Liquid uses a colon-separated positional style
  (`{{ price | divided_by: 100 }}`). Tavnit uses function-call syntax
  (`${{ price | round(2) }}`), and operators where JavaScript has one
  (`${{ price / 100 }}`).
- **Block tags** — `{% if %}`, `{% for %}`, `{% assign %}` are Liquid constructs.
  Tavnit has its own block-tag syntax with a `${% %}` delimiter:
  `${% if cond %}…${% endif %}` and `${% for x in arr %}…${% endfor %}`.
  `{% assign %}` has no equivalent; use `let … in` inside `${{ }}` expressions
  for local naming. See [Block Tags](block-tags.md#block-tags).
- **Expression semantics** — Tavnit evaluates TypeScript-style expressions:
  `&&`, `||`, `??`, `!`, strict-equality `==`, optional chaining `?.`.
  Liquid truthiness rules (`nil` and `false` are falsy; everything else is
  truthy) do not apply — Tavnit uses JavaScript truthiness (`0`, `""`, and
  `null` are all falsy).
- **Types are preserved** — `${{ count }}` in expression mode returns a
  number, not its string representation. Only text-embedding mode (multiple
  spans or surrounding literal text) coerces to string.
- **`nil` and `empty` do not exist** — Tavnit has no `nil` or `empty`
  keywords. Use `null` in place of `nil`. `empty` has no direct equivalent;
  use explicit checks: `size(v) == 0` for an empty array, `v == ""` for an
  empty string. The trap: writing `empty` in a Tavnit expression silently
  resolves to `null` (unknown identifier) instead of throwing, so the
  condition appears to work but tests the wrong thing.
- **`| default: null` on optional fields → drop it** — in a value template,
  `${{ order.note }}` returns `null` for a missing key, and a key whose span
  resolves to `null` is left out of the rendered object (see
  [Leaves and keys](value-templates.md#leaves-and-keys)). A `| default: null`
  that only kept an optional field out of the output is redundant. Keep explicit
  defaults only when the value must be non-null: `| default: 0` → `?? 0`.
  ```yaml
  # Liquid
  note:  "{{ order.note | default: null }}"

  # Tavnit — the key is omitted when order.note is null
  note:  ${{ order.note }}
  ```
- **`{% assign %}`-based conditions → one expression** — an intermediate
  `{% assign %}` that only feeds a condition collapses into a single `${{ }}`
  expression with `&&`, `??` and built-ins. Reach for `let … in` only when a
  subexpression repeats:
  ```
  // Liquid
  {% assign adult = user.age >= 18 %}{{ adult and user.verified }}
  // Tavnit
  user.age >= 18 && user.verified
  ```
- **`contains` → `in` (operands reversed)** — Liquid's `a contains b` puts
  the collection on the left. Tavnit's `in` operator puts the value on the
  left: `b in a`. Every migrated `contains` condition must flip its operands:
  ```
  // Liquid
  tags contains "urgent"
  // Tavnit
  "urgent" in tags
  ```
- **Collection filters use predicate functions, not field names** — Liquid's
  `where`, `find`, `groupBy`, `sort`, and `uniqBy` accept field-name strings
  (`where: 'status', 'ok'`). Tavnit equivalents accept arrow functions:
  ```
  // Liquid
  items | where: 'status', 'ok'
  items | find: 'id', targetId
  // Tavnit
  items | filter(x => x.status == "ok")
  items | find(x => x.id == targetId)
  ```

### Engine Comparison Table

#### Liquid names that Tavnit does not have

Tavnit names follow TypeScript / JavaScript. The Liquid names below do not exist
(they are not aliases); an expression that uses one fails with `TAV_UNKNOWN_FUNCTION`.

| Liquid | Tavnit |
|---|---|
| `upcase` | `toUpperCase` |
| `downcase` | `toLowerCase` |
| `plus: n` | `+ n` |
| `minus: n` | `- n` |
| `times: n` | `* n` |
| `divided_by: n` / `dividedBy(n)` | `/ n` (`round(a / b)` or `floor(a / b)` for an integer quotient) |
| `modulo: n` | `% n` |
| `random_string(n)` | `randomString(n)` |
| `toBool` | `bool` |
| `sha256(x) \| base64urlEncode` for a digest | `sha256(x) \| base64urlEncodeHex` |

To pipe an arithmetic result, parenthesise: `(price * 2) | toFixed(2)`.

The table below covers the axes most relevant to migrating from LiquidJS.
CEL, JEXL, and JSONata differ primarily in delimiter and pipe style — row notes
are included where the difference is material.

| Feature | LiquidJS | Tavnit |
|---|---|---|
| **Expression delimiter** | `{{ expr }}` | `${{ expr }}` |
| **Block-tag delimiter** | `{% if %}` / `{% for %}` | `${% if %}` / `${% for %}` |
| **Filter / pipe argument style** | Colon-separated: `\| divided_by: 100` | Operator: `price / 100` |
| **Null / nil keyword** | `nil` | `null` |
| **Empty test** | `== empty` (built-in keyword) | `size(v) == 0` (arrays); `v == ""` (strings) |
| **Membership operator** | `collection contains value` (collection on left) | `value in collection` (value on left) |
| **Logical AND / OR** | `and` / `or` only | `&&` / `and`, `\|\|` / `or` — both accepted |
| **Unary NOT** | No `!` operator | `!value` or `not value` |
| **Null coalescing** | No `??` — use `\| default:` filter | `??` operator; `\| default(v)` also available |
| **Optional chaining** | Silently returns nil for any depth | `?.` guards one access; `.` on null throws |
| **Strict equality** | `==` with loose semantics | `==` strict (no coercion) |
| **Truthiness** | Only `nil` and `false` are falsy | JavaScript truthiness: `0`, `""`, `null` also falsy |
| **Arrow functions** | Not available | `x => expr`, `(x, y) => expr` |
| **`let … in` binding** | `{% assign %}` block tag | `let name = expr in body` — inline expression binding |
| **Type preservation** | All output coerced to string | Expression mode preserves type (number, boolean, object) |
| **Custom filters** | Registered as an instance method: `new Liquid().registerFilter(…)` | Registered via `createEngine({ filters: { … } })` |

> **Other engines:** CEL has no pipe operator — `.` is field selection and
> `a.f(b)` is receiver-call sugar for `f(a, b)`;
> JEXL uses `|` but with a different argument protocol; JSONata uses `$`-prefixed
> built-ins and `~>` for chaining. Detailed per-engine comparisons are deferred
> to a future section.
