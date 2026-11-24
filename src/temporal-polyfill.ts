import { Temporal as PolyfillTemporal } from "@js-temporal/polyfill";
import { registerTemporal } from "./temporal.js";

/**
 * The `Temporal` every Tavnit date/time value is built on: the runtime's own where it has
 * one, the polyfill elsewhere (browsers without it, React Native, Node before 26).
 *
 * The polyfill never defers to a native `Temporal` and computes in JSBI, a BigInt written
 * in JS. On a production screen it was ~10% of the CPU of `workScreen` (profile on prod,
 * `format` / `formatCalendar`). Values of the two implementations do not mix, so the
 * choice is made once, here.
 */
export const Temporal: typeof PolyfillTemporal =
  (globalThis as { Temporal?: typeof PolyfillTemporal }).Temporal ?? PolyfillTemporal;

/** Register `Temporal` (native, else the polyfill) with the engine. Importing this module is what costs the bytes. */
export function installTemporalPolyfill(): void {
  registerTemporal(Temporal);
}
