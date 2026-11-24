# Tavnit Lexer

## Token Kinds

**Literals**: `Number`, `String`, `True`, `False`, `Null`

**Keywords** (reserved identifiers): `Let`, `In`, `And`, `Or`, `Not`

**Operators** (multi-char, longest match first):
`AmpAmp` (`&&`), `PipePipe` (`||`), `QuestionQuestion` (`??`), `QuestionDot` (`?.`),
`Arrow` (`=>`), `StarStar` (`**`), `Eq` (`==`), `NotEq` (`!=`), `LtEq` (`<=`), `GtEq` (`>=`),
`Assign` (`=`), `PipeOp` (`|`), `Question` (`?`)

**Single-char**: `Plus`, `Minus`, `Star`, `Slash`, `Percent`, `Bang`, `Colon`,
`Lt`, `Gt`, `Dot`, `Comma`, `LParen`, `RParen`, `LBracket`, `RBracket`, `LBrace`, `RBrace`

**Control**: `EOF` (always the last token)

## Design Constraints

- `In` is shared between `let … in` bindings and the membership `in` operator; the parser disambiguates by position.
- Numbers: integers, decimals and an optional exponent (`1e3`, `1.5e-3`, `2E+6`); the `e` joins the number only when a digit follows it (and an optional sign); a trailing dot (e.g. `42.foo`) is **not** consumed into the number.
- Strings: single- or double-quoted; `\` escape sequences are passed through raw (the evaluator resolves them).
- Unterminated strings and unrecognised characters throw `LexError` with its `position`; `parse()` rethrows it as `ParseError`.

## Block-tag Template Parser (`parseTemplate`)

`parseTemplate(template)` returns a `TemplateNode[]` — a superset of the `Span[]` from `extractSpans`.
It adds `if` and `for` nodes parsed from `${% tag %}` delimiters.

**Node shapes:** `literal`; `expression { source, offset }`;
`if { condition, conditionOffset, consequent, elseifs, alternate }`;
`for { variable, iterable, iterableOffset, body }`. A `for` header is tokenised as
identifier + literal `in` + the rest of the header as the iterable expression source.

**Tag syntax:**
- `${% if <expr> %}` / `${% elif <expr> %}` / `${% else %}` / `${% endif %}`
- `${% for <ident> in <expr> %}` / `${% endfor %}`
- `$\{%` → literal `${%` (mirrors `$\{{` for expressions)

**Parser internals:**
- `parseNodes(state, stopTags)` — recursive; returns `{ nodes, stop }` where `stop` carries the matched stop-tag name and its content.
- `parseTagAt(template, pos)` — extracts tag name, rest-content, and the absolute `restOffset` of that content in the template.
- `parseIfBlock` / `parseForBlock` — recursive call-outs from `parseNodes`.
- All stop-tag sets (`ELIF_ELSE_ENDIF`, `ENDIF_ONLY`, `ENDFOR_ONLY`) are pre-built constants to avoid heap allocation per call.
- `STRUCTURAL_TAGS` — the set of tags that are only valid inside a block; appearing at the top level or wrong context throws `TemplateError("Unexpected '...' tag")`.

`extractSpans` and `parseNodes` find a span's end with `findSpanEnd`: it skips string literals (`\` escapes) and counts `{ … }`, so `${{ "}}" }}` and `${{ {id: 1}}}` close at the right `}}`; an unclosed string falls back to the first `}}` so the lexer reports the string. `extractSpans` is exported from `@tavnit-ts/tavnit/internal`.

## Testing

Tests live in `src/lexer/lexer.test.ts` (vitest). Run:

```bash
pnpm run test
pnpm run test:coverage
```

## Coverage

The `pos2()` fallback in `lexError` (`tokenize.ts`) is suppressed with
`/* v8 ignore next -- @preserve */`. The `at` parameter is optional but every current call
site always supplies it; the `pos2()` path exists for future call sites that have no position
ready.
