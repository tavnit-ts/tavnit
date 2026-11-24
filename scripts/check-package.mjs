// The pre-release check of the package: packs what `npm publish` would send and lints the tarball
// with publint (package.json against the packed files) and attw (how TypeScript resolves the types
// of every entry point). Run after `tsc`; `pnpm run check:package` builds first.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tavnit-pack-"));
try {
  const [tarball] = execFileSync("npm", ["pack", "--silent", "--ignore-scripts", "--pack-destination", dir], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .slice(-1);
  const file = join(dir, tarball);
  // --strict makes publint fail on a warning, not only on an error.
  execFileSync("pnpm", ["exec", "publint", "--strict", file], { stdio: "inherit" });
  // esm-only: the package ships no CommonJS build, so the CJS and node10 columns are ignored.
  execFileSync("pnpm", ["exec", "attw", file, "--profile", "esm-only"], { stdio: "inherit" });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
