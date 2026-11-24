import type { Temporal as PolyfillTemporal } from "@js-temporal/polyfill";
import { codedError } from "./evaluator/errors.js";

/** The shape of the `Temporal` namespace every date/time value is built on. */
export type TemporalApi = typeof PolyfillTemporal;

let registered: TemporalApi | undefined;
let resolved: TemporalApi | undefined;

/**
 * The registration point of an implementation of `Temporal` for a host without a native one.
 * This module imports no implementation, so a build for a runtime that has `Temporal` carries
 * neither the polyfill nor JSBI; `@tavnit-ts/tavnit/temporal-polyfill` registers the polyfill.
 * A native `globalThis.Temporal` always wins over a registered one: values of the two
 * implementations do not mix.
 */
export function registerTemporal(api: TemporalApi): void {
  registered = api;
  resolved = undefined;
}

/** The `Temporal` in use: the runtime's own, else the registered one; a coded error when there is neither. */
export function temporal(): TemporalApi {
  resolved ??= (globalThis as { Temporal?: TemporalApi }).Temporal ?? registered;
  if (resolved === undefined) {
    throw codedError(
      "TAV_USAGE",
      "Temporal is not available: this runtime has none; call installTemporalPolyfill() from '@tavnit-ts/tavnit/temporal-polyfill' first",
    );
  }
  return resolved;
}
