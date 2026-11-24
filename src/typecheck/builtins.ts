import { arrayOf, BOOLEAN, isNonEmptyArray, membersOf, NULL, NUMBER, STRING, type TavType, UNKNOWN, unionOf, withoutNull } from "./types.js";

/**
 * What the checker knows about one built-in: whether its first argument rejects `null` (the
 * evaluator raises `<name>() requires …, got null`), and the type of its result.
 *
 * Only a built-in listed here is typed; any other call yields `unknown`. `builtins.test.ts` runs
 * every `rejectsNull` claim against the evaluator, so a drift between the two fails the build.
 */
export interface BuiltinSignature {
  /** The first argument must not be `null`. */
  rejectsNull?: boolean;
  /** The arguments that are lambdas get the element type of the first argument as their parameter. */
  callbackIndex?: number;
  /** The result type; a lambda argument arrives as `{ kind: "function", result }`. */
  result: (args: readonly TavType[]) => TavType;
}

const elementOf = (type: TavType | undefined): TavType => {
  if (type === undefined) return UNKNOWN;
  const elements = membersOf(withoutNull(type)).map((member) => (member.kind === "array" ? member.element : UNKNOWN));
  return unionOf(elements);
};

const callbackResult = (type: TavType | undefined): TavType => (type?.kind === "function" ? type.result : UNKNOWN);

const string = (rejectsNull = true): BuiltinSignature => ({ rejectsNull, result: () => STRING });
const number = (rejectsNull = true): BuiltinSignature => ({ rejectsNull, result: () => NUMBER });
const boolean = (rejectsNull = true): BuiltinSignature => ({ rejectsNull, result: () => BOOLEAN });
/** An array result of the first argument's elements; `keepsLength` when the result is empty only if the input is. */
const sameArray = (callbackIndex?: number, keepsLength = false): BuiltinSignature => ({
  rejectsNull: true,
  ...(callbackIndex === undefined ? {} : { callbackIndex }),
  result: (args) => arrayOf(elementOf(args[0]), keepsLength && isNonEmptyArray(args[0])),
});

/** The element of the first argument, or `null` when the array may be empty. */
const elementOrNull = (args: readonly TavType[]): TavType =>
  isNonEmptyArray(args[0]) ? elementOf(args[0]) : unionOf([elementOf(args[0]), NULL]);

export const BUILTIN_SIGNATURES: Readonly<Record<string, BuiltinSignature>> = {
  str: { result: () => STRING },
  num: number(),
  bool: boolean(),
  size: { result: () => NUMBER },
  blank: { result: () => BOOLEAN },
  filled: { result: () => BOOLEAN },
  isEmpty: { result: () => BOOLEAN },
  json: { result: () => STRING },

  trim: string(), trimStart: string(), trimEnd: string(), squish: string(),
  toUpperCase: string(), toLowerCase: string(), padStart: string(), padEnd: string(),
  truncate: string(), replace: string(), replaceAll: string(), remove: string(), append: string(),
  includes: boolean(), startsWith: boolean(), endsWith: boolean(),
  split: { rejectsNull: true, result: () => arrayOf(STRING) },

  round: number(), floor: number(), ceil: number(), abs: number(),
  sum: number(),
  min: { rejectsNull: true, result: () => UNKNOWN },
  max: { rejectsNull: true, result: () => UNKNOWN },

  join: string(),
  joinFilled: { result: () => STRING },
  map: { rejectsNull: true, callbackIndex: 1, result: (args) => arrayOf(callbackResult(args[1]), isNonEmptyArray(args[0])) },
  filter: sameArray(1),
  sort: sameArray(undefined, true), reverse: sameArray(undefined, true), compact: sameArray(), slice: sameArray(),
  uniqBy: sameArray(1, true),
  find: { rejectsNull: true, callbackIndex: 1, result: (args) => unionOf([elementOf(args[0]), NULL]) },
  first: { rejectsNull: true, result: elementOrNull },
  last: { rejectsNull: true, result: elementOrNull },
  some: { rejectsNull: true, callbackIndex: 1, result: () => BOOLEAN },
  every: { rejectsNull: true, callbackIndex: 1, result: () => BOOLEAN },
  flatMap: { rejectsNull: true, callbackIndex: 1, result: () => arrayOf(UNKNOWN) },
  flatten: { rejectsNull: true, result: () => arrayOf(UNKNOWN) },
  concat: { rejectsNull: true, result: (args) => arrayOf(UNKNOWN, args.some((arg) => isNonEmptyArray(arg))) },
  groupBy: { rejectsNull: true, callbackIndex: 1, result: () => ({ kind: "object", properties: {}, open: true }) },
  keyBy: { rejectsNull: true, callbackIndex: 1, result: () => ({ kind: "object", properties: {}, open: true }) },
  keys: { rejectsNull: true, result: () => arrayOf(STRING) },
  values: { rejectsNull: true, result: () => arrayOf(UNKNOWN) },
  pick: { rejectsNull: true, result: () => ({ kind: "object", properties: {}, open: true }) },
  omit: { rejectsNull: true, result: () => ({ kind: "object", properties: {}, open: true }) },
};
