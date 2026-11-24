// Snapshot of the exported value names of both entry points: an accidental API change fails CI.
// Update deliberately (`vitest -u`) together with `typescript-api.md`. Types are pinned in
// `api.test-d.ts`.
import { expect, it } from "vitest";
import * as publicApi from "./index.js";
import * as internalApi from "./internal.js";

it("pins the exported names of @tavnit-ts/tavnit", () => {
  expect(Object.keys(publicApi).sort()).toMatchSnapshot();
});

it("pins the exported names of @tavnit-ts/tavnit/internal", () => {
  expect(Object.keys(internalApi).sort()).toMatchSnapshot();
});
