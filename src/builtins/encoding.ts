import type { FilterRegistry, Value } from "../evaluator/types.js";
import { codedError } from "../evaluator/errors.js";
import { EvaluationError, typeName } from "../evaluator/types.js";

function ensureString(v: Value, name: string): string {
  if (typeof v !== "string") {
    throw new EvaluationError(
      `${name}() requires a string, got ${typeName(v)}`,
    );
  }
  return v;
}

function btoaFn(v: Value): Value {
  const str = ensureString(v, "btoa");
  try {
    return btoa(str);
  } catch {
    throw new EvaluationError(
      "btoa() failed: string contains characters outside the Latin-1 range",
    );
  }
}

function atobFn(v: Value): Value {
  const str = ensureString(v, "atob");
  try {
    return atob(str);
  } catch {
    throw new EvaluationError("atob() failed: invalid base64 string");
  }
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncode(v: Value): Value {
  return bytesToBase64url(new TextEncoder().encode(ensureString(v, "base64urlEncode")));
}

const HEX_RE = /^(?:[0-9a-fA-F]{2})*$/;

function base64urlEncodeHex(v: Value): Value {
  const hex = ensureString(v, "base64urlEncodeHex");
  if (!HEX_RE.test(hex)) {
    throw codedError(
      "TAV_TYPE",
      "base64urlEncodeHex() requires a hexadecimal string of even length ([0-9a-fA-F])",
    );
  }
  return bytesToBase64url(Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)));
}

function encodeURIComponentFn(v: Value): Value {
  return encodeURIComponent(ensureString(v, "encodeURIComponent"));
}

function decodeURIComponentFn(v: Value): Value {
  const str = ensureString(v, "decodeURIComponent");
  try {
    return decodeURIComponent(str);
  } catch {
    throw new EvaluationError(
      "decodeURIComponent() failed: invalid percent-encoded sequence",
    );
  }
}

export const encodingBuiltins: FilterRegistry = {
  btoa: btoaFn,
  atob: atobFn,
  base64urlEncode,
  base64urlEncodeHex,
  encodeURIComponent: encodeURIComponentFn,
  decodeURIComponent: decodeURIComponentFn,
};
