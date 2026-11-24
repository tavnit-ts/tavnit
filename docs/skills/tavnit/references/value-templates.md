## Value Templates

<!-- contents -->
**Contents**

- [Leaves and keys](#leaves-and-keys)
- [Object spread — `"..."`](#object-spread--)
- [Array spread — `- ...:`](#array-spread----)
- [Node guards — `$if` / `$unless`](#node-guards--if--unless)
- [Subtree hole — `_`](#subtree-hole--_)
- [Scope boundaries](#scope-boundaries)
- [Unwrapping host — `$_`](#unwrapping-host--_)
- [Rules](#rules)
- [Linting inline object literals](#linting-inline-object-literals)
- [When to use which](#when-to-use-which)
<!-- /contents -->

A value template is a YAML/JSON tree whose strings are Tavnit templates. In
TypeScript it is `engine.parse(value)` + `engine.evaluate(template, context)` (see
[TypeScript API](typescript-api.md#core-evaluation-api)). The tree keeps its shape,
and a few keys are directives rather than data.

### Leaves and keys

- A string that is a single `${{ expr }}` span is evaluated in expression mode and
  keeps its type (array, object, number, `null`, date). Any other string is a text
  template and becomes a string (see
  [Expression Mode vs. Text-Embedding Mode](embedding.md#expression-mode-vs-text-embedding-mode)).
- A key may carry spans too; it is rendered as text, so a key span that evaluates
  to `null` gives the empty key `""` — guard the entry with `$if` when the key can
  be `null`.
- An entry whose **value span** evaluates to `null` is left out of the object. A
  value written literally as `null` is kept.
- Every span, key and directive is compiled before the first evaluation, so a
  syntax error anywhere in the tree fails up front; the error's `path` names the
  node.

### Object spread — `"..."`

A `"..."` key merges the object its expression returns into the surrounding
mapping. Keys merge in the order written: a key **after** the spread overrides the
spread's value, a key **before** it is overridden by it. The value must be a plain
object; `null` merges nothing — an absent optional object is not an error — and
anything else is an error, because silently dropping it would lose fields.

```yaml
args:
  headers:
    "...": ${{ context.baseHeaders }}      # merge all fields from baseHeaders
    authorization: Bearer ${{ env.TOKEN }} # added / overrides the spread value

# Forward all caller args while adding a default:
args:
  timeout: 30
  "...": ${{ args }}   # caller args override the default timeout above
```

### Array spread — `- ...:`

Inside a sequence, `- ...: ${{ expr }}` splices the elements of the array the
expression returns. `null` adds nothing; any other non-array value is an error —
wrap a single item as `[item]`. It is also the idiomatic way to concatenate arrays:

```yaml
result:
  - static-first
  - ...: ${{ leads }}
  - ...: ${{ customers }}
  - static-last
```

### Node guards — `$if` / `$unless`

Any mapping may carry a `$if` and/or `$unless` key. The mapping survives only when
`$if` is truthy **and** `$unless` is falsy; otherwise it is removed from its parent
— the array element is dropped, or the object key is omitted. The guard keys never
appear in the output. The guard value must be a single `${{ }}` span or a literal
`true` / `false`; truthiness matches `${% if %}` (`[]` and `{}` are truthy).

```yaml
children:
  - type: Searchbar
  - $if: ${{ args.canEdit }}              # dropped when canEdit is falsy
    type: Fab
    props: { icon: pencil }
  - $unless: ${{ size(args.rows) > 0 }}   # dropped when rows is non-empty
    type: EmptyState
    props: { text: Nothing found }
```

Without a guard the same node is a `${{ cond ? {…} : null }}` expression with its
body buried in the string; `$if` keeps the body a YAML subtree, with comments,
block scalars and folding.

### Subtree hole — `_`

`_` lets a YAML subtree act as the body of a `map` / `flatMap` / `reduce` or a
one-shot call, instead of an object literal written inside the expression. The
body can be a node tree or a plain record.

- A sibling key — the **host** — holds a single `${{ }}` span that mentions the
  bare identifier `_`, usually as a lambda body: `map(t => _)`.
- The `_:` key holds the subtree. It is compiled once and evaluated wherever the
  host reaches `_`, in the host's scope, so every enclosing lambda's variables
  resolve inside it.
- The host key receives the value: `children: ${{ … }}` + `_:` renders as
  `{ children: [ … ] }`.
- Everything in this page applies inside a body too: spreads, guards, templated
  keys, dropped `null` values.

```yaml
# body stays a YAML tree; `t` is bound to each element
children: ${{ items | map(t => _) }}
_:
  "...": ${{ t }}          # the row's own fields
  type: Row
  key: row-${{ t.id }}     # after the spread: wins over t.key
  props:
    text: ${{ t.name }}
```

The host can be a whole chain; a `_` nested in an inner lambda sees the outer one's
variable too:

```yaml
# one record per attendance mark; `l` (outer lambda) and `d` (inner) both resolve
result:
  $_: ${{ flatMap(rows, l => ((l.details ?? []) | filter(d => d.mark != null) | map(d => _))) }}
  _:
    id: ${{ d.id }}
    subject: ${{ l.subject ?? '' }}
    attended: ${{ d.mark == 1 }}
```

`reduce` with an explicit accumulator — the `_:` list starts with the previous
accumulator, then appends this row's nodes; a guard inside runs per iteration and
can inspect `acc`:

```yaml
children:
  $_: ${{ args.rows | reduce((acc, t) => _, []) }}
  _:
    - "...": ${{ acc }}
    - $if: ${{ (acc | last)?.group != (t.group ?? "—") }}
      type: ListSection
      props: { title: ${{ t.group ?? "—" }} }
      group: ${{ t.group ?? "—" }}
    - type: ListItem
      key: row-${{ t.id }}
      props: { title: ${{ t.name }} }
```

### Scope boundaries

The `_:` body receives the scope of the host expression. Lambda parameters such
as `t`, `d`, and `acc` are therefore available inside that body, including in its
nested value-template nodes. A `let … in` binding is likewise available only in
the expression that contains it.

Evaluating a leaf does not create a name for sibling YAML nodes or for a later
host expression. If several parts of a surrounding configuration need one
computed value, the host language must compute and bind that value outside this
value template; Tavnit intentionally has no cross-node assignment. Keep the
shared value at that host boundary, and use `_:` only for the per-host scope it
receives.

### Unwrapping host — `$_`

Name a sole mapping value `$_` and the mapping *becomes* that value instead of
carrying it under a key. It may be a scalar expression, literal, or a YAML tree.
With `_:` it is a host expression. As an array element, an array value contributes
its elements and any other value is pushed as one element:

```yaml
children:
  - type: Searchbar
  - $_: ${{ items | map(t => _) }}
    _:
      type: Item
      key: row-${{ t.id }}
```

`$_` also carries a one-shot call: `$_: ${{ rowNode(_) }}` hands the whole subtree
to a host function as its argument.

### Rules

- `map(t => _)` over a **list** body yields an array of arrays — use `flatMap` for
  several nodes per element, `reduce` when you need `acc`.
- `map` / `flatMap` pass only the element; there is no index parameter. Use
  `reduce` for a running position or look-back.
- These are compile errors:
  - a `_:` body with no sibling span that mentions `_`;
  - a `$_` with another key besides its optional `_:`, or, when it has `_:`, whose
    value is not a single span that mentions `_`;
  - a `"..."` host that mentions `_` — use `$_`;
  - block tags (`${% %}`) inside a `_:` body.

### Linting inline object literals

`TAV001` identifies an object literal with more than two direct fields. The rule
is temporarily disabled, so `lintValueTemplate(value)` returns no finding for it.

```ts
lintValueTemplate({
  rows: "${{ records | map(r => ({ id: r.id, label: r.label, state: r.state })) }}",
});
// []
```

`lintValueTemplate` currently suppresses `TAV001`–`TAV005`; see [TypeScript API](typescript-api.md#linting-value-templates).

Keep a genuinely small record inline. For a larger result tree, move its body
to YAML/JSON with `_` or `$_`; the expression then only controls where that
tree is evaluated.
`fixInlineObject()` performs that move for one finding (see
[TypeScript API](typescript-api.md#linting-value-templates)).

### When to use which

| Situation | Use |
|---|---|
| A fixed node that sometimes must not render | `$if` / `$unless` on the node |
| One node or record per data row | `$_` + `map(row => _)` |
| Several nodes per data row | `_` with `flatMap(row => _)` |
| Row output depends on rows already emitted (group headers, running totals) | `_` with `reduce((acc, row) => _, [])` |
| A whole subtree that renders only when some data is present | `_` with `${{ data != null ? _ : null }}` |
| A host function whose argument is a fixed tree | `$_` with `${{ fn(_) }}` |
| A value that is genuinely a computed scalar or string | a plain `${{ }}` leaf — **not** `_` |
| A small fixed-size list where one leaf is dynamic | a plain YAML sequence with a `${{ }}` leaf — **not** `_` |

Reach for `$if` / `_` to avoid an expression whose body — a node tree or a record
— is an object literal inside the string. Wrapping that expression in `>-` or
`let … in` formats the string; it does not get the body out of it. If that pain is
not present, keep `${{ }}` at the leaves (see
[Keep `${{ }}` at the leaves](embedding.md#keep---at-the-leaves)).
