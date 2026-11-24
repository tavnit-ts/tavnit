// The public surface is a list, not an accident: this test fails when an export is added to or
// dropped from `index.ts`. Add the name here and document it in `typescript-api.md` in the same
// commit. Low-level pieces belong in `internal.ts`, which is not covered by semver.
import { describe, expect, it } from "vitest";
import * as publicApi from "./index.js";
import * as hostApi from "./host.js";
import * as internalApi from "./internal.js";

const PUBLIC_VALUES = [
  "Cache",
  "Duration",
  "Expression",
  "ExpressionError",
  "Instant",
  "PlainDate",
  "PlainDateTime",
  "PlainTime",
  "Temporal",
  "TextTemplate",
  "ValueTemplate",
  "builtinFilterNames",
  "createCache",
  "createEngine",
  "deserialiseValue",
  "formatDiagnostic",
  "serialiseValue",
];

describe("public entry point", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(publicApi).sort()).toEqual([...PUBLIC_VALUES].sort());
  });

  it("serves the host integration from the host entry point", () => {
    expect(Object.keys(hostApi).sort()).toEqual(["Resolver", "contextFilter", "opaque", "resolve", "synchronousFilter"]);
    expect(Object.keys(publicApi)).not.toContain("Resolver");
    expect(Object.keys(publicApi)).not.toContain("resolve");
  });

  it("keeps the low-level pieces out of it", () => {
    for (const name of Object.keys(internalApi)) expect(Object.keys(publicApi)).not.toContain(name);
  });

  it("serves the evaluator, lexer, parser and lint from the internal entry point", () => {
    for (const name of ["evaluate", "evaluateAsync", "tokenize", "parse", "forEachNode", "contextFilter", "lintValueTemplate", "fixInlineObject"]) {
      expect(Object.keys(internalApi)).toContain(name);
    }
  });
});
