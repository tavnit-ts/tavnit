# AI disclosure

Tavnit is written entirely with large language models (LLMs). Every part of the repository — the
source in `src/`, the tests, the benchmarks, the build scripts, the documentation and the skill in
`docs/skills/tavnit/` — is produced by LLM-based coding agents. No part is hand-written.

## Who does what

| | Does |
|---|---|
| LLM agents | Write the code, tests, documentation and commit messages |
| The maintainer | Sets the requirements, reviews the results, decides what merges, and publishes releases |

The maintainer is responsible for what the repository ships. The agents are tools, not authors.

## Which models

Several models and coding agents have been used and more will follow. The repository does not
name them: a commit trailer such as `Co-Authored-By` appears on some commits and is not required.
The history is not rewritten to add one.

## What backs the output

LLM output is not trusted on its own. The repository holds it to checks that run on every change:

- the unit and integration tests, with coverage held at 100%;
- `skill-docs.test.ts`, which asserts every behaviour the documentation claims;
- `pnpm run build`, which fails on an undocumented built-in, export or error message;
- the benchmark corpus and the size gate;
- the sandbox: expressions have no `eval`, no prototype access and no global scope, and the limits
  are covered by tests.

These checks reduce the risk. They do not remove it. Read [SECURITY.md](SECURITY.md) before you
evaluate a template written by someone you do not trust.

## Licence and copyright

The code is released under the [ISC licence](LICENSE). The legal status of LLM-generated code
differs between jurisdictions and is unsettled in some. The repository makes no claim beyond the
licence. If your policy excludes AI-generated code, do not depend on this package.

## Contributions

A contribution from a person or from an agent is judged on the same terms. The submitter is
responsible for it, understands it, and says in the pull request description when an LLM wrote a
significant part of it. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Reporting a problem

Open an issue for a wrong result or a missing built-in. Report a sandbox escape privately, as
[SECURITY.md](SECURITY.md) describes.
