import { describe, expect, it } from "vitest";
import { defaultBuiltins } from "../categories/index.js";
import { builtinFilterNames } from "./names.js";

describe("builtinFilterNames", () => {
  it("lists exactly the names the categories register (regenerate with scripts/gen-builtin-names.mjs)", () => {
    const registered = defaultBuiltins.flatMap((category) => Object.keys(category.filters));
    expect([...builtinFilterNames]).toEqual(registered);
  });

  it("holds no name twice and cannot be changed", () => {
    expect(new Set(builtinFilterNames).size).toBe(builtinFilterNames.length);
    expect(Object.isFrozen(builtinFilterNames)).toBe(true);
  });
});
