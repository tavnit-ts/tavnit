#!/usr/bin/env node
/**
 * Checks the tavnit skill references and generates docs/UserGuide.md from them.
 *
 * SKILL.md is hand-written. Its "## Reference files" table must link every
 * file in references/ exactly once; the table's order is the UserGuide's.
 *
 * Checks, each failing the build:
 *   - every fenced YAML example parses (a fence marked invalid is exempt)
 *   - every expression in a ```tavnit fence parses
 *   - every link `file.md#anchor` / `#anchor` between references, and every
 *     `references/file.md#anchor` in SKILL.md, resolves
 *   - a reference longer than 100 lines opens with an up-to-date contents block
 *   - the builtins.md quick reference lists exactly the registered built-ins
 *   - typescript-api.md names every export of src/index.ts and src/internal.ts
 *   - errors.md quotes every error message thrown in src/ and names every error code
 *
 * Runs after tsc: the built-in names come from dist/.
 *
 * Run: node scripts/build-docs.mjs          (check + generate)
 *      node scripts/build-docs.mjs --fix    (also rewrite stale contents blocks)
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { builtinFilterNames } from "../dist/index.js";
import { ERROR_CODES, parse as parseExpression } from "../dist/internal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const skillDir = join(root, "docs/skills/tavnit");
const refsDir = join(skillDir, "references");
const userGuideOutPath = join(root, "docs/UserGuide.md");
const fix = process.argv.includes("--fix");

const CONTENTS_START = "<!-- contents -->";
const CONTENTS_END = "<!-- /contents -->";
const CONTENTS_MIN_LINES = 100;

const errors = [];

/** GitHub's heading anchor: lowercase, punctuation dropped, each space a hyphen. */
function toAnchor(heading) {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, "").replace(/ /g, "-");
}

/** Headings outside fenced code blocks, in order. */
function headings(text) {
  const found = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    const match = !fence && line.match(/^(#{1,6})\s+(.+)$/);
    if (match) found.push({ level: match[1].length, text: match[2].trim() });
  }
  return found;
}

// ── 1. Reference order from SKILL.md ─────────────────────────────────────────

const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
const tableStart = skill.indexOf("## Reference files");
if (tableStart < 0) {
  process.stderr.write("Error: SKILL.md has no \"## Reference files\" section\n");
  process.exit(1);
}
const order = [...skill.slice(tableStart).matchAll(/\]\(references\/([\w-]+\.md)\)/g)].map((m) => m[1]);
const onDisk = readdirSync(refsDir).filter((f) => f.endsWith(".md")).sort();

for (const file of onDisk) {
  if (!order.includes(file)) errors.push(`SKILL.md does not link references/${file}`);
}
for (const file of order) {
  if (!onDisk.includes(file)) errors.push(`SKILL.md links references/${file}, which does not exist`);
  if (order.indexOf(file) !== order.lastIndexOf(file)) errors.push(`SKILL.md links references/${file} twice`);
}
if (errors.length > 0) fail();

// ── 2. Built-in quick reference ───────────────────────────────────────────────
//
// Every registered built-in has a row in the builtins.md table, and every row
// names a registered built-in; a row's first cell holds its [`name`] links.

const quickReference = new Set(
  [...readFileSync(join(refsDir, "builtins.md"), "utf8").matchAll(/^\|([^|]*)\|/gm)]
    .flatMap(([, cell]) => [...cell.matchAll(/\[`(\w+)`\]/g)].map((m) => m[1])),
);
for (const name of builtinFilterNames) {
  if (!quickReference.has(name)) errors.push(`references/builtins.md: built-in \`${name}\` has no quick-reference row`);
}
for (const name of quickReference) {
  if (!builtinFilterNames.includes(name)) errors.push(`references/builtins.md: \`${name}\` is not a registered built-in`);
}

// ── 2a. Public exports ────────────────────────────────────────────────────────
//
// Every name src/index.ts (public) and src/internal.ts (unstable) exports — value or type —
// appears in typescript-api.md.

const apiReference = readFileSync(join(refsDir, "typescript-api.md"), "utf8");
for (const entry of ["src/index.ts", "src/internal.ts"]) {
  const entrySource = readFileSync(join(root, entry), "utf8");
  const exported = [...entrySource.matchAll(/export (?:type )?\{([^}]*)\}/g)]
    .flatMap(([, list]) => list.split(","))
    .map((item) => item.trim().replace(/^type /, "").split(/\s+as\s+/).pop())
    .filter(Boolean);
  for (const name of exported) {
    if (!new RegExp(`\\b${name}\\b`).test(apiReference)) {
      errors.push(`references/typescript-api.md: export \`${name}\` of ${entry} is not documented`);
    }
  }
}

// ── 2b. Error catalog ─────────────────────────────────────────────────────────
//
// Every message a Tavnit user can see — a string literal thrown or put in a
// diagnostic under src/ — is quoted in errors.md. A message is matched by its
// longest literal stretch between `${…}` substitutions. Exempt: a built-in's
// argument error, which names the built-in as `fn()` and follows the forms
// errors.md describes, and the guards of unreachable states below.

