// Bundles the playground page with the built package (dist/) into playground/dist/. Run after `tsc`.
// Vite is not a dependency of this package; it is found through vitest, which depends on it.
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireFromVitest = createRequire(createRequire(join(root, "package.json")).resolve("vitest/package.json"));
const { build } = requireFromVitest("vite");

await build({
  root: join(root, "playground"),
  base: "./",
  logLevel: "warn",
  build: { outDir: join(root, "playground", "dist"), emptyOutDir: true, minify: true },
});
console.log(`playground built: ${join(root, "playground", "dist", "index.html")}`);
