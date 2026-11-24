# Security policy

Tavnit evaluates expressions written by people who are not fully trusted, so a way around its sandbox
is a vulnerability. Examples: reaching the host (`globalThis`, `process`, a prototype, a `Function`
constructor), reading a context value the template was not given, or exhausting time or memory with a
template that stays inside the documented limits.

## Reporting

Report a vulnerability privately through
[GitHub security advisories](https://github.com/tavnit-ts/tavnit/security/advisories/new). Do not open a
public issue. Include the expression or template, the context, the engine options, the version and what it
lets you do.

You get an acknowledgement within a week. A confirmed issue is fixed in a new release and published as an
advisory that names the reporter, unless they ask not to be named.

## Supported versions

The latest release. The package is below 1.0, so a fix ships as a new minor or patch version of it.

## What is in scope

What the sandbox promises, and what it does not, is in the
[security reference](docs/skills/tavnit/references/security.md). In particular, `timeoutMs` cannot
interrupt a single built-in that is already running, and a filter or `Resolver` the host registers runs with
the host's own privileges.
