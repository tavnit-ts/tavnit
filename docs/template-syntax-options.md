# Text-template syntax options

Tavnit currently uses `${{ expression }}` for interpolation and `${% if %}` /
`${% for %}` for text-template control flow. This note records alternatives
considered for future language changes. It does not change the current syntax.

## Current syntax

```yaml
displayTitle: >-
  Export all${% if args.only %} (only: ${{ args.only }})${% elif args.from %} (from: ${{ args.from }})${% endif %}
```

The explicit text/block delimiter keeps an interpolation expression distinct
from control flow. It handles a multi-branch fragment without repeating either
condition or interpolated value.

## Postfix conditional expression

Jinja and Nunjucks support `value if condition else fallback`, with an optional
`else`. A Tavnit equivalent could be:

```yaml
title: 'Hello${{ " " + user.name if user.name }}'
```

This is concise for one optional fragment. It is not an improvement for an
`if` / `elif` / `else` chain, and would add a second conditional spelling next
to Tavnit's existing `condition ? consequent : alternate`.

Sources: [Jinja if expressions](https://jinja.palletsprojects.com/en/stable/templates/#if-expression), [Nunjucks if expressions](https://mozilla.github.io/nunjucks/templating.html#if-expression).

## Mustache-style sections

Mustache uses a section for both conditional output and repeated output. An
adaptation with Tavnit's dollar-prefixed delimiters could be:

```yaml
title: 'Hello${# user.name} ${{ user.name }}${/}'
```

An extension could add an alternative branch:

```yaml
title: '${# primary}${{ primary }}${: fallback}${{ fallback }}${/}'
```

This is compact for a one-condition text block, but it is still a block
language with new delimiter rules and requires its own scope semantics for
iteration.

Sources: [Mustache sections](https://mustache.github.io/mustache.5.html#sections), [Mustache inverted sections](https://mustache.github.io/mustache.5.html#inverted-sections).

## Statements in interpolation delimiters

Go templates put `if`, `else`, `end`, and `range` inside the same delimiters as
interpolation:

```text
{{if args.only}} (only: {{args.only}}){{else}}{{end}}
```

For Tavnit this would make `${{ ... }}` ambiguous: today it always contains one
expression. It is therefore not a suitable direction.

Source: [Go `text/template` actions](https://pkg.go.dev/text/template).

## Decision

Keep `${% if %}` / `${% elif %}` / `${% else %}` / `${% endif %}` and `${% for
%}` for text templates. Use Tavnit ternaries for a small computed text value;
use `$if` / `$unless` on a value-tree mapping when the conditional controls a
structured value rather than text.
