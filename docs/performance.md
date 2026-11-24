# Performance testing

How Tavnit keeps its performance: what is measured, how a pull request is gated and what the
numbers mean. Commands are in [AGENTS.md](../AGENTS.md#benchmarks).

A performance regression is caught by the lowest of four layers that can see it. The layers are
ordered from the cheapest and most reliable to the broadest.

## Layer 1: structural counters (hard gate, no timing)

`src/performance.test.ts` asserts the work Tavnit does, never the time it takes, so it cannot
flake. It runs with `pnpm test`.

| Optimisation | Counter asserted |
|---|---|
| sync/async routing | an expression with no `Resolver` root and no custom filter never calls `evaluateAsync` (`engine/routing.test.ts`) |
| sampled clock | fewer than 200 `Date.now` reads for a 5000-item `map`, on the sync and the async path |
| compile once | an expression, a text template and a value tree compile once however often they are evaluated (`Cache.metrics`) |
| formatter cache | `Intl.DateTimeFormat` is constructed once per locale, zone and part |
| `Temporal` source | the runtime's `Temporal` is used when present, the polyfill otherwise (`temporal.test.ts`) |
| no scope copies | a nested `map` never enumerates or copies the data context |
| context filters | marking a filter does not change its hidden class (a `WeakSet`, not a property) |

A change that adds an optimisation adds its counter here.

## Layer 2: the benchmark corpus (relative gate)

`bench/corpus.mjs` is a fixed set of cases, run with [Tinybench](https://github.com/tinylibs/tinybench)
against the built `dist`. It lives outside `src/` so it is neither compiled into the package nor held to
the coverage threshold; two tests in `src/performance.test.ts` keep `bench/` out of `src/` and `files`.

| Group | What it measures |
|---|---|
| parse (cold) | a short path, a 200-token expression with arrows, a text template with `${% for %}`, a value tree |
| evaluate (warm) | path read, arithmetic, pipe chains, `map` / `filter` / `sort` / `groupBy` over 1,000 items, strings, regex |
| datetime | `format`, `formatCalendar`, parsing and arithmetic, in both `Temporal` modes |
| context | context checks and a 10-level path |
| templates | a text template with a loop, a value tree shaped like a 50-card screen, a static template |
| routing | the same expression with and without a `Resolver`, and with a custom filter |
| engine | `createEngine`, `derive`, `compile` |
| errors | building an `ExpressionError` with a source excerpt |
| limits | the cost of the timeout and output checks on a large render |

Rules for a case:

- It measures one thing; setup stays outside the timed function.
- It is generic: no case depends on a particular application.
- Every engine of the corpus raises `timeoutMs`, because the 100 ms wall-clock guard is off by default
  and one stall must not abort a run. A case that needs more than the default limits raises those too.
- The suite prints the Node version, V8 version, `Temporal` source, CPU and platform with every result.
  A number without them is meaningless: Node 24 has no native `Temporal` and uses the polyfill, which
  costs about ten times more.

## Layer 3: the pull-request gate (A/B on one runner)

Absolute numbers from different CI runners do not compare: two runs of the same code on different
runners differ by up to 90%. The gate (`.github/workflows/bench.yml`) therefore compares two builds
on the same runner in the same job:

1. Build the merge base and the head in two directories.
2. Alternate the two builds for nine rounds (`bench/ab.mjs`), so drift hits both sides.
3. Take the median delta of each case and report it as a pull-request comment.

| Median delta of a case (head against base) | Result |
|---|---|
| slower than 25% | fails, while the repository variable `TAVNIT_BENCH_ENFORCE` is `true` |
| slower than 10% | warns |
| faster than 10% | noted |

Measured on the same code twice (A/A), the median of nine or more rounds stays within 1% of zero, but a
single round can be a 50% outlier, so the gate never decides on one round. A change under about 5%
cannot be told from noise. If the paired noise on `ubuntu-latest` grows above 10%, move the gate to
instruction counting (for example CodSpeed) or to a dedicated runner.

A case that needs an API the base build lacks fails the run. Add such a case together with the change
that adds the API, and set `TAVNIT_BENCH_SKIP` (a substring of the case name) to leave it out of one
comparison.

## Layer 4: memory (scheduled, not a gate)

`bench/memory.mjs` measures the heap retained after a forced GC for repeated evaluations, a large
`map`, the `Cache` after thousands of distinct expressions, and thousands of `derive()` calls. Each case has a bound of about three times the stable measurement.
A nightly job (`.github/workflows/bench-nightly.yml`) runs `node --expose-gc bench/memory.mjs --enforce`
on `main`, fails a case over its bound and keeps the JSON as an artefact for 90 days. Corpus timings are
not stored: they differ between runners, so a trend over them is noise.

## Finding a hotspot

Profile one case and read the Tavnit frames by self time:

```bash
node --cpu-prof --cpu-prof-dir=/tmp/prof bench/run.mjs --filter "50-card screen" --time 2000
```

Open the `.cpuprofile` in Chrome DevTools or speedscope. A real workload's profile is how a regression
is found; its cause then becomes a case in `bench/corpus.mjs` and, for an optimisation, a counter in
`src/performance.test.ts`.

## What earlier measurements taught

- Counting output bytes with `TextEncoder.encode` per appended piece made text templates 47–72% slower;
  `utf8Length` counts in place.
- Marking filters with a symbol property changed their hidden class and made the call site megamorphic
  (every filter call 14% slower). A `WeakSet` mark does not.
- A scope copy (`{ ...ctx }`) per lambda call cost a tenth of a list operation; `newEvalContext` builds
  the context field by field in one place.
- A generator per node in the synchronous `_` walk was slow; plain recursion made it about 40% faster.
- An early `Object.getPrototypeOf(v) === Object.prototype` answer in `isObject` was slower: the
  `instanceof` chain is cheap when its checks are monomorphic.
- A reused expression that once met a `Resolver` keeps its async routing: about 566 ns per call against
  195 ns for one that never did (2.9×). A change to the routing policy needs a paired case first.
- Tinybench's median is quantised by the macOS timer (about 42 ns), so the scripts compare means.

## Other engines

Most JavaScript template engines ship a throughput script and no regression gate. Handlebars measures
size and compile cost beside throughput; `template-benchmarks-rs` fixes one template set across engines;
cel-go benchmarks parse, check and evaluate as separate phases. Tavnit does the same with a fixed corpus
and compares two builds, never a stored absolute number. A cross-engine table would be context for the
README, never a gate, because the semantics differ.