const UNREACHABLE = ["invokeFn not initialised", "Unknown unary operator", "Unknown binary operator", "Not a binary operator"];
const THROWN = /(?:new \w*Error|this\.err|lexError|message:|codedError\(\s*"TAV_\w+",|codedErrorAt\(\s*"TAV_\w+",\s*[\w.]+,|reject\(\s*(?:path|""),)\s*\(?\s*(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
const catalog = readFileSync(join(refsDir, "errors.md"), "utf8").replaceAll("\\|", "|");
const sourceFiles = readdirSync(join(root, "src"), { recursive: true })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
for (const file of sourceFiles) {
  const text = readFileSync(join(root, "src", file), "utf8");
  for (const [, , literal] of text.matchAll(THROWN)) {
    const message = literal.replaceAll("\\`", "`");
    if (UNREACHABLE.some((guard) => message.startsWith(guard))) continue;
    if (file.startsWith("builtins") && /^(\w+|\$\{\w+\})\(\) /.test(message)) continue;
    const stretches = message.split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/).map((part) => part.trim());
    const key = stretches.reduce((longest, part) => (part.length > longest.length ? part : longest), "");
    if (key && !catalog.includes(key)) errors.push(`references/errors.md: src/${file} throws "${message}", which the catalog does not quote`);
  }
}

// Every stable error code is named in errors.md, and no code there is unknown.
for (const code of ERROR_CODES) {
  if (!catalog.includes(`\`${code}\``)) errors.push(`references/errors.md: error code \`${code}\` is not listed`);
}
for (const [, code] of catalog.matchAll(/`(TAV_[A-Z_]+)`/g)) {
  if (!ERROR_CODES.includes(code)) errors.push(`references/errors.md: lists \`${code}\`, which is not an error code`);
}

// ── 3. Contents blocks ────────────────────────────────────────────────────────

/**
 * The contents block a long reference should carry: its next-level headings or,
 * in a file of functions without subsections, the functions its paragraphs
 * open with. Null for a short file or one with neither.
 */
function contentsBlock(body) {
  if (body.split("\n").length <= CONTENTS_MIN_LINES) return null;
  const all = headings(body);
  const level = all[0].level + 1;
  const sections = all.filter((h) => h.level === level).map((h) => `- [${h.text}](#${toAnchor(h.text)})`);
  if (sections.length >= 2) return [CONTENTS_START, "**Contents**", "", ...sections, CONTENTS_END].join("\n");
  const functions = [...new Set([...body.matchAll(/^`(\w+)\(/gm)].map((m) => `\`${m[1]}\``))];
  if (functions.length >= 2) return [CONTENTS_START, `**Contents:** ${functions.join(", ")}`, CONTENTS_END].join("\n");
  return null;
}

function withoutContents(text) {
  return text.replace(new RegExp(`${CONTENTS_START}[\\s\\S]*?${CONTENTS_END}\\n\\n?`), "");
}

/** Place the block right after the title heading. */
function withContents(body, block) {
  if (!block) return body;
  const lines = body.split("\n");
  const title = lines.findIndex((line) => /^#{1,6}\s/.test(line));
  lines.splice(title + 1, 0, "", block);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

const sections = order.map((file) => {
  const raw = readFileSync(join(refsDir, file), "utf8");
  const body = withoutContents(raw);
  const expected = withContents(body, contentsBlock(body));
  if (expected !== raw) {
    if (fix) writeFileSync(join(refsDir, file), expected, "utf8");
    else errors.push(`references/${file}: contents block is missing or stale — run node scripts/build-docs.mjs --fix`);
  }
  return { file, body, anchors: new Set(headings(body).map((h) => toAnchor(h.text))), title: headings(body)[0] };
});

// ── 4. Links between references ───────────────────────────────────────────────

const byFile = new Map(sections.map((section) => [section.file, section]));

for (const { file, body, anchors } of sections) {
  for (const [, target, anchor] of body.matchAll(/\]\((?:([\w-]+\.md))?#([^)]+)\)/g)) {
    const owner = target ? byFile.get(target) : { anchors };
    if (!owner) errors.push(`references/${file}: link to unknown file ${target}`);
    else if (!owner.anchors.has(anchor)) errors.push(`references/${file}: link to missing heading ${target ?? ""}#${anchor}`);
  }
}
for (const [, target, anchor] of skill.matchAll(/\]\(references\/([\w-]+\.md)#([^)]+)\)/g)) {
  if (!byFile.get(target)?.anchors.has(anchor)) errors.push(`SKILL.md: link to missing heading references/${target}#${anchor}`);
}

// ── 5. YAML fences ────────────────────────────────────────────────────────────
//
// Every ```yaml fence must parse as YAML, because readers copy them into
// their configuration. Parsing alone is not enough: YAML accepts `: ` inside a plain scalar by
// turning it into a nested mapping, which is how an unquoted ternary silently
// loses the expression. So a parsed key that contains `${{` is also an error —
// it means the mapping the reader expects is not the mapping YAML built.
//
// A fence marked with `<!-- yaml-example: invalid -->` immediately after its
// opening fence is exempt; that is how the docs show YAML that is meant to fail.

/** Collect mapping keys (at any depth) that contain an expression span. */
function mangledKeys(value, path = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => mangledKeys(item, `${path}[${i}]`));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    return [
      ...(key.includes("${{") ? [here] : []),
      ...mangledKeys(child, here),
    ];
  });
}

function lintYamlFences(file, raw) {
  const problems = [];
  const lines = raw.split("\n");
  let fence = false;
  let exempt = false;
  let start = 0;
  let buf = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!fence && /^ {0,8}```ya?ml\s*$/.test(line)) {
      fence = true;
      start = i + 2; // first body line, 1-based
      buf = [];
      exempt = /yaml-example:\s*invalid/.test(lines[i + 1] ?? "");
      if (exempt) buf.push(lines[i + 1]);
      continue;
    }
    if (fence && line.trimStart().startsWith("```")) {
      fence = false;
      if (!exempt) {
        const source = buf.join("\n");
        try {
          const parsed = parseYaml(source, { logLevel: "silent" });
          const mangled = mangledKeys(parsed);
          if (mangled.length > 0) {
            problems.push(
              `${file}:${start} — unquoted ": " split the value into a nested mapping (key ${mangled.join(", ")}); single-quote the scalar`,
            );
          }
        } catch (err) {
          problems.push(
            `${file}:${start} — YAML fence does not parse: ${String(err.message).split("\n")[0]}`,
          );
        }
      }
      continue;
    }
    if (fence) buf.push(line);
  }

  return problems;
}

errors.push(...sections.flatMap(({ file, body }) => lintYamlFences(`references/${file}`, body)));

// ── 5a. Expression fences ─────────────────────────────────────────────────────
//
// A ```tavnit fence holds expressions only. Each is one line, or runs on while
// it does not parse yet or the next line continues it (`| map(…)`, `in body`).
// A trailing `// comment`, `# comment` or `→ result` is not part of it. An
// example meant to fail, or one mixed with other notation, goes in a plain fence.

const CONTINUATION = /^\s*(\||in\b|&&|\|\||\?\?|\?|:|\.|[-+*/%,)\]}]|and\b|or\b)/;

function parses(source) {
  try {
    parseExpression(source);
    return true;
  } catch {
    return false;
  }
}

function lintExpressionFences(file, raw) {
  const problems = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```tavnit\s*$/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;
    const body = lines.slice(i + 1, end).map((line) => line.replace(/\s+(\/\/|#\s|→).*$/, "").replace(/^\s*(\/\/|#\s).*$/, ""));
    let block = [];
    let first = 0;
    for (let j = 0; j < body.length; j++) {
      if (block.length === 0 && !body[j].trim()) continue;
      if (block.length === 0) first = j;
      block.push(body[j]);
      const next = body.slice(j + 1).find((line) => line.trim());
      if (parses(block.join("\n")) && !(next !== undefined && CONTINUATION.test(next))) block = [];
    }
    if (block.length > 0) {
      let message = "";
      try { parseExpression(block.join("\n")); } catch (err) { message = err.message; }
      problems.push(`${file}:${i + 2 + first} — expression does not parse: ${message}`);
    }
    i = end;
  }
  return problems;
}

errors.push(...sections.flatMap(({ file, body }) => lintExpressionFences(`references/${file}`, body)));

if (errors.length > 0) fail();
console.log(`✓ ${sections.length} references: linked from SKILL.md, built-ins listed, errors catalogued, links resolve, YAML and expression fences parse`);

// ── 6. Generate UserGuide.md ──────────────────────────────────────────────────

/** In one document a reference's link to another file becomes an in-page anchor. */
function inline(body) {
  return body
    .replace(/\]\([\w-]+\.md#([^)]+)\)/g, "](#$1)")
    .replace(/\]\(([\w-]+\.md)\)/g, (_, target) => `](#${toAnchor(byFile.get(target).title.text)})`);
}

const tocLines = sections
  .filter(({ title }) => title.level > 1) // skip the h1 guide title
  .map(({ title }) => `${title.level === 3 ? "    " : "  "}- [${title.text}](#${toAnchor(title.text)})`);

const userGuide = [
  "<!-- This file is generated. Edit docs/skills/tavnit/references/*.md instead, then run: node scripts/build-docs.mjs -->",
  "",
  "## Contents",
  "",
  ...tocLines,
  "",
  "---",
  "",
  sections.map(({ body }) => inline(body).trim()).join("\n\n").trimEnd(),
  "",
].join("\n");

writeFileSync(userGuideOutPath, userGuide, "utf8");
console.log(`✓ docs/UserGuide.md (${sections.length} sections)`);

function fail() {
  process.stderr.write(`Error: tavnit skill references:\n${errors.map((e) => `  ${e}\n`).join("")}`);
  process.exit(1);
}
