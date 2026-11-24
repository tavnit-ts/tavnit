# Contributing

Thanks for helping. Bug reports, a template that renders wrong, a missing built-in and a clearer
document are all welcome.

## Setup

Node 24 or later and pnpm (the version is in `package.json`).

```bash
pnpm install
pnpm run lint
pnpm run build        # tsc, then checks the skill and writes docs/UserGuide.md
pnpm run test
pnpm run test:coverage   # the package holds 100% coverage
```

[AGENTS.md](AGENTS.md) is the contributor guide: layout, error conventions, how to add a built-in, the
benchmarks and the size gate. Each directory under `src/` has its own `AGENTS.md` with design notes.

## A pull request

- Keep it to one change. Say what it fixes and why.
- A change a user can observe — syntax, a built-in, an error message, a limit, the public API —
  updates the skill in `docs/skills/tavnit/` and `CHANGELOG.md` in the same commit. `pnpm run build`
  fails on an undocumented built-in, export or error message.
- Add a test. Coverage must stay at 100%; a V8 ignore comment needs a reason next to it.
- A new export of `src/index.ts` or `src/host.ts` is a promise under semver: update the list in
  `src/index.test.ts`, the snapshot and `typescript-api.md`. Anything an application does not need goes
  in `src/internal.ts`.
- A pull request that touches `src/` or `bench/` gets a benchmark comparison; see
  [docs/performance.md](docs/performance.md).

## Security

Do not report a sandbox escape in a public issue; see [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the [ISC licence](LICENSE).
