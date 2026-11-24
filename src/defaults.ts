import type { EngineDefaults } from "./builtins/category.js";
import type { Value } from "./evaluator/types.js";
import { defaultBuiltins } from "./categories/index.js";
import { linearRegex } from "./regex-linear.js";
import { deserialiseValue as deserialiseWithTemporal } from "./serialisation.js";
import { installTemporalPolyfill } from "./temporal-polyfill.js";

/** What the root entry point's `createEngine` starts from: every built-in, the linear regex engine, the Temporal polyfill. */
export const defaultSet: EngineDefaults = {
  builtins: defaultBuiltins,
  linearRegex,
  prepare: installTemporalPolyfill,
};

/** `deserialiseValue` of the root entry point: it revives dates and times, so it installs the Temporal polyfill first. */
export function deserialiseValue(value: Value): Value {
  installTemporalPolyfill();
  return deserialiseWithTemporal(value);
}
