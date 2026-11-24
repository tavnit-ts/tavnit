// The host-integration API of @tavnit-ts/tavnit (`@tavnit-ts/tavnit/host`): what an application that embeds the
// engine uses to feed it lazy data, to reach its own functions and to register filters that read the
// evaluation. Follows semver, like the root entry point. `index.test.ts` pins this list too.

export {
  type ContextFilterFn,
  contextFilter,
  synchronousFilter,
  type EvalContext,
  opaque,
  Resolver,
  resolve,
} from "./evaluator/types.js";
export type { EvaluationOptions } from "./engine/types.js";
