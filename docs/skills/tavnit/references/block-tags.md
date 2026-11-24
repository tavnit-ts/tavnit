## Block Tags

<!-- contents -->
**Contents**

- [`${% if %}` / `${% elif %}` / `${% else %}` / `${% endif %}`](#-if----elif----else----endif-)
- [`${% for %}` / `${% endfor %}`](#-for----endfor-)
- [Block Tag Whitespace](#block-tag-whitespace)
- [Escaping `${% `](#escaping--)
- [Nesting](#nesting)
<!-- /contents -->

Block tags let a template include or repeat sections of text without embedding
the control logic inside a `${{ }}` expression. The delimiter is `${% … %}` —
note the `%` instead of the second `{`.

### `${% if %}` / `${% elif %}` / `${% else %}` / `${% endif %}`

```
${% if condition %}
  …rendered when condition is truthy…
${% elif otherCondition %}
  …rendered when otherCondition is truthy…
${% else %}
  …rendered when no condition matched…
${% endif %}
```

- `condition` and `otherCondition` are Tavnit expressions evaluated against
  the current context. Any Tavnit expression is valid — identifiers, operators,
  function calls, pipe chains.
- Only the first matching branch is rendered; remaining branches are skipped.
- `${% elif %}` and `${% else %}` are optional.
- Multiple `${% elif %}` branches are supported.

```yaml
body: |
  ${% if args.status == "urgent" %}
  ⚠️ Urgent: ${{ args.title }}
  ${% elif args.status == "pending" %}
  Pending: ${{ args.title }}
  ${% else %}
  ${{ args.title }}
  ${% endif %}
```

### `${% for %}` / `${% endfor %}`

```
${% for variable in iterableExpr %}
  …body rendered once per element…
${% endfor %}
```

- `variable` is a bare identifier (the loop variable); it is bound to the
  current element on each iteration.
- `iterableExpr` is a Tavnit expression that must evaluate to an array. Any
  expression is valid: an identifier, a pipe chain, a function call, etc.
- The body may contain `${{ }}` spans and nested `${% if %}` / `${% for %}`
  blocks.

```yaml
body: |
  Items:
  ${% for item in args.items %}
  - ${{ item.name }}: ${{ item.price | toFixed(2) }}
  ${% endfor %}
```

**`forloop` — loop metadata object**

Inside a `${% for %}` body, the name `forloop` is automatically bound to an
object with these fields:

| Field | Type | Description |
|---|---|---|
| `forloop.index` | number | 0-based position of the current element |
| `forloop.index1` | number | 1-based position (first = 1) |
| `forloop.first` | boolean | `true` on the first iteration |
| `forloop.last` | boolean | `true` on the last iteration |
| `forloop.length` | number | Total number of elements in the array |

```yaml
body: |
  ${% for item in args.items %}
  ${% if forloop.first %}Items:${% endif %}
  ${{ forloop.index1 }}. ${{ item.name }}${% if forloop.last %} (end)${% endif %}
  ${% endfor %}
```

In nested loops, each `${% for %}` injects its own `forloop` binding that
shadows any outer `forloop` within its body.

**Loop budget** — the total number of iterations across all `${% for %}` loops
in a single `render()` call is capped by `maxIterations` (same value as the
expression iteration budget; default 10 000). Exceeding the budget throws an
`ExpressionError`.

### Block Tag Whitespace

Block tags themselves emit **no whitespace**. The tag is removed from the
output and only the surrounding literal text and the rendered body remain.
This means the same tag works in two distinct layout styles:

**Block style** — one tag per line, body indented. The surrounding newlines
(from the YAML literal block scalar `|`) produce the vertical structure:

```yaml
body: |
  ${% if args.urgent %}
  ⚠️ Action required
  ${% endif %}
```

**Inline style** — tag embedded mid-line, no newlines around it. Because the
tag itself adds no whitespace, adjacent literal text and `${{ }}` spans run
together exactly as written:

```
${% for item in items %}${{ item.name }}${% if !forloop.last %}, ${% endif %}${% endfor %}
// => "alpha, beta, gamma"
```

A common mistake when porting block-style templates to inline use is leaving
newlines around the tags — those newlines *are* literal text and will appear
in the output as blank lines. Remove them to get tight inline output.

### Escaping `${% `

To emit the literal character sequence `${%` in output without starting a block
tag, escape the opening brace: `$\{%`. The renderer produces `${%` and no tag
is parsed.

```
$\{%  →  ${%   (literal output, no tag parsed)
$\{{  →  ${{   (same mechanism for expression delimiter)
```

### Nesting

`${% if %}` and `${% for %}` may be nested freely:

```
${% for group in args.groups %}
${% if group.visible %}
## ${{ group.name }}
${% for item in group.items %}
- ${{ item.title }}
${% endfor %}
${% endif %}
${% endfor %}
```
