## Embedding

<!-- contents -->
**Contents**

- [The ${{ }} Delimiter](#the---delimiter)
- [Expression Mode vs. Text-Embedding Mode](#expression-mode-vs-text-embedding-mode)
- [Type Preservation](#type-preservation)
- [YAML Quoting Rules](#yaml-quoting-rules)
- [Keep `${{ }}` at the leaves](#keep---at-the-leaves)
<!-- /contents -->

`${{ }}` marks a Tavnit expression inside a larger text value. The expression
is evaluated and the result is substituted in place.

`${{ }}` can appear in **any string context** — it is a general text-embedding
mechanism, not a YAML-specific one. The delimiter was designed with YAML as the
primary host format (its `$` prefix keeps `{{ }}` out of YAML's way in **block**
context), but the same pattern applies wherever string values are authored:

- **YAML configuration values** — the primary use case; path strings, argument
  values, condition fields, and return expressions.
- **Agent prompt strings** — multi-line system and user prompts with interpolated
  context values and conditional phrasing.
- **Notification message text** — Telegram messages, email bodies, Slack
  messages with inline data.
- **HTML fragments** — dynamic attribute values, link `href`s, or inline content
  in rendered output.
- **URL path and query strings** — `/tenants/${{ tenantId }}/report`
- **Log and trace format strings** — structured log messages with runtime values.
- **Configuration values** — any field in a configuration file that accepts
  string interpolation.

### The ${{ }} Delimiter

Three usage patterns:

```yaml
# Text-embedding: one or more ${{ expr }} spans inside a string
path:  /orders/${{ orderId }}/invoice
label: Hello ${{ name }}, you have ${{ size(items) }} items

# Expression mode: entire value is a single ${{ }} span — type is preserved
enabled: ${{ enabled }}          # returns boolean
count:   ${{ count ?? 0 }}       # returns number

# Condition fields — no quotes needed
if:     ${{ response != null && response.status == 200 }}
unless: ${{ notes | some(x => x == "done") }}
```

The `${{ }}` delimiter avoids the YAML flow-mapping ambiguity that affects
`{{ }}` **in block context** — as a block mapping value, a YAML parser sees the
whole `${{ … }}` as a plain scalar. This does **not** hold inside a flow
collection (see [Never put a span in a flow collection](#never-put-a-span-in-a-flow-collection)).

In agent prompts and message bodies, text-embedding mode is the common pattern:

```
Hello ${{ name }}, your order total is ${{ total | toFixed(2) }}.
You have ${{ size(items) }} items in your cart.
${{ unpaidCount > 0 ? "Action required: " + unpaidCount + " unpaid invoices." : "" }}
```

**Emitting a literal `${{`** — to include the three-character sequence `${{` in
output without starting a span, escape the opening brace: `$\{{`. The renderer
treats `$\{{` as the literal text `${{`.

### Expression Mode vs. Text-Embedding Mode

**Text-embedding mode** applies when a value contains one or more `${{ }}` spans
alongside other characters. Each span is rendered to its string representation
and the entire value is a string:

```yaml
path:    /items/${{ id }}/details    # "/items/42/details"
summary: ${{ count }} of ${{ total }}
```

**Expression mode** applies when the entire YAML value is a single `${{ }}` span
with no surrounding text. The result type is preserved:

```yaml
enabled: ${{ enabled }}    # boolean true, not string "true"
count:   ${{ count }}      # number 42, not string "42"
body:    ${{ payload }}    # object, not "[object Object]"
```

The mode is determined by the YAML value structure — no flag is required.

### Type Preservation

In expression mode the native type is returned: boolean, number, object, array,
`null`, or a date type (see [Date and Time](datetime.md#date-and-time)). No coercion occurs.

In text-embedding mode each span is converted to a string. Objects stringify to
their JSON representation; date types stringify to their ISO 8601 representation.

```yaml
limit: ${{ limit ?? 200 }}         # number — expression mode
label: Max ${{ limit }} results    # string "Max 200 results" — text-embedding mode
```

### YAML Quoting Rules

In block context `${{ }}` does not trigger YAML's flow-mapping parser, so most
values need no quotes:

```yaml
path: /orders/${{ orderId }}/invoice
id:   order-${{ id }}
if:   ${{ id != null && balance >= threshold }}
```

Quotes are still needed when the YAML scalar would otherwise be ambiguous:

- Value starts with a reserved YAML indicator (`!`, `&`, `*`, `|`, `>`, `{`, `[`)
- Value text contains `: ` (colon-space) — YAML reads it as a mapping separator
- Value text contains ` #` (space-hash) — YAML reads it as an inline comment start
- A `true` / `false` / `null` / number value that must stay a string

A `"` inside a **double-quoted** scalar ends it — `"${{ x != "" }}"` truncates at
the empty string and fails with *Unterminated expression span*. Write string
literals inside a span with `''`, or quote the scalar with `'`.

```yaml
# quotes required — ": " in the text
label: "Status: ${{ status }}"

# quotes required — starts with "{"
value: "{${{ id }}}"

# no quotes needed — delimiter never triggers YAML ambiguity
if:   ${{ id != null && balance >= threshold }}
path: /orders/${{ id }}/invoice
```

The `${{ }}` delimiter itself never requires quoting **in block context**. It
does not protect you in a flow collection — see the next section.

#### Never put a span in a flow collection

In a flow mapping or flow sequence (`{ … }` / `[ … ]`), YAML sees the `{` of
`${{` as the start of a nested flow mapping. YAML parsing does not report
the resulting error, so the expression is silently replaced by a **truncated
string**:

```yaml
# BROKEN — YAML truncates the value to "$"; no error is raised
on:
  press: { action: app.Open, args: { id: ${{ item.id }} } }
```

That writes the literal string `"$"` where the id must be. The span scanner
also consumes the closing `}` of an adjacent object literal — `${{ { id: 1 }}}`
parses as the expression `{ id: 1 ` plus a stray literal `}`, which fails with
`Unterminated object literal`. **Leave a space before the span terminator.**

```yaml
# Correct — block mappings, one key per line
on:
  press:
    action: app.Open
    args:
      id: ${{ item.id }}

# Correct — space before }}: the object literal is inside the span.
# ': ' inside the object also forces quotes, as everywhere else in YAML.
children: '${{ items | map(x => { type: "Row", props: { text: x.name } }) }}'
```

The same rule applies to a `: ` inside any expression content:

```yaml
<!-- yaml-example: invalid -->
# FAILS — ": " inside the string literal "bad value: 42" breaks YAML parsing
- ${{ "bad value: 42" in error }}
```

```yaml
# Correct — single-quoted YAML scalar treats ": " as literal text
- '${{ "bad value: 42" in error }}'

# Alternative — avoid ": " in the expression entirely
- ${{ error | includes("bad value") }}
```

**Ternary false branch `: null` is the most common trigger.** A ternary
expression like `arr != null ? expr : null` contains `: null` — which is
`: ` (colon-space) from YAML's perspective. Wrap in single quotes:

```yaml
<!-- yaml-example: invalid -->
# FAILS — ": null" terminates the plain scalar
items: ${{ arr != null ? (arr | join(",")) : null }}

# Correct — single-quoted
items: '${{ arr != null ? (arr | join(",")) : null }}'
```

This applies to any ternary whose false (or true) branch starts with a word
after the colon: `: null`, `: true`, `: false`, `: "string"` — all contain
`: ` and require quoting.

**Preferred style — omit quotes whenever the value contains `${{ }}`:**

```yaml
# preferred
result: ${{ args.value }}
if:     ${{ count > 0 }}
path:   /items/${{ id }}/details
label:  Hello ${{ name }}, you have ${{ size(items) }} items

# avoid — quotes are redundant here
result: "${{ args.value }}"
if:     "${{ count > 0 }}"
```

The `"..."` wrapper is not wrong and the engine handles it identically, but
omitting quotes is idiomatic: it reduces visual noise, makes expression-mode
type preservation obvious at a glance (a quoted single-span value still
returns the correct type, but looks like a string), and avoids the need to
escape inner `"` characters in string-building expressions like
`${{ flag ? "yes" : "no" }}`.

### Keep `${{ }}` at the leaves

`${{ }}` interpolates a computed value — it is not how you build structure.
Author a known shape as a literal YAML tree and put a `${{ }}` span on each
field that is actually dynamic.

```yaml
# prefer — tree in YAML, ${{ }} only where a value flows in
type: Card
props:
  title: ${{ item.name }}
  subtitle: '${{ item.active ? "On" : "Off" }}'
children:
  - type: Button
    props:
      label: Open
    on:
      press:
        action: app.Open
        args:
          id: ${{ item.id }}
```

Build an array or object inside one expression **only when its shape depends
on data** — the element or key count is unknown when you write it. What data
decides there is the *count*; each element's own shape is still something you
write out, so keep that body down to a field or two. The object's own `: ` makes
the scalar ambiguous, so single-quote the value:

```yaml
# justified — one row per item, count is dynamic, body is one field
children: '${{ items | map(x => { type: "Row", props: { text: x.name } }) }}'
```

A fixed-size list stays a YAML sequence even if one leaf inside it is dynamic —
do not wrap the whole list in an expression to reach a single `${{ }}`.

Once that body grows into a record or a tree of its own, it leaves the string.
Folding the expression across lines (`>-`, `let … in`) only helps a long
**scalar** computation; a body that builds structure stays opaque to YAML however
it is wrapped, and its leaves can carry neither comments nor guards. There are two
ways out, and the second is often the better one.

**Call a host function.** The body moves out of the expression entirely, into
something whose own definition is written in YAML; the expression keeps only the
walk. That is a function the host registers (see
[Filter Registration](typescript-api.md#filter-registration)):

```yaml
children: ${{ items | map(t => rowNode(t)) }}
```

A one-argument function can be named bare — `map(rowNode)` — and a predicate the
same way: `filter(visibleRow)`. Prefer this when the body would be worth a name,
a test, or a second use; the `_` hole when it is one-off shape.

**Keep the body as a YAML subtree.** The `_` subtree hole lets the body stay a
real YAML tree — `children: ${{ items | map(t => _) }}` with the body under a
`_:` sibling key. It, spreads and `$if` / `$unless` guards are covered in
[Value Templates](value-templates.md).
