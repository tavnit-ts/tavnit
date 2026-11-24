// The size gate: bundles each entry of the built package (dist/) with Vite, minified, and fails when its
// gzip size exceeds the recorded ceiling by more than 5%, or when a bundle holds a dependency it must not.
//
//   pnpm run size            # build, then check
//   node scripts/check-size.mjs --update               # record the current sizes as the ceilings
//
// Ceilings live in scripts/size-ceilings.json beside the name and version of the bundler that measured them:
// a number from another bundler or version is a hint, not a verdict, so a version change is reported.
// Vite is not a dependency of this package; it is found through vitest, which depends on it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const TOLERANCE = 1.05;
const root = fileURLToPath(new URL("../", import.meta.url));
const ceilingsFile = new URL("./size-ceilings.json", import.meta.url);
const dist = (path) => JSON.stringify(join(root, "dist", path));

const POLYFILL = "@js-temporal/polyfill";
const heavy = ["re2js", "yaml", "safe-regex2", POLYFILL];

/** name -> the entry module's source, the dependencies the bundle must not hold and those it must. */
const ENTRIES = {
  "core (no built-ins)": {
    code: `import { createEngine } from ${dist("core.js")}; globalThis.entry = createEngine;`,
    forbid: heavy,
  },
  "core + common built-ins": {
    code: [
      `import { createEngine } from ${dist("core.js")};`,
      ...["types", "strings", "collections", "objects", "encoding"].map((name) => `import { ${name} } from ${dist(`categories/${name}.js`)};`),
      "globalThis.entry = () => createEngine({ builtins: [types, strings, collections, objects, encoding] });",
    ].join("\n"),
    forbid: heavy,
  },
  "core + common + datetime (native Temporal)": {
    code: [
      `import { createEngine } from ${dist("core.js")};`,
      ...["types", "strings", "collections", "objects", "encoding", "datetime"].map((name) => `import { ${name} } from ${dist(`categories/${name}.js`)};`),
      "globalThis.entry = () => createEngine({ builtins: [types, strings, collections, objects, encoding, datetime] });",
    ].join("\n"),
    forbid: heavy,
  },
  "root createEngine (full set)": {
    code: `import { createEngine } from ${dist("index.js")}; globalThis.entry = createEngine;`,
    forbid: [],
    // The full set keeps its dependencies: a bundle that lost them has lost a built-in.
    require: heavy,
  },
  "builtinFilterNames": {
    code: `import { builtinFilterNames } from ${dist("index.js")}; globalThis.entry = builtinFilterNames;`,
    forbid: heavy,
  },
};

const requireFromVitest = createRequire(createRequire(join(root, "package.json")).resolve("vitest/package.json"));
const { build } = requireFromVitest("vite");
const bundler = { name: "vite", version: requireFromVitest("vite/package.json").version };

const work = mkdtempSync(join(tmpdir(), "tavnit-size-"));
const measured = {};
try {
  for (const [name, { code }] of Object.entries(ENTRIES)) {
    const entry = join(work, "entry.mjs");
    writeFileSync(entry, code);
    const result = await build({
      logLevel: "silent",
      configFile: false,
      root,
      build: { write: false, minify: true, lib: { entry, formats: ["es"], fileName: "bundle" }, rollupOptions: { external: [/^node:/] } },
    });
    const chunk = (Array.isArray(result) ? result[0] : result).output.find((o) => o.type === "chunk");
    measured[name] = {
      raw: Buffer.byteLength(chunk.code),
      gzip: gzipSync(chunk.code).length,
      modules: [...chunk.moduleIds],
    };
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

if (process.argv.includes("--update")) {
  const entries = Object.fromEntries(Object.entries(measured).map(([name, m]) => [name, { raw: m.raw, gzip: m.gzip }]));
  writeFileSync(ceilingsFile, `${JSON.stringify({ bundler, entries }, null, 2)}\n`);
  for (const [name, m] of Object.entries(measured)) console.log(`${name.padEnd(46)} ${kb(m.raw).padStart(10)} raw ${kb(m.gzip).padStart(10)} gzip`);
  console.log(`recorded with ${bundler.name} ${bundler.version}`);
  process.exit(0);
}

const recorded = JSON.parse(readFileSync(ceilingsFile, "utf8"));
if (recorded.bundler.name !== bundler.name || recorded.bundler.version !== bundler.version) {
  console.log(`note: ceilings were recorded with ${recorded.bundler.name} ${recorded.bundler.version}, measured with ${bundler.name} ${bundler.version}`);
}
const failures = [];
for (const [name, m] of Object.entries(measured)) {
  const ceiling = recorded.entries[name]?.gzip;
  const limit = ceiling === undefined ? undefined : Math.floor(ceiling * TOLERANCE);
  console.log(`${name.padEnd(46)} ${kb(m.raw).padStart(10)} raw ${kb(m.gzip).padStart(10)} gzip   ceiling ${ceiling === undefined ? "none" : kb(ceiling)}`);
  if (limit === undefined) failures.push(`${name}: no recorded ceiling (run with --update)`);
  else if (m.gzip > limit) failures.push(`${name}: ${kb(m.gzip)} gzip is over the ceiling ${kb(ceiling)} by more than 5%`);
  for (const dependency of ENTRIES[name].require ?? []) {
    if (!m.modules.some((id) => id.includes(`/node_modules/${dependency}/`))) failures.push(`${name}: the bundle lost ${dependency}`);
  }
  for (const dependency of ENTRIES[name].forbid) {
    if (m.modules.some((id) => id.includes(`/node_modules/${dependency}/`))) {
      failures.push(`${name}: the bundle holds ${dependency}`);
    }
  }
}
if (failures.length > 0) {
  console.error(`\n${failures.join("\n")}`);
  process.exit(1);
}
