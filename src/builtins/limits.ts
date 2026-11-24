import { limitError } from "../evaluator/errors.js";

/** The default for `maxStringLength`: the longest string a built-in may produce, in UTF-16 units. */
export const MAX_STRING_LENGTH = 10_000_000;

/** The default for `maxRegexInput`: the longest subject a `native` regular-expression built-in accepts, in UTF-16 units. */
export const MAX_REGEX_INPUT = 100_000;

/** Pass `text` on, or fail when it is longer than `max` (the engine's `maxStringLength`). */
export function limited(text: string, name: string, max: number): string {
  if (text.length > max) {
    throw limitError("string", max, `${name}() result`);
  }
  return text;
}
