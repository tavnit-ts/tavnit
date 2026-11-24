// The linear-time regular-expression engine behind matches(), capture() and captures():
// re2js, a port of RE2. It never backtracks, so no pattern can run away.
//
// RE2 and the JavaScript RegExp agree on most syntax and differ in a few places that
// ordinary text meets. `translate` closes those, so a pattern means what it means in
// JavaScript: `.` and `\s` (RE2: ASCII-only `\s`, and `.` that takes `\r` and the Unicode
// line separators), `\uXXXX` and `\cX` escapes, a literal `[` or an empty class inside `[...]`.
import { RE2JS } from "re2js";
import { EvaluationError } from "../evaluator/types.js";

/** The JavaScript `\s` set: line terminators, the Unicode spaces, the byte-order mark. */
const SPACE: ReadonlyArray<readonly [number, number]> = [
  [0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff],
];
/** Every code point of `SPACE` is out, every other scalar value is in; surrogate halves cannot sit in an RE2 class. */
export const NOT_SPACE: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08], [0x0e, 0x1f], [0x21, 0x9f], [0xa1, 0x167f], [0x1681, 0x1fff], [0x200b, 0x2027],
  [0x202a, 0x202e], [0x2030, 0x205e], [0x2060, 0x2fff], [0x3001, 0xd7ff], [0xe000, 0xfefe], [0xff00, 0x10ffff],
];
export { SPACE };

const hex = (n: number): string => `\\x{${n.toString(16)}}`;
const body = (ranges: ReadonlyArray<readonly [number, number]>): string =>
  ranges.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join("");

const SPACE_BODY = body(SPACE);
const NOT_SPACE_BODY = body(NOT_SPACE);
const ANY_BODY = body([[0, 0xd7ff], [0xe000, 0x10ffff]]);
/** `.` of JavaScript: anything but the four line terminators. */
const DOT = "[^\\n\\r\\x{2028}\\x{2029}]";

/** The RE2 spelling of a JavaScript pattern; see the header. */
export function translate(pattern: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "\\") {
      const next = pattern.charAt(i + 1);
      if (next === "s") out += inClass ? SPACE_BODY : `[${SPACE_BODY}]`;
      else if (next === "S") out += inClass ? NOT_SPACE_BODY : `[^${SPACE_BODY}]`;
      else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(pattern.slice(i + 2, i + 6))) {
        out += `\\x{${pattern.slice(i + 2, i + 6)}}`;
        i += 4;
      } else if (next === "c" && /[A-Za-z]/.test(pattern.charAt(i + 2))) {
        out += hex(pattern.charCodeAt(i + 2) % 32);
        i += 1;
      } else out += c + next;
      i += 1;
    } else if (inClass) {
      if (c === "]") inClass = false;
      out += c === "[" ? "\\[" : c;
    } else if (c === "[") {
      // JavaScript: `[]` matches nothing and `[^]` anything; RE2 reads the `]` as a member.
      if (pattern.startsWith("[]", i)) {
        out += `[^${ANY_BODY}]`;
        i += 1;
      } else if (pattern.startsWith("[^]", i)) {
        out += `[${ANY_BODY}]`;
        i += 2;
      } else {
        inClass = true;
        out += c;
        if (pattern.charAt(i + 1) === "^") {
          out += "^";
          i += 1;
        }
      }
    } else out += c === "." ? DOT : c;
  }
  return out;
}

const CACHE_SIZE = 256;
const compiled = new Map<string, RE2JS>();

/** The compiled form of `pattern`, from a process-wide least-recently-used cache. */
export function compileLinear(pattern: string, name: string): RE2JS {
  const hit = compiled.get(pattern);
  if (hit) {
    compiled.delete(pattern);
    compiled.set(pattern, hit);
    return hit;
  }
  let re: RE2JS;
  try {
    re = RE2JS.compile(translate(pattern));
  } catch (error) {
    throw new EvaluationError(syntaxMessage(pattern, name, (error as Error).message));
  }
  if (compiled.size >= CACHE_SIZE) compiled.delete(compiled.keys().next().value as string);
  compiled.set(pattern, re);
  return re;
}

/** Name what the engine refuses when it is a feature of the JavaScript engine, else call the pattern invalid. */
function syntaxMessage(pattern: string, name: string, reason: string): string {
  let feature: string | undefined;
  if (/unsupported Perl syntax: `\(\?[=!]/.test(reason)) feature = "a lookahead";
  else if (reason.includes("invalid named capture") && /\(\?<[=!]/.test(pattern)) feature = "a lookbehind";
  else if (/invalid escape sequence: `\\([1-9k])/.test(reason)) feature = "a backreference";
  // safe-regex2 refuses a lookbehind in the native engine too, so there is no mode to switch to.
  if (feature === "a lookbehind") {
    return `${name}() pattern uses a lookbehind, which the linear regex engine does not support and the native engine refuses; rewrite the pattern`;
  }
  if (feature) {
    return `${name}() pattern uses ${feature}, which the linear regex engine does not support; set regex: 'native' on the engine`;
  }
  return `Invalid regular expression: ${pattern}`;
}
