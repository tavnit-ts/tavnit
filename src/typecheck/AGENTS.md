# Tavnit type checker

## Design Notes

A static check of an expression against the types of the names it reads. It never evaluates anything and
imports nothing from the engine: the host builds a `TypeEnvironment` from its own data contracts and calls
`checkExpression` or `checkTemplate`. It is exported from `@tavnit-ts/tavnit/internal` (unstable) until the API
settles.

- **Types** (`types.ts`): null, boolean, number, string, array element, object properties, function result,
  union, `unknown`. An object property has a type and a presence (`required`, `optional`, `unknown`),
  independent of nullability. `unknown` asserts nothing and never produces a finding.
- **Mirror of the evaluator** (`check.ts`): a plain `.` or `[]` on an object without the key throws in strict
  mode; the left side of `??` (when it is a lookup) and the receiver chain of `?.` read an absent key as `null`;
  a `.` on a `null` always throws; an array index out of range is `null`. `check.test.ts` runs the same cases
  through the strict evaluator, so a change to `evaluator/evaluate.ts` that moves one fails here.
- **Narrowing**: a guard (`x`, `x != null`, `x == "a"`, `type(x) == "array"`, `!x`, `&&`, `||`, a ternary condition, or a host `assume`) refines the paths
  it reads for the branch it governs. A path is a chain of constant member accesses from one identifier; a lambda
  parameter or `let` binding of the same root ends the refinement.
- **Fallback guards**: a truthy `x ??` expression with a false fallback proves `x` is present. A nonempty
  `trim(x ?? "")` and a positive `num(x ?? 0)` make the same proof in the branch where the result is nonempty or positive.
  The checker follows only literal fallbacks whose value cannot satisfy the tested condition.
- **Collection guards**: `let head = first(xs), n = size(xs) in n == 0 ? ... : head.field` refines `head` in
  the nonempty branch when the array contract excludes null elements. The binding roots and collection path must match.
- **Non-empty arrays**: an array type carries `nonEmpty`. It comes from a `minItems >= 1` contract, a non-empty
  array literal, `size(xs) > 0` (any comparison that forces one element: `>= 1`, `!= 0`, `== 2`, either order, either
  branch of a negation, a `let n = size(xs)` binding), and `filled(xs)` / `!isEmpty(xs)` / `!blank(xs)`.
  `map`, `sort`, `reverse`, `uniqBy` keep it and `concat` has it when an argument does; `filter`, `slice`, `compact`
  and `split` do not (`split("", ",")` is `[]`). Over such an array `first`, `last` and `xs[0]` have the element
  type without `null`, which removes `TAV102`/`TAV106` on `first(xs).id` and makes `first(xs) ?? d` redundant.
  `check.test.ts` and `redundancy.test.ts` run each claim through the strict evaluator.
- **Redundancy** (`TAV201`–`TAV204`, off unless `TypeEnvironment.redundancy`): a `??` whose left side is never null
  (`TAV201`) or always null (`TAV202`), an `== null` / `!= null` on a type that decides it (`TAV203`), and a
  condition (ternary test, operand of `&&`, `||`, `!`) whose type is always truthy (an array or object, empty or not)
  or always false (`null`) (`TAV204`). They are warnings, and the checker raises none for an operand whose read
  already raised a finding, so one mistake is one finding. `unknown` never triggers one.
- **Built-ins** (`builtins.ts`): only the listed built-ins are typed. `rejectsNull` is run against the evaluator
  by `check.test.ts`; a built-in that is not listed has an `unknown` result and no argument check.
- **Blocks**: `checkTemplate` checks the conditions of `${% if %}` / `${% elif %}`, the iterable of `${% for %}` and
  the spans inside each block. A branch body runs under its condition and the negation of the earlier ones; a
  `${% for %}` body binds its variable and `forloop` as `unknown`, and drops the assumptions when either shadows a
  name of the environment. Inside a block only the findings that throw are kept: `CoalesceFix.expression` counts
  the top-level spans only.
- **What it leaves alone**: an open object that declares no property is free-form, and a union of an object with
  a primitive is told apart by a `type()` test; neither reports. The checker does not track arbitrary relations
  between values, array lengths beyond "at least one", or string content beyond emptiness.
