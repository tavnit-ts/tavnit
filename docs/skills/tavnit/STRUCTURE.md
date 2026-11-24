# Skill Structure

`docs/UserGuide.md` is `references/` concatenated in the order of the `SKILL.md` tables — it is
generated, not in git.

`pnpm run build` runs `scripts/build-docs.mjs`, which fails when:

- a reference is missing from the `SKILL.md` table, or the table links a missing file;
- a registered built-in (`builtinFilterNames`) has no row in the `builtins.md` quick
  reference, or a row names an unregistered one;
- an export of `src/index.ts` or `src/internal.ts` is not named in `typescript-api.md`;
- a message thrown in `src/` is not quoted in `errors.md` — except a built-in's argument
  error, which starts with its `fn()` name;
- a link between references — `file.md#anchor` or `#anchor` — or from `SKILL.md`
  into one names no heading;
- a reference over 100 lines lacks its contents block or the block is stale —
  `node scripts/build-docs.mjs --fix` rewrites it;
- a fenced YAML example does not parse, or an unquoted `: ` split a value into a
  mapping. A fence meant to fail carries `<!-- yaml-example: invalid -->` as its
  first body line.
- an expression in a ` ```tavnit ` fence does not parse. Such a fence holds
  expressions only — one per line, or continued on the next line (`| map(…)`, `in …`),
  with an optional trailing `// comment` or `→ result`. An example meant to fail, or
  one mixed with other notation, goes in a plain fence.

`src/engine/skill-docs.test.ts` asserts the behaviour the examples claim; keep it in
step when an example changes.

## Cross-references

A link from one reference into another is written `file.md#anchor` (or `#anchor`); the build
rewrites it to an in-page anchor for the guide.
