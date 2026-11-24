/**
 * The static type of a Tavnit value, as far as a data contract tells it.
 *
 * Presence (does the key exist) is independent of nullability (is the value `null`): a property
 * can be required and nullable, or optional and non-null when present.
 */
export type TavType =
  | { kind: "unknown" }
  | { kind: "null" }
  | { kind: "boolean" }
  | { kind: "number"; minimum?: number; maximum?: number; exclusiveMinimum?: boolean; exclusiveMaximum?: boolean; integer?: boolean }
  | { kind: "string"; nonEmpty?: boolean }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "array"; element: TavType; /** The array holds at least one element. Absent means "may be empty". */ nonEmpty?: boolean }
  | { kind: "object"; properties: Readonly<Record<string, TavProperty>>; open: boolean }
  | { kind: "function"; result: TavType }
  | { kind: "union"; members: readonly TavType[] };

/** `unknown`: the contract does not say whether the key is there. A strict read of it is a warning. */
export type Presence = "required" | "optional" | "unknown";

export interface TavProperty {
  type: TavType;
  presence: Presence;
}

export const UNKNOWN: TavType = { kind: "unknown" };
export const NULL: TavType = { kind: "null" };
export const BOOLEAN: TavType = { kind: "boolean" };
export const NUMBER: TavType = { kind: "number" };
export const STRING: TavType = { kind: "string" };

export function literalOf(value: string | number | boolean): TavType {
  return { kind: "literal", value };
}

/** An array of `element`; `nonEmpty` when it is known to hold at least one. */
export function arrayOf(element: TavType, nonEmpty = false): TavType {
  return nonEmpty ? { kind: "array", element, nonEmpty: true } : { kind: "array", element };
}

export function objectOf(properties: Record<string, TavProperty>, open = true): TavType {
  return { kind: "object", properties, open };
}

/** The union of `members`: flattened, deduplicated, one member when only one is left. `unknown` absorbs the rest. */
export function unionOf(members: readonly TavType[]): TavType {
  const flat: TavType[] = [];
  for (const member of members) {
    if (member.kind === "unknown") return UNKNOWN;
    for (const part of member.kind === "union" ? member.members : [member]) {
      if (!flat.some((seen) => sameType(seen, part))) flat.push(part);
    }
  }
  if (flat.length === 0) return UNKNOWN;
  return flat.length === 1 ? flat[0] : { kind: "union", members: flat };
}

/** Structural equality, enough to deduplicate union members. */
export function sameType(a: TavType, b: TavType): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "literal": return a.value === (b as typeof a).value;
    case "number": {
      const other = b as typeof a;
      return a.minimum === other.minimum && a.maximum === other.maximum && a.exclusiveMinimum === other.exclusiveMinimum
        && a.exclusiveMaximum === other.exclusiveMaximum && a.integer === other.integer;
    }
    case "string": return a.nonEmpty === (b as typeof a).nonEmpty;
    case "array": return (a.nonEmpty === true) === ((b as typeof a).nonEmpty === true) && sameType(a.element, (b as typeof a).element);
    case "function": return sameType(a.result, (b as typeof a).result);
    case "union": {
      const other = b as typeof a;
      return a.members.length === other.members.length && a.members.every((m) => other.members.some((o) => sameType(m, o)));
    }
    case "object": {
      const other = b as typeof a;
      const keys = Object.keys(a.properties);
      return a.open === other.open && keys.length === Object.keys(other.properties).length
        && keys.every((key) => {
          const mine = a.properties[key];
          const theirs = other.properties[key];
          return theirs !== undefined && mine.presence === theirs.presence && sameType(mine.type, theirs.type);
        });
    }
    default: return true;
  }
}

/** True when `null` is a possible value. `unknown` is not: it asserts nothing. */
export function includesNull(type: TavType): boolean {
  return type.kind === "null" || (type.kind === "union" && type.members.some((member) => member.kind === "null"));
}

/** `type` without `null`. */
export function withoutNull(type: TavType): TavType {
  if (type.kind === "null") return UNKNOWN;
  if (type.kind !== "union") return type;
  return unionOf(type.members.filter((member) => member.kind !== "null"));
}

/** True when every non-null member is an array known to hold at least one element. */
export function isNonEmptyArray(type: TavType | undefined): boolean {
  if (type === undefined) return false;
  const members = membersOf(withoutNull(type));
  return members.length > 0 && members.every((member) => member.kind === "array" && member.nonEmpty === true);
}

/** `type` with every array member marked non-empty; other members stay as they are. */
export function asNonEmpty(type: TavType): TavType {
  return unionOf(membersOf(type).map((member) => (member.kind === "array" ? arrayOf(member.element, true) : member)));
}

/** `type` or `null`. */
export function nullable(type: TavType): TavType {
  return unionOf([type, NULL]);
}

/** The members of a type: a union's own, otherwise the type itself. */
export function membersOf(type: TavType): readonly TavType[] {
  return type.kind === "union" ? type.members : [type];
}

/** Print a type the way a diagnostic shows it: `{ city: string } | null`. */
export function formatType(type: TavType): string {
  switch (type.kind) {
    case "unknown": return "unknown";
    case "null":
    case "boolean": return type.kind;
    case "number": return type.minimum === undefined && type.maximum === undefined && !type.integer ? "number"
      : `number${type.integer ? " (integer)" : ""}[${type.minimum === undefined ? "-∞" : `${type.exclusiveMinimum ? "(" : ""}${type.minimum}`}, ${type.maximum === undefined ? "∞" : `${type.maximum}${type.exclusiveMaximum ? ")" : ""}`}]`;
    case "string": return type.nonEmpty ? "non-empty string" : "string";
    case "literal": return JSON.stringify(type.value);
    case "array": return type.nonEmpty === true ? `[${formatType(type.element)}, ...${wrapUnion(type.element)}[]]` : `${wrapUnion(type.element)}[]`;
    case "function": return "function";
    case "union": return type.members.map(formatType).join(" | ");
    case "object": {
      const fields = Object.entries(type.properties).map(([key, property]) =>
        `${key}${property.presence === "required" ? "" : property.presence === "optional" ? "?" : "??"}: ${formatType(property.type)}`);
      if (type.open) fields.push("...");
      return fields.length === 0 ? "{}" : `{ ${fields.join(", ")} }`;
    }
  }
}

function wrapUnion(type: TavType): string {
  return type.kind === "union" ? `(${formatType(type)})` : formatType(type);
}
