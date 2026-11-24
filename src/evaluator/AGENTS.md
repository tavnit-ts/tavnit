# Tavnit Evaluator

## Design Notes

- **Sync core, async on demand** — `evaluate()` is synchronous and rejects async
  filters. `evaluateAsync()` awaits `Resolver` values on member/index access; the
  engine routes to it an expression that names a `Resolver` root or a custom filter
  ([`Resolver` routing](../engine/AGENTS.md)).
- **Step budget and sampled timeout** — `chargeStep` runs at every node: it decrements `EvalContext.steps` and throws
  `TAV_LIMIT_STEPS` at zero, a deterministic bound. Only when `timeoutMs` is finite does it call `checkTimeoutSampled`,
  which reads the clock at the first node and then every 256 nodes (`EvalContext.timeoutCheck`); `Date.now()` per node
  cost more than the node. An awaited filter or `Resolver` result is checked on return (`awaitedWithinBudget`).
- **Pipe → Call normalisation** — `PipeNode` is not evaluated directly; it is
  normalised at evaluation time to a function call: `left | callee(args)` becomes
  `callee(left, ...args)`. The parser keeps `PipeNode` distinct for readability.
- **Absent context keys return `null`** — if a top-level identifier is not
  present in `DataContext`, the evaluator returns `null` (not a thrown error) — unless `ctx.semantics.strict`, where
  `evaluateIdentifier` throws `TAV_UNKNOWN_NAME` with the nearest name (`nearest` in `errors.ts`), and
  `evaluateMember` / `evaluateIndex` throw `TAV_UNKNOWN_PROPERTY` for a field or a property that is not there. The left
  side of `??` (a name, a member or an index) is evaluated with `withLenientReads`, so an explicit default tolerates
  the miss. An array index out of range stays `null` in both modes.
  This matches [Null and Error Propagation](../../docs/skills/tavnit/references/language.md#null-and-error-propagation). Exception: if the name IS
  in the filter registry, a native-filter wrapper `FunctionValue` is returned so
  that filter names can be passed as values to higher-order built-ins.
- **`undefined` is `null`** — `evaluate()` / `evaluateAsync()` map a node's `undefined`,
  from a host value or a filter, to `null`, so no other code handles `undefined`.
- **Data-context values are not callable** — `Call` and `Pipe` nodes always look
  up the callee in `FilterRegistry`. Data-context values are never callable. The lookup
  takes own properties only, so an `Object.prototype` member such as `toString` is none.
- **Dot access on arrays/primitives returns null** — accessing `.prop` on an
  array or a primitive (string, number, boolean) returns `null`. Bracket index
  access on arrays uses `Math.trunc()` for fractional indices. Out-of-bounds
  indices also return `null`.
- **`in` operator** — needle `in` string: substring test; needle `in` array:
  strict-equality scan. Any other right-hand side type throws.
- **Short-circuit operators** — `&&`, `||`, `??` evaluate the right operand only
  when needed, matching TypeScript semantics.
- **`maxDepth` guard** — checked at entry to each `evaluate()` call. The depth
  counter starts at 1 and increments by 1 per recursive call. Also checked at the
  `let … in` node boundary.
- **Arrow / `FunctionValue` shape** — `{ params, body, closure, locals }`. `closure` is
  the data context and `locals` the arrow parameters and `let`-bound names in scope
  when the arrow was created.
- **Scope chain** — `EvalContext.locals` links the arrow parameters and `let` bindings
  in scope over `data`, which is never copied: an arrow call or a `let` binding adds one
  `Locals` link, and `evaluateIdentifier` walks the chain before `data`. Copying the whole
  scope into each call cost more than evaluating the body.
- **`EvaluationError`** — named `EvaluationError` (not `EvalError`) to avoid
  shadowing the ECMAScript built-in `EvalError` global.
- **`FunctionValue`** — arrow expressions produce `FunctionValue` instances
  that close over `ctx.data` at creation time. `callFunctionValue` evaluates the body
  in the closure scope. When `nativeFn` is set on a `FunctionValue`, it wraps a
  registered `FilterFn`/`ContextFilterFn` and delegates directly to it (no body
  evaluation). This enables `items | filter(eligible)` where `eligible` is a registered
  filter name rather than a `let`-bound arrow.
- **`invokeFn` on `EvalContext`** — collection builtins receive `EvalContext` and call
  `ctx.invokeFn(fn, args)` to invoke a `FunctionValue`. This avoids a circular import
  between `collections.ts` and `evaluate.ts`. The invoker is injected by `evaluateCall`
  before dispatching to any `ContextFilterFn`, capturing the current depth.
- **FunctionValue restrictions** — evaluating an `array` or `object` literal whose
  elements include a `FunctionValue` throws immediately. Rendering a span whose result
  is a `FunctionValue` also throws (caught in `valueToString`).
- **`valueTemplate` (synthetic node)** — a compiled `_` body. `evaluate()` and `evaluateAsync()`
  walk it with `value-template.ts`, the same code the engine uses for the whole tree, evaluating
  its leaves in the host's scope. The walk is one generator that yields each leaf; the sync and
  async drivers only differ in whether they await it, so a tree has one set of rules.
- **`Resolver` (lazy async context root)** — a branded opaque value placed in `DataContext`.
  When the evaluator encounters a member or index access on a `Resolver`, it calls
  `resolver.fn(key)` and awaits the result. The sync `evaluate()` throws `EvaluationError`
  if it encounters a `Resolver` in member/index position; the engine routes to `evaluateAsync()`
  when `hasResolver(context)` is true. `Resolver` is part of the `Value` union (like
  `FunctionValue`) so it can travel through `let` bindings and ternaries.
  Arrow function bodies inside collection builtins (`filter`, `map`, `sort`, etc.) also
  support Resolver access — `evaluateCallAsync` injects `callFunctionValueAsync` as `invokeFn`
  and sets `ctx.asyncMode = true`, causing collection builtins to switch to async iteration.
- **`callFunctionValueAsync(fn, args, ctx, depth)`** — async mirror of `callFunctionValue`
  that evaluates the arrow body with `evaluateAsync`, enabling Resolver access inside arrows.
  Used exclusively by `evaluateCallAsync`.
- **`evaluateCallAsync(callee, args, ctx, depth)`** — async mirror of `evaluateCall` that
  injects `callFunctionValueAsync` as `invokeFn` and sets `asyncMode: true`. Collection
  builtins detect `asyncMode` and switch to async iteration (for loops + await).
- **`evaluateBinaryValues(op, left, right)`** — extracted helper that applies a binary
  operator to already-evaluated operands. Shared between the sync `evaluateBinary()` and
  the async `evaluateBinaryAsync()` to avoid duplicating the operator logic.

## Files

| File | Purpose |
|---|---|
| `types.ts` | `Value`, `FunctionValue`, `Resolver`, `resolve`, `DataContext`, `FilterFn`, `FilterRegistry`, `RuntimeLimits`, `EvalContext`, `EvaluationError`, the date/time wrappers, `typeName` |
| `restricted.ts` | `RESTRICTED` set — prototype-restriction name list shared with parser and engine |
| `evaluate.ts` | `evaluate(node, ctx, depth?)`, `evaluateAsync(node, ctx, depth?)`, `callFunctionValue(fn, args, ctx, depth)` — sync and async tree-walking evaluators |
| `value-template.ts` | Walk of a compiled value tree: guards, spreads, null-key dropping, error `path`s |
| `text-template.ts` | Executor of a compiled text template (`${% if/for %}`, output limit): `evaluateTextTemplate` and its synchronous twin `evaluateTextTemplateSync`, kept in step |
| `stringify.ts` | `valueToString` — text-embedding conversion shared by text templates and `_` bodies |
| `evaluator.test.ts` | All node kinds, operators, edge cases, and Resolver sync guards |

## Testing

```bash
pnpm run test
pnpm run test:coverage -- src/evaluator
```

## Coverage

Nothing is left uncovered; unreachable code is suppressed — V8 ignore conventions:
[Tests and coverage](../../AGENTS.md#tests-and-coverage).

**Suppressed unreachable code**

- **`invokeFnForNative` lambda bodies in `callFunctionValue` and `callFunctionValueAsync`** — the lambda is
  assigned (covered) but its body only executes if a `ContextFilterFn` calls `ctx.invokeFn()` with a
  `FunctionValue` argument. No built-in does this. Suppressed with `/* v8 ignore start/stop -- @preserve */`
  wrapping the `const invokeFnForNative = …` declaration. Note: placing the hint *inside* the arrow after `=>`
  does not work — esbuild may reorganise the output and the comment loses its position relative to the branch.
  Wrapping the whole `const` with `start/stop` is the reliable approach.
- **`evaluateUnary` `default: throw` guard** — structurally unreachable: the parser only emits
  `"!" | "not" | "-"`. Both `evaluateUnary` and `evaluateBinaryValues` accept `op: string` (not the narrow
  union), so TypeScript does not enforce exhaustiveness — the throw is a runtime safety net if the parser and
  evaluator ever fall out of sync. Suppressed with `/* v8 ignore next -- @preserve */`.
- **`evaluateBinaryValues` `default: throw` guard** — same reasoning. Suppressed with
  `/* v8 ignore next -- @preserve */`.
- **`locate()` in `value-template.ts`, an error that is not an `EvaluationError`** — every error
  reaching it is an `ExpressionError` or, via `atNode`, an `EvaluationError`. Suppressed with
  `/* v8 ignore start/stop -- @preserve */`.
