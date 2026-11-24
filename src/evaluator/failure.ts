/** What serialising a value that contains a cycle reports, in place of the JavaScript engine's text. */
export const CYCLE_MESSAGE = "Cannot serialise a value that contains a cycle; a context must be a tree";

/** The message of a failure that is not Tavnit's own: the JS engine's resource errors read as limits. */
export function failureMessage(e: unknown): string {
  if (e instanceof RangeError) {
    if (e.message === "Maximum call stack size exceeded") return "Expression or data nested too deeply";
    if (e.message === "Invalid string length") return "String result is too long";
  }
  if (e instanceof TypeError && e.message.startsWith("Converting circular structure to JSON")) return CYCLE_MESSAGE;
  return e instanceof Error ? e.message : "Unknown error";
}

/** The stable code of a failure that is not Tavnit's own: a resource limit of the JS engine, or a host function's error. */
export function failureCode(e: unknown): string {
  if (e instanceof RangeError) {
    if (e.message === "Maximum call stack size exceeded") return "TAV_LIMIT_STACK";
    if (e.message === "Invalid string length") return "TAV_LIMIT_STRING";
  }
  if (e instanceof TypeError && e.message.startsWith("Converting circular structure to JSON")) return "TAV_CONTEXT";
  return "TAV_HOST";
}
