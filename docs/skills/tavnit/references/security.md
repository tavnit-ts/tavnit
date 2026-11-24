## Security

<!-- contents -->
**Contents**

- [Grammar Restrictions](#grammar-restrictions)
- [Runtime Limits](#runtime-limits)
- [Temporal Object Safety](#temporal-object-safety)
- [Process Isolation](#process-isolation)
- [Secret Values in Diagnostics](#secret-values-in-diagnostics)
<!-- /contents -->

Safety is structural, not runtime-guard-based. The expression grammar forbids
dangerous patterns by construction; configurable runtime limits bound resource
use.

### Grammar Restrictions

- **No prototype access** — property access is resolved against a controlled
  data context. `__proto__`, `constructor`, `prototype`, `__defineGetter__`,
  and similar names are rejected at parse time for static access (`obj.constructor`,
  `obj["constructor"]`), by `path()` for dynamic dot-paths, and for filter names
  at engine construction. A dynamic key (`obj[k]` with `k == "__proto__"`)
  resolves via `Object.hasOwn`, so it returns `null` rather than an error — the
  prototype is never reachable either way.
- **No callable values from data** — only registered functions (built-ins +
  custom filters) may appear in call position. A `let`-bound function value can
  only be passed to a higher-order builtin (`map(f)`), never called by name:
  `let f = x => x + 1 in f(2)` fails with `Unknown function 'f'`. Data-context
  values are never callable, even if they happen to carry the function type.
  An `Object.prototype` member name — `toString`, `valueOf` — is no function
  either: `toString(1)` fails with `Unknown function 'toString'`.
- **No global scope** — the evaluator receives only the host-supplied data
  context and the function registry. `global`, `globalThis`, `window`,
  `process`, `require`, and `import` are not reachable.
- **No recursive functions** — `let`-bound names are not in scope inside their
  own binding body, so a lambda cannot call itself. Mutual recursion is
  similarly impossible.
- **No statements** — the grammar is expressions only: no loops, no assignment,
  no free-standing declarations. `let … in` binds a name for one expression and
  `=>` defines a function value, but neither can be used as a statement — see
  [Block Tags](block-tags.md#block-tags) for loops over templates.

### Runtime Limits

Resource limits are configured per engine instance — see
[Engine Instantiation and Isolation](typescript-api.md#engine-instantiation-and-isolation) for the full options interface.
Seven limits apply. Two budgets are deterministic and always on: `maxIterations` counts data items, and
`maxSteps` counts expression nodes. The same template and data stop at the same point on any machine,
loaded or idle. `timeoutMs` is the one wall-clock limit, and it is off unless the host sets it.

| Option | Default | Effect |
|---|---|---|
| `maxDepth` | 50 | Maximum expression nesting depth — prevents deep recursive path traversal |
| `maxIterations` | 1 000 000 | Maximum items processed in **one engine call** — a single counter decremented by every element visited across all collection operations (`map`, `filter`, `reduce`, `flatMap`, `sort`, `uniqBy`, `groupBy`, and similar) and by every `${% for %}` iteration. The counter is shared across all steps in a pipe chain, all spans of a template and all leaves of a value tree, and is never reset inside the call. This prevents O(n²) work from chained filters on large arrays. |
| `maxSteps` | 10 000 000 | Maximum expression nodes one engine call may visit, counted across the same scope as `maxIterations`. It bounds the CPU time of lambdas and long expressions deterministically. |
| `timeoutMs` | off | Opt-in wall-clock limit per engine call, in milliseconds. A host guard against a filter that stalls; a result then depends on the machine's load. |
| `maxOutputBytes` | 1 048 576 | Cumulative rendered output of one `render()` / `renderObject()` call |
| `maxStringLength` | 10 000 000 | Longest string a built-in may produce (`padStart`, `padEnd`, `replace`, `replaceAll`, `append`, `indent`, `join`, `joinFilled`), in UTF-16 units |
| `maxRegexInput` | 100 000 | Longest subject `matches` / `capture` / `captures` accept with `regex: "native"`, in UTF-16 units; the linear engine has no cap |

`maxStringLength`, `maxRegexInput` and `maxSteps` must be positive integers: any other value makes
`createEngine()` or `derive()` throw a `RangeError`.

**The unit of `maxIterations` is the engine call, not the loop.** One `evaluate()`, `render()` or
`renderObject()` call has one iteration budget and one step budget. A `map` over 100 000 items spends
100 000 iterations of the default 1 000 000, a nested `${% for %}` of 200 × 200 spends 40 000, and a render
whose spans each walk the same list spends the sum. A host that wants a per-loop bound lowers
`maxIterations` and renders in separate calls. Every limit error names the limit, its value and the
option that raises it (`Iteration limit 1000000 exceeded; raise maxIterations`), and its diagnostic
carries the same as `limit`, `value` and `option` with a `TAV_LIMIT_*` code.

Two rules are fixed and not configurable:

- **Parse depth** — 500 nested levels (also a chain such as `1+1+…`), so a hostile
  source fails with a message instead of exhausting the stack.
- **Regular expressions** — `matches` / `capture` / `captures` run a linear-time engine
  (RE2 syntax) by default: no pattern backtracks, so none can exhaust the CPU, and the subject
  has no length cap. With `regex: "native"` they run JavaScript's `RegExp`, which cannot be
  interrupted by `timeoutMs`; there the subject is at most `maxRegexInput` characters, and a pattern that
  repeats a group holding an alternation, another repeat or a backreference (`(a|aa)+`) is
  refused. The residual risk — polynomial patterns such as `a*a*a*$` on a long subject — exists
  only in native mode.

`maxOutputBytes` bounds **rendered** output only. A bare `engine.evaluate()` has
no output cap — `evaluate("json(huge)")` can return a string of any size. Cap
expression results at the host boundary when that matters.

**When to raise limits.**
The defaults are sized for single-module expressions over small-to-medium data:

- `maxIterations: 1_000_000` is sized for a `filter → map → sort` pipeline over
  a list of 100 000 items (each element visits the counter once per
  operation, so `filter + map` over 1 000 items costs ~2 000 iterations).
  Lower it for a host that renders untrusted templates; raise it for batch
  exports through many chained collection operations.
- `maxSteps: 10_000_000` allows about ten passes of a small lambda over 100 000 items.
  Lower it to bound the CPU time of untrusted templates: the cost of a step does not
  depend on the data, so the bound is the same on every machine.
- `maxDepth: 50` rarely needs changing. It applies to expression nesting (nested
  function calls, deeply chained pipes), not to data depth. Only raise it if the
  error `Recursion depth limit 50 exceeded; raise maxDepth` appears for a legitimately complex
  expression.
- `timeoutMs` is off by default, because a wall-clock limit makes the same template pass on an idle machine
  and fail on a loaded one. Set it as a host safeguard when custom **async filters** can stall. Async
  filters only run when the data context contains a `Resolver` (the async path); without one, calling an
  async filter throws `Filter 'x' is async — use engine.evaluate() for async filter support`. On the async
  path the budget is checked between AST nodes, so a final awaited filter is not interrupted — only a
  following node triggers the timeout error. The synchronous path reads the clock at the first node and
  then every 256 nodes; with `timeoutMs` unset it reads the clock never.

> **Note: cooperative timeout.** `timeoutMs` enforcement is cooperative: the
> evaluator checks elapsed time between AST nodes but cannot interrupt a
> synchronous filter function mid-execution. A custom filter that runs a tight
> synchronous loop will exceed `timeoutMs` without being stopped. For preemptive
> hard-timeout enforcement, run the evaluator in a Worker thread and call
> `worker.terminate()`. See [Process Isolation](#process-isolation).

### Temporal Object Safety

Temporal types are safe to expose in Tavnit because:

- **`epochNanoseconds` is not reachable** — the actual `Temporal.Instant`
  property is a `BigInt` that could overflow numeric guards. The opaque wrapper
  never exposes it; `toEpochMs()` returns a regular `number`.
- **`Temporal.Now` is not in scope** — the global `Temporal` namespace is not
  accessible in the expression context. `now()` and `today()` are the only
  entry points, and they are registered Tavnit functions, not global object
  access.
- **No method calls on data values** — authors cannot call `.add()` directly on
  a date value from context. The pipe form routes through registered filter
  functions, not the Temporal prototype.

### Process Isolation

**Custom filter functions are unrestricted.** The [filter registry](typescript-api.md#filter-registration) extension API
registers plain functions. The evaluator controls which functions are callable
and how they are dispatched, but not what they do internally. A buggy or
malicious filter runs in the same process with access to everything the process
can reach.

**Why JS sandbox libraries do not apply.** vm2, SES compartments, and
`vm.runInNewContext` are designed for cases where an untrusted JavaScript string
is evaluated with `eval` or `new Function`. Tavnit's evaluator never does this —
it walks an AST and resolves values through a controlled resolver. There is no
generated JavaScript for a sandbox library to intercept.

**What Worker-based isolation adds.** Running the evaluator in a Worker thread
provides two properties that grammar restrictions alone cannot:

- **Preemptive timeout** via `worker.terminate()` — the only way to enforce a
  hard wall-clock limit that cannot be bypassed by a synchronous spin loop.
- **Process-level containment** of evaluator bugs: a resolver edge case damages
  only the Worker's memory, not the host process.

The cost is data serialisation on every invocation: the entire data context
must cross the Worker boundary via `structuredClone`. Async filters that call
back into the host become message-passing round-trips.

**Practical position.** For developer-authored expressions with trusted filters,
process isolation is not required. The lightweight complement to grammar
restrictions is deep-freezing the data context before evaluation:

```typescript
const frozenContext = deepFreeze(dataContext);
await engine.evaluate(expression, frozenContext);
```

This prevents any filter or resolver bug from mutating input data at negligible
cost. For user-provided expressions in an adversarial context, a Worker is the
option for preemptive timeout enforcement.

### Secret Values in Diagnostics

If the host stores secrets in the data context (API keys, tokens, passwords),
evaluation errors must not leak those values into diagnostic messages. The
`secretRoots` engine option declares which top-level context keys must be
treated as secret:

```typescript
const engine = createEngine({
  secretRoots: ["env", "secrets"],
});
```

When an error occurs during evaluation, the value of a declared secret root is
replaced with `[redacted]` in `Diagnostic.message`. The raw expression source is
preserved as-is in `SourceLocation.source` — only interpolated runtime values
are redacted.

**Redaction is shallow: it covers the root value only, and only when it is a
non-empty string.** A nested secret (`secretRoots: ["env"]` with
`env = { API_KEY: "…" }`) reaches `env.API_KEY` unredacted, and object / array /
number roots are not redacted at all. Keep each secret in its own top-level
string key, or keep secrets out of the data context entirely:

`secretRoots` defaults to `[]`. Hosts that store secrets in the data context
must set it at engine creation time; derived engines inherit the parent's
`secretRoots` unless overridden.

The engine has no tenant awareness. `env`, `secret`, and every other context
root are supplied by the host, so a multi-tenant host must put a per-tenant
value under each root and must never pass the raw `process.env`.

**`secretRoots` and `derive()` — override replaces, not merges.**
When `derive()` specifies `secretRoots`, the value **replaces** the parent's
list entirely — there is no automatic union. To protect both parent and
child roots, include all of them in the derived option:

```typescript
const globalEngine = createEngine({
  secretRoots: ["env"],           // "env" is redacted globally
});

// Adds "secrets" protection — must repeat "env" or it will be unprotected
const moduleEngine = globalEngine.derive({
  secretRoots: ["env", "secrets"],
});

// Inherits globalEngine's ["env"] — no secretRoots override
const otherEngine = globalEngine.derive({
  filters: { eligible },
  // secretRoots not specified → inherits ["env"] from parent
});
```
