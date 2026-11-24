import { temporal } from "./temporal.js";
import {
  FunctionValue,
  Resolver,
  TavnitDateBase,
  TavnitDuration,
  TavnitInstant,
  TavnitPlainDate,
  TavnitPlainDateTime,
  TavnitPlainTime,
  type Value,
} from "./evaluator/types.js";

/**
 * Persistence codec for the Tavnit date/time wrappers.
 *
 * A wrapper is a class instance, so a YAML/JSON store writes it as the
 * `{ __tavnit_date__, _inner, __tavnit_type__ }` map — the *tagged wrapper*
 * documented in the tavnit `08-builtins-objects` reference. That map is the
 * wire format here: `serialiseValue` writes it explicitly (instead of relying
 * on `Temporal`'s `toJSON`), and `deserialiseValue` turns it back into a live
 * wrapper, so a value survives a round-trip through state/context storage.
 *
 * The codec is backend-agnostic: it operates on plain `Value` trees, not on a
 * YAML node model, so it composes with any store whose `get`/`set` go through
 * JSON or YAML.
 */

/** `__tavnit_type__` wire names this codec round-trips. */
type StoredTavnitType = "instant" | "plaindate" | "plaintime" | "plaindatetime" | "duration";

/**
 * The concrete wrapper types a stored tagged map can rebuild.
 *
 * `TavnitZonedDateTime` is deliberately absent: the language documents it as
 * transient (valid only as input to `format()`, never compared or stored), so
 * reviving one would manufacture a value the rest of the language rejects.
 */
type StoredTavnitDate =
  | TavnitInstant
  | TavnitPlainDate
  | TavnitPlainTime
  | TavnitPlainDateTime
  | TavnitDuration;

const REVIVERS: Record<StoredTavnitType, (iso: string) => StoredTavnitDate> = {
  instant: (iso) => new TavnitInstant(temporal().Instant.from(iso)),
  plaindate: (iso) => new TavnitPlainDate(temporal().PlainDate.from(iso)),
  plaintime: (iso) => new TavnitPlainTime(temporal().PlainTime.from(iso)),
  plaindatetime: (iso) => new TavnitPlainDateTime(temporal().PlainDateTime.from(iso)),
  duration: (iso) => new TavnitDuration(temporal().Duration.from(iso)),
};

function isStoredTavnitType(value: Value): value is StoredTavnitType {
  return typeof value === "string" && Object.hasOwn(REVIVERS, value);
}

/** True for a plain data object — not an array, function value, resolver, or date wrapper. */
function isPlainRecord(value: Value): value is { [key: string]: Value } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof FunctionValue) &&
    !(value instanceof Resolver) &&
    !(value instanceof TavnitDateBase)
  );
}

function encode(type: StoredTavnitType, inner: { toString(): string }): Value {
  return { __tavnit_date__: true, _inner: inner.toString(), __tavnit_type__: type };
}

/**
 * Replace every storable date/time wrapper with its tagged map, recursively.
 *
 * `TavnitZonedDateTime` is not special-cased: it falls through to the generic
 * object serialisation and `deserialiseValue` never revives it. `FunctionValue`
 * and `Resolver` are not serialisable and pass through unchanged, exactly as
 * they do when handed straight to `yaml`/`JSON`.
 */
export function serialiseValue(value: Value): Value {
  if (value instanceof TavnitInstant) return encode("instant", value._inner);
  if (value instanceof TavnitPlainDate) return encode("plaindate", value._inner);
  if (value instanceof TavnitPlainTime) return encode("plaintime", value._inner);
  if (value instanceof TavnitPlainDateTime) return encode("plaindatetime", value._inner);
  if (value instanceof TavnitDuration) return encode("duration", value._inner);
  if (Array.isArray(value)) return value.map(serialiseValue);
  if (isPlainRecord(value)) {
    const out: { [key: string]: Value } = {};
    for (const key of Object.keys(value)) out[key] = serialiseValue(value[key]);
    return out;
  }
  return value;
}

/**
 * Rebuild every tagged map into a live wrapper, recursively.
 *
 * Anything that is not a recognised, well-formed tagged wrapper is left as a
 * plain value: an unknown `__tavnit_type__` (forward compatibility) or a
 * malformed `_inner` (a foreign or hand-edited store) must not turn a read into
 * a throw.
 */
export function deserialiseValue(value: Value): Value {
  if (Array.isArray(value)) return value.map(deserialiseValue);
  if (!isPlainRecord(value)) return value;
  const type = value.__tavnit_type__;
  const inner = value._inner;
  if (value.__tavnit_date__ === true && isStoredTavnitType(type) && typeof inner === "string") {
    // Outside the try: a host without Temporal gets the usage error, not the undecoded map.
    temporal();
    try {
      return REVIVERS[type](inner);
    } catch {
      return value;
    }
  }
  const out: { [key: string]: Value } = {};
  for (const key of Object.keys(value)) out[key] = deserialiseValue(value[key]);
  return out;
}
