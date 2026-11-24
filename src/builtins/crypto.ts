import type { FilterRegistry, Value } from "../evaluator/types.js";
import { EvaluationError, typeName } from "../evaluator/types.js";

// RFC 7636 §4.1 PKCE code-verifier alphabet (URL-safe, no padding chars)
const PKCE_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

type NodeCrypto = typeof import("node:crypto");

/**
 * `node:crypto`, looked up when a hash is asked for rather than imported: a static import would
 * stop the package loading in a browser or an edge runtime. Not cached, so the lookup stays cheap
 * and testable. Random values and the constant-time comparison need no Node and use Web Crypto.
 */
function nodeCrypto(fn: string): NodeCrypto {
  const loaded = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
    ?.getBuiltinModule?.("node:crypto") as NodeCrypto | undefined;
  if (!loaded) throw new EvaluationError(`${fn}() needs node:crypto, which this runtime does not provide`);
  return loaded;
}

function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

function sha256(v: Value): Value {
  if (typeof v !== "string") {
    throw new EvaluationError(
      `sha256() requires a string, got ${typeName(v)}`,
    );
  }
  return nodeCrypto("sha256").createHash("sha256").update(v, "utf8").digest("hex");
}

function hmacSha256(key: Value, message: Value): Value {
  if (typeof key !== "string") {
    throw new EvaluationError(
      `hmacSha256() key must be a string, got ${typeName(key)}`,
    );
  }
  if (typeof message !== "string") {
    throw new EvaluationError(
      `hmacSha256() message must be a string, got ${typeName(message)}`,
    );
  }
  return nodeCrypto("hmacSha256").createHmac("sha256", key).update(message, "utf8").digest("hex");
}

function timingSafeEqualHex(expected: Value, received: Value): Value {
  if (typeof expected !== "string") {
    throw new EvaluationError(`timingSafeEqualHex() expected must be a string, got ${typeName(expected)}`);
  }
  if (typeof received !== "string") {
    throw new EvaluationError(`timingSafeEqualHex() received must be a string, got ${typeName(received)}`);
  }
  if (expected.length === 0 || expected.length !== received.length || expected.length % 2 !== 0 ||
      !/^[0-9a-f]+$/i.test(expected) || !/^[0-9a-f]+$/i.test(received)) {
    return false;
  }
  // Every pair of digits is compared: the loop never stops at the first difference.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 2) {
    diff |= Number.parseInt(expected.slice(i, i + 2), 16) ^ Number.parseInt(received.slice(i, i + 2), 16);
  }
  return diff === 0;
}

function uuid(_v: Value): Value {
  return globalThis.crypto.randomUUID();
}

// Crockford base32 (ULID spec) — excludes I, L, O, U.
const ULID_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_TIME_LEN = 10; // 48-bit ms timestamp
const ULID_RANDOM_LEN = 16; // 80-bit randomness

// Monotonic state: within the same millisecond the random component is
// incremented rather than regenerated, so ids minted in one tick still sort.
let ulidLastTime = -1;
let ulidLastRandom: number[] = [];

function ulidRandomDigits(): number[] {
  return Array.from(randomBytes(ULID_RANDOM_LEN), (b) => b % 32);
}

function ulidIncrement(digits: number[]): number[] {
  const out = digits.slice();
  for (let i = ULID_RANDOM_LEN - 1; i >= 0; i--) {
    if (out[i] < 31) {
      out[i]++;
      return out;
    }
    out[i] = 0;
  }
  // 80-bit overflow within one millisecond — practically unreachable; start fresh.
  /* v8 ignore next -- @preserve: needs 2^80 ULIDs in one millisecond */
  return ulidRandomDigits();
}

function ulidEncodeTime(ms: number): string {
  let out = "";
  let t = ms;
  for (let i = 0; i < ULID_TIME_LEN; i++) {
    const mod = t % 32;
    out = ULID_CROCKFORD[mod] + out;
    t = (t - mod) / 32;
  }
  return out;
}

function ulid(_v: Value): Value {
  const now = Date.now();
  const digits =
    now === ulidLastTime ? ulidIncrement(ulidLastRandom) : ulidRandomDigits();
  ulidLastTime = now;
  ulidLastRandom = digits;
  let random = "";
  for (const d of digits) random += ULID_CROCKFORD[d];
  return ulidEncodeTime(now) + random;
}

function randomString(v: Value, charset: Value = null): Value {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new EvaluationError(
      `randomString() length must be an integer, got ${typeName(v)}`,
    );
  }
  if (v < 1 || v > 256) {
    throw new EvaluationError(
      `randomString() length must be between 1 and 256, got ${v}`,
    );
  }
  const cs =
    charset === null
      ? PKCE_CHARSET
      : typeof charset === "string"
        ? charset
        : (() => {
            throw new EvaluationError(
              `randomString() charset must be a string, got ${typeName(charset)}`,
            );
          })();
  if (cs.length === 0) {
    throw new EvaluationError("randomString() charset must not be empty");
  }
  const bytes = randomBytes(v);
  let result = "";
  for (const byte of bytes) {
    result += cs[byte % cs.length];
  }
  return result;
}

export const cryptoBuiltins: FilterRegistry = {
  sha256,
  hmacSha256,
  timingSafeEqualHex,
  uuid,
  ulid,
  randomString,
};
