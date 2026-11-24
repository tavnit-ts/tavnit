# Tavnit Parser

## Design Notes

- **Pratt parser** with binding powers mapped to the [Precedence Table](../../docs/skills/tavnit/references/language.md#precedence-table) (levels 1–16).
- **`**` (lbp 70)** is right-associative (its right operand parses at 69). Unary `-` parses its operand at 75 and `!` / `not` at 80, so none takes a `**` or a `*`: `-a * b` is `(-a) * b`. A unary operator directly before `**` is a parse error, as in JavaScript (`rejectPowerOperand`).
  `ASTNode.kind` values: `literal`, `identifier`, `array`, `object`, `valueTemplate`, `unary`, `binary`,
  `member`, `index`, `call`, `ternary`, `pipe`, `arrow`, `let`. Unary operators are `!`,
  `not`, and `-`. `valueTemplate` is **synthetic** — `parse()` never emits it;
  `parser/value-template.ts` puts one, holding the compiled `_` body, in place of each `_` of a host.
- **`??` mixing restriction**: `??` cannot appear at the same level as `&&`/`||` without parentheses. Tracked via `ctx` bitflags (`CTX_NULLISH`, `CTX_LOGICAL`) passed through the recursive descent.
- **Pipe node** is kept as a distinct `PipeNode` at parse time (not normalised to `Call`). Normalisation happens in the evaluator.
- **Reserved name check** fires at parse time for `.prop` and `?.[key]` accesses where `prop` or the string literal key is in the prototype-restriction list (`__proto__`, `constructor`, `prototype`, `__defineGetter__`, etc.). Also fires on arrow params and `let` binding names.
- **Callee restriction**: a callee is an identifier or a plain (non-optional) member chain, which names a function — `fn(...)` and `mod.fn(...)` both work, and `dottedCallee()` joins the chain into the callee string. Anything else — `(a + b)(...)`, `a[0](...)`, `mod?.fn(...)` — is a parse error. The pipe callee accepts the same dotted name.
- **Arrow functions (`=>`)** — Level 15, lbp=3. Single unparenthesised param handled in parseLed; zero-param `()` and multi-param `(a, b)` handled in parsePrimary via lookahead (`tryParseArrowParamList`). Right-associative (body uses rbp=2).
- **`let … in`** — Level 16, nud-only (parsePrimary). Binding expressions are parsed with `CTX_NO_IN` so the `in` keyword terminates the binding rather than being treated as a binary membership operator.
- **`CTX_NO_IN` propagation** — `ctx` is threaded into `parsePrimary(ctx)` and through arrow body parsing (`parseExpression(2, ctx)`). This ensures that `let f = x => x in body` correctly parses `x => x` as the binding value (the `in` is the let separator, not a binary op). To use `in` as a membership test inside a let binding, parenthesise: `let f = x => ("a" in arr) in body`.

## Testing

Tests live in `src/parser/parser.test.ts`. Run:

```bash
pnpm run test
pnpm run test:coverage
```

## Coverage

**Suppressed unreachable branch — `toBinaryOp` `default: throw`**

`toBinaryOp` has a defensive `default` throw: `throw new ParseError("Not a binary operator: ...", ...)`.
This branch is structurally unreachable: every token kind that `getLbp` returns non-zero for is either
handled explicitly in `parseLed` (Dot, QuestionDot, LBracket, LParen, PipeOp, Question) or mapped in
`toBinaryOp`. The branch exists as a type-safety guard in case `getLbp` and `parseLed` fall out of sync.

Suppressed in the source with `/* v8 ignore next -- @preserve */` inside the `default:` case.

**Suppressed rethrows of a foreign error** — `parse()` rethrows what is not a `LexError`,
`compileTextTemplate` what is not a `TemplateError` or `ParseError`. Their callees throw nothing else.
V8 ignore conventions: [Tests and coverage](../../AGENTS.md#tests-and-coverage).
