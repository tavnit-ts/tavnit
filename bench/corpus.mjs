// The fixed benchmark corpus of docs/performance.md, Layer 2.
// Generic by design: no case depends on a particular application.
import { pathToFileURL } from "node:url";

/** @typedef {{ group: string, name: string, fn: () => unknown }} Case */

/** @param {string} dist Absolute path of the build to measure. @returns {Promise<Case[]>} */
export async function buildCorpus(dist) {
  const tavnit = await import(pathToFileURL(`${dist}/index.js`).href);
  // The parser moved to the `internal` entry; a build from before the split still has it in the root.
  const internal = await import(pathToFileURL(`${dist}/internal.js`).href).catch(() => tavnit);
  const { createCache, createEngine } = tavnit;
  const { parse, parseTextTemplate, parseValueTemplate } = internal;
  const resolve = tavnit.resolve;

  // The default timeoutMs (100) is wall-clock: one GC pause or a loaded runner aborts a case, and a case with no
  // result fails the whole run. Every engine here raises it; it changes no case's cost.
  const generous = { timeoutMs: 60_000 };
  const engine = createEngine(generous);
  const items = Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    group: `g${i % 10}`,
    score: (i * 7919) % 1000,
    active: i % 2 === 0,
    name: `item-${i}`,
  }));
  const cards = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    title: `Card ${i}`,
    done: i % 3 === 0,
    tags: ["a", "b", "c"],
    owner: { name: `Owner ${i % 7}`, email: `o${i % 7}@example.test` },
    start: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00Z`,
  }));
  const context = { user: { profile: { name: "Anna", age: 31 } }, items, cards, a: 3, b: 4, text: "  The quick brown fox, 42 jumps  " };

  const bigExpression = [
    "items",
    "| filter(x => x.active && x.score > 100 && (x.group == 'g1' || x.group == 'g2' || x.group == 'g3'))",
    "| map(x => ({ id: x.id, label: x.name | toUpperCase | trim, rank: x.score * 2 + 1 }))",
    "| sort(x => x.rank)",
    "| map(x => x.id)",
    "| size",
  ].join(" ");

  const textTemplate = "${% for card in cards %}${{ forloop.index1 }}. ${{ card.title }}${% if card.done %} (done)${% endif %}\n${% endfor %}";
  const screenTree = {
    title: "Cards",
    count: "${{ cards | size }}",
    rows: "${{ cards | map(c => _) }}",
    _: {
      "...": "${{ c }}",
      key: "row-${{ c.id }}",
      type: "Row",
      $if: "${{ c.id >= 0 }}",
      props: { text: "${{ c.title }}", subtitle: "${{ c.owner.name }}", done: "${{ c.done }}" },
    },
    footer: ["static", "${{ a + b }}", { text: "total ${{ cards | size }}" }],
  };
  const tree50 = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, `v \${{ a + ${i} }}`]));
  const staticTree = { a: 1, b: ["x", "y", { c: true }], d: { e: "plain" } };

  const pre = {
    screen: engine.parseValueTemplate(screenTree),
    text: engine.parseTextTemplate(textTemplate),
    static: engine.parseValueTemplate(staticTree),
    tree50: engine.parseValueTemplate(tree50),
  };

  const state = resolve(async (key) => (key === "y" ? 2 : null));
  const ruEngine = createEngine({ ...generous, filters: { twice: (v) => v * 2 } });
  const asyncEngine = createEngine({ ...generous, filters: { twice: async (v) => v * 2 } });
  const withState = { ...context, state };
  const moscow = 'instant("2026-09-25T15:34:00Z") | toZonedDateTime("Europe/Moscow")';
  const reference = 'instant("2026-09-26T19:00:00Z")';


  // Data and engines of the second wave of cases. The limits are raised: these cases measure
  // work the defaults would refuse (maxIterations 10,000, timeoutMs 100).
  const big = createEngine({ maxIterations: 10_000_000, timeoutMs: 60_000, maxOutputBytes: 1_100_000 });
  const rows500 = Array.from({ length: 500 }, (_, i) => ({ id: i, k: `k${i % 50}`, b: i * 2, x: i % 17, y: i % 13 }));
  const lookup = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, [{ a: i, b: i + 1 }, { a: i + 100 }]]));
  const ids100 = Array.from({ length: 100 }, (_, i) => i * 10);
  const keysObject = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`item-${i * 10}`, i]));
  const mixedStamps = Array.from({ length: 500 }, (_, i) => ({
    ts: i % 3 === 0 ? 1_700_000_000_000 + i * 3_600_000 : i % 3 === 1 ? `${1_700_000_000_000 + i * 3_600_000}` : new Date(1_700_000_000_000 + i * 3_600_000).toISOString(),
  }));
  const rows46k = Array.from({ length: 46_000 }, (_, i) => i);
  const rows300 = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `Row ${i}`, group: `g${i % 7}` }));
  const byId = Object.fromEntries(rows300.map((r) => [r.id, [{ n: 1 }, { n: 2 }]]));
  const wideKeys = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}`, i % 2 === 0 ? `\${{ r.name }}-${i}` : `\${{ c.n + r.id + ${i} }}`]));
  const nestedHole = { out: "${{ rows | flatMap(r => ((byId[r.id] ?? []) | map(c => _))) }}", _: wideKeys };
  const nestedHoleTree = engine.parseValueTemplate(nestedHole);
  const sameTree = JSON.parse(JSON.stringify(screenTree));
  engine.parseValueTemplate(sameTree);
  const staticText = "lorem ipsum dolor sit amet ".repeat(20_000 / 27 | 0);
  const staticWide = { items: Array.from({ length: 2000 }, (_, i) => (i % 2 === 0 ? i : `leaf-${i}`)) };
  const staticWideTree = engine.parseValueTemplate(staticWide);
  const staticTextTree = engine.parseValueTemplate({ text: staticText });
  const payload50k = { entries: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `entry-${i}`, tags: ["alpha", "beta", "gamma"], note: "x".repeat(40), score: i * 3.5 })) };
  const items10k = Array.from({ length: 10_000 }, (_, i) => ({ id: i, score: (i * 7919) % 10_000, active: i % 3 !== 0 }));
  const deep = (() => {
    let node = { leaf: 42 };
    for (let i = 9; i >= 0; i--) node = { [`l${i}`]: node };
    return node;
  })();
  const freshRows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, kind: "message", text: `hello ${i}`, meta: { a: 1, tags: ["a", "b"] }, who: { name: "n", phone: null } }));
  const comparatorRows = Array.from({ length: 200 }, (_, i) => ({ x: (i * 31) % 97, y: (i * 17) % 89 }));
  const nativeRegex = createEngine({ ...generous, regex: "native" });
  const text50k = `${"lorem ipsum dolor sit amet ".repeat(1850)}needle42`;
  const hostEngine = engine.derive({ filters: { shout: async (v) => `${v}!` } });
  const resolverState = resolve(async (key) => ({ [key]: key.length }));
  const resolverContext = { ...context, state: resolverState };

  /** Expressions that go through the engine and the cache, warm. */
  const ev = (group, name, source, data = context, eng = engine) => ({
    group,
    name,
    source,
    fn: () => eng.evaluate(source, data),
  });

  return [
    // lex and parse, cold: no cache is involved
    { group: "parse (cold)", name: "10-token path", fn: () => parse("user.profile.name | toUpperCase | trim") },
    { group: "parse (cold)", name: "200-token expression with arrows", fn: () => parse(bigExpression) },
    { group: "parse (cold)", name: "text template with for and if", fn: () => parseTextTemplate(textTemplate) },
    { group: "parse (cold)", name: "50-key value tree", fn: () => parseValueTemplate(tree50) },
    { group: "parse (cold)", name: "screen tree with _ hole", fn: () => parseValueTemplate(screenTree) },
    { group: "parse (cold)", name: "engine with a fresh cache, one expression", fn: () => createEngine({ cache: createCache() }).parse("a + b") },

    // evaluate, warm and cached
    ev("evaluate", "path read", "user.profile.name"),
    ev("evaluate", "arithmetic", "(a + b) * 2 - a / b"),
    ev("evaluate", "pipe chain of 5", "user.profile.name | toUpperCase | trim | toLowerCase | toUpperCase | size"),
    ev("evaluate", "filter, map, size over 1000", "items | filter(x => x.active) | map(x => x.id) | size"),
    ev("evaluate", "sort over 1000", "items | sort(x => x.score) | first"),
    ev("evaluate", "groupBy over 1000", "items | groupBy(x => x.group) | keys | size"),
    ev("evaluate", "200-token expression over 1000", bigExpression),
    ev("evaluate", "string builtins", "text | squish | split(' ') | map(w => w | toUpperCase) | join('-')"),
    ev("evaluate", "regex builtins", "items | filter(x => x.name | matches('^item-[0-9]*7$')) | size"),
    ev("evaluate", "record literal", "({ a: a, b: b, c: [a, b, a + b], d: { e: user.profile.name } })"),

    // datetime, in the Temporal the process runs on
    ev("datetime", "format an Instant", 'instant("2026-09-25T15:34:00Z") | format("yyyy-MM-dd HH:mm")'),
    ev("datetime", "formatCalendar, warm", `${moscow} | formatCalendar(${reference}, "ru")`),
    ev("datetime", "parse and add a duration", 'instant("2026-09-25T15:34:00Z") | add({ days: 3 }) | toEpochMs'),
    ev("datetime", "format 50 dates", 'cards | map(c => instant(c.start) | toZonedDateTime("Europe/Moscow") | formatCalendar(instant("2026-09-26T19:00:00Z"), "ru")) | size'),

    // templates, pre-compiled
    { group: "templates", name: "text template, 50-iteration loop", fn: () => engine.render(textTemplate, context) },
    { group: "templates", name: "50-card screen tree", fn: () => engine.evaluate(pre.screen, context) },
    { group: "templates", name: "50-key value tree", fn: () => engine.evaluate(pre.tree50, context) },
    { group: "templates", name: "template of literals", fn: () => engine.evaluate(pre.static, {}) },

    // routing: the same work down the sync and the async path
    ev("routing", "sync, no Resolver in context", "(items | map(x => x.id) | size) + a"),
    ev("routing", "sync, Resolver present but unused", "(items | map(x => x.id) | size) + a", withState),
    ev("routing", "async, names a Resolver", "(items | map(x => x.id) | size) + state.y", withState),
    ev("routing", "custom sync filter", "items | map(x => x.id | twice) | size", context, ruEngine),
    ev("routing", "custom async filter with a Resolver", "items | map(x => x.id | twice) | size", withState, asyncEngine),

    // engine
    { group: "engine", name: "createEngine", fn: () => createEngine() },
    { group: "engine", name: "derive", fn: () => engine.derive() },
    { group: "engine", name: "compile an arrow (cached)", fn: () => engine.compile("(x) => x + 1") },

    // the failure path stays cheap
    {
      group: "errors",
      name: "runtime error with a source excerpt",
      fn: async () => {
        try {
          await engine.evaluate("user.profile.name | nope()", context);
        } catch {
          /* the cost of building the error is what is measured */
        }
      },
    },
    {
      group: "errors",
      name: "syntax error with a source excerpt",
      fn: () => {
        try {
          parse("a +* b");
        } catch {
          /* idem */
        }
      },
    },

    // limits: the clock and output checks on a large render
    ev("limits", "5000-item map, timeout sampled", "range5000 | map(x => x + 1) | size", { range5000: Array.from({ length: 5000 }, (_, i) => i) }),
    {
      group: "limits",
      name: "2000-row text template, output limit checked",
      fn: () => engine.render("${% for i in rows %}row ${{ i }} of the table\n${% endfor %}", { rows: Array.from({ length: 2000 }, (_, i) => i) }),
    },

    // regular expressions: the linear engine (the default) against the JavaScript one
    ev("regex", "matches, a date, linear", "'2026-11-07' | matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')", {}, engine),
    ev("regex", "matches, a date, native", "'2026-11-07' | matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')", {}, nativeRegex),
    ev("regex", "captures, a date, linear", "'2026-11-07' | captures('([0-9]{4})-([0-9]{2})-([0-9]{2})')", {}, engine),
    ev("regex", "captures, a date, native", "'2026-11-07' | captures('([0-9]{4})-([0-9]{2})-([0-9]{2})')", {}, nativeRegex),
    ev("regex", "matches in a 50 KB text, linear", "text50k | matches('needle[0-9]+')", { text50k }, engine),
    ev("regex", "matches in a 50 KB text, native", "text50k | matches('needle[0-9]+')", { text50k }, nativeRegex),
    ev("regex", "near miss of a nested repeat, linear", "s | matches('(a|aa)+$')", { s: `${"a".repeat(41)}!` }, engine),

    // second wave: generic shapes seen in large template workloads
    { group: "templates", name: "parseValueTemplate, tree already seen (same object)", fn: () => engine.parseValueTemplate(sameTree) },
    { group: "templates", name: "parseValueTemplate, equal fresh copy (clone included)", fn: () => engine.parseValueTemplate(JSON.parse(JSON.stringify(screenTree))) },
    { group: "templates", name: "_ hole, 300 rows x 15 keys, nested lambda", fn: () => big.evaluate(nestedHoleTree, { rows: rows300, byId }) },
    { group: "templates", name: "static 20 KB string through evaluate", fn: () => big.evaluate(staticTextTree, {}) },
    { group: "templates", name: "static tree of 2000 leaves through evaluate", fn: () => big.evaluate(staticWideTree, {}) },
    ev("evaluate", "let and ternary per row over 500", "rows | map(r => (let i = first(m[r.k] ?? []) in (i != null ? i.a : r.b))) | size", { rows: rows500, m: lookup }, big),
    ev("evaluate", "x in array of 100, filter over 1000", "items | filter(x => x.id in ids) | size", { items, ids: ids100 }, big),
    ev("evaluate", "x in keys of an object, filter over 1000", "items | filter(x => x.name in (obj | keys)) | size", { items, obj: keysObject }, big),
    ev("evaluate", "keyBy, uniqBy, flatMap over 1000", "((items | keyBy(x => x.id) | keys | size) + (items | uniqBy(x => x.group) | size) + (items | flatMap(x => [x.id, x.score]) | size))", context, big),
    ev("evaluate", "reduce, find, concat, slice over 1000", "((items | reduce((acc, x) => acc + x.score, 0)) + (items | find(x => x.id == 999)).score + (items | concat(items) | slice(500, 1500) | size))", context, big),
    ev("evaluate", "comparator sort over 200", "rows | sort((a, b) => (b.x + b.y) - (a.x + a.y)) | first", { rows: comparatorRows }, big),
    ev("evaluate", "sha256 of a ~50 KB json", "payload | json | sha256", { payload: payload50k }, big),
    ev("evaluate", "btoa of a ~50 KB json", "payload | json | btoa", { payload: payload50k }, big),
    ev("evaluate", "sort and filter over 10,000", "items | filter(x => x.active) | sort(x => x.score) | size", { items: items10k }, big),
    ev("evaluate", "10-level deep path read", "d.l0.l1.l2.l3.l4.l5.l6.l7.l8.l9.leaf", { d: deep }, big),
    ev(
      "datetime",
      "guarded epoch or ISO to formatted date over 500",
      "rows | map(r => ((r.ts | str | matches('^[0-9]+$')) ? (r.ts | num | toInstant) : (r.ts | toInstant)) | toZonedDateTime('Europe/Moscow') | format('yyyyMMdd')) | size",
      { rows: mixedStamps },
      big,
    ),
    ev("datetime", "now to zoned date, formatted", "now() | toZonedDateTime('Europe/Moscow') | format('yyyyMMdd HH:mm')"),
    ev("datetime", "PlainDate plus a day, formatted", "'2026-09-25' | toPlainDate | add({ days: 1 }) | format('yyyyMMdd')"),
    { group: "routing", name: "async host filter inside map over 500, derived engine", fn: () => hostEngine.evaluate("rows | map(r => r.id | shout) | size", { rows: rows500, state: resolverState }) },
    ev("routing", "Resolver reads inside a 100-iteration map", "range | map(i => state.abc.abc) | size", { ...resolverContext, range: Array.from({ length: 100 }, (_, i) => i) }, big),
    // A host builds a new context for every call and shares only its large parts, so the context check meets
    // new objects each time; a case that reuses one context object hides that cost behind the identity cache.
    { group: "context", name: "fresh wrapper, shared 1000-item list", fn: () => big.evaluate("items | size", { items, args: { n: 1 } }) },
    { group: "context", name: "fresh wrapper, fresh 200 small records", fn: () => big.evaluate("rows | size", { rows: freshRows(200), args: { n: 1 } }) },
    { group: "context", name: "300 evaluations, each over a fresh record", fn: () => { for (let i = 0; i < 300; i++) big.evaluate("r.meta.tags | size", { r: freshRows(1)[0], args: { n: i } }); } },
    {
      group: "limits",
      name: "text output near maxOutputBytes (about 1.05 MB)",
      fn: () => big.render("${% for i in rows %}row ${{ i }} of the table\n${% endfor %}", { rows: rows46k }),
    },
  ];
}
