import { codedError } from "./errors.js";
import {
  FunctionValue,
  TavnitDateBase,
  TavnitDuration,
  TavnitInstant,
  TavnitPlainDate,
  TavnitPlainDateTime,
  TavnitPlainTime,
  TavnitZonedDateTime,
  type Value,
} from "./types.js";

/**
 * Stringify a Value for text-embedding mode:
 * - string             → as-is
 * - number             → decimal string
 * - boolean            → "true" / "false"
 * - null               → ""
 * - Instant            → ISO 8601 UTC string
 * - PlainDate          → ISO 8601 date string
 * - PlainTime          → ISO 8601 time string
 * - PlainDateTime      → ISO 8601 datetime string
 * - Duration           → ISO 8601 duration string
 * - ZonedDateTime      → ISO 8601 zoned string
 * - array / object     → JSON.stringify
 * - FunctionValue      → error
 */
export function valueToString(v: Value): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof FunctionValue) {
    throw codedError("TAV_TYPE", "Function values cannot be used as a top-level expression result");
  }
  if (v instanceof TavnitDateBase) {
    if (v instanceof TavnitInstant) return v._inner.toString();
    if (v instanceof TavnitPlainDate) return v._inner.toString();
    if (v instanceof TavnitPlainTime) return v._inner.toString();
    if (v instanceof TavnitPlainDateTime) return v._inner.toString();
    if (v instanceof TavnitDuration) return v._inner.toString();
    /* v8 ignore else -- @preserve */
    if (v instanceof TavnitZonedDateTime) return v._inner.toString();
  }
  return JSON.stringify(v);
}
