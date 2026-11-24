### Objects

<!-- contents -->
**Contents:** `pick`, `omit`, `path`, `keys`, `values`, `json`, `today`, `toInstant`, `btoa`, `base64urlEncode`, `base64urlEncodeHex`, `encodeURIComponent`, `sha256`, `hmacSha256`, `timingSafeEqualHex`, `uuid`, `ulid`, `randomString`
<!-- /contents -->

`pick(obj, ...keys)` — return object with only the listed keys.

`omit(obj, ...keys)` — return object without the listed keys.

`path(obj, dotPath)` — dynamic path access. `dotPath` is a dot-separated
string resolved at evaluation time:

```tavnit
record | path(fieldPath)
```

Each segment of `dotPath` is validated against the prototype-restriction list
(`__proto__`, `constructor`, `prototype`, `__defineGetter__`, and similar).
A segment matching any reserved name throws an `ExpressionError`. This check
is required because the grammar restriction that blocks `args.constructor` at
parse time does not apply to a `dotPath` value that is resolved at runtime —
a user-supplied string like `"constructor.prototype.polluted"` would otherwise
bypass it.

`keys(obj)` — return an array of the object's own enumerable keys:

```tavnit
{ a: 1, b: 2 } | keys()                      // ["a", "b"]
config | keys() | filter(k => k != "secret")  // list non-secret keys
```

`values(obj)` — return an array of the object's own enumerable values:

```tavnit
{ a: 1, b: 2 } | values()         // [1, 2]
scores | values() | reduce((acc, x) => acc + x, 0)
```

### Serialisation

`json(v)` — `JSON.stringify`. `yaml(v)` — YAML dump. `str(v)` — string coercion;
it throws for arrays, objects, and function values (use `json(v)` for those).

#### json vs yaml

Both serialise a value to a string. Choose based on the consumer:

| | `json` | `yaml` |
|---|---|---|
| AI prompt injection | verbose (braces, quotes) | compact and readable — preferred |
| API body / storage | guaranteed-standard — preferred | depends on YAML library version |
| Date values | tagged wrapper object — see below | tagged wrapper mapping — see below |
| Output size | larger | smaller |

**Date values serialise as tagged wrappers, not ISO strings.** A `now()` or
`today()` value is an opaque date instance, so `json` / `yaml` emit its internal
shape. Convert with `format()` (or `str()`) before serialising anything a
consumer will read:

```tavnit
json(now())    // {"__tavnit_date__":true,"_inner":"2026-09-12T08:35:36.727Z","__tavnit_type__":"instant"}
yaml(today())  // __tavnit_date__: true\n_inner: 2026-09-12\n__tavnit_type__: plaindate
str(now())     // "2026-09-12T08:35:36.727Z"
```

```yaml
# Injecting into an agent prompt — use yaml for readability
body: |
  ${{ messages | filter(x => x.at > since) | yaml }}

# Sending as an API request body — use json for safety
body: "${{ payload | json }}"
```

`>` compares two numbers, two strings or two dates of one type; a mixed pair throws
`Operator '>' requires two numbers or two strings`. Compare epoch numbers, or convert with
`toInstant()` and use the call form (see [Date and Time](datetime.md#date-and-time)).

### Encoding

`btoa(str)` — Base64-encode a string (same as the browser / Node.js built-in). `atob(str)` — decode a Base64 string:

```tavnit
"hello" | btoa()          // "aGVsbG8="
"aGVsbG8=" | atob()       // "hello"
payload | json | btoa()   // JSON-serialise then Base64-encode
```

`base64urlEncode(str)` — Base64url-encode the UTF-8 bytes of a string (RFC 4648 §5: `+` → `-`, `/` → `_`, no padding). It never reads its argument as hex: a 64-character hex string is encoded as text.

`base64urlEncodeHex(hex)` — decode a hex string (even length, `[0-9a-fA-F]`) to bytes and Base64url-encode the bytes. This is the form for a `sha256` digest (PKCE code challenge, JWT). An odd length or a non-hex character raises `TAV_TYPE`.

```tavnit
"hello" | base64urlEncode()                    // "aGVsbG8"
"hello" | sha256() | base64urlEncodeHex()      // base64url of the 32 raw bytes
```

`encodeURIComponent(str)` — percent-encode a URI component (same as the JS built-in). `decodeURIComponent(str)` — decode:

```tavnit
"hello world" | encodeURIComponent()       // "hello%20world"
"hello%20world" | decodeURIComponent()     // "hello world"
"/tenants/" + (tenantId | encodeURIComponent()) + "/report"
```

### Crypto

`sha256(str)` — SHA-256 hash of `str` as a lowercase hex string. The primary
use case is PKCE code-challenge generation in OAuth flows:

```tavnit
codeVerifier | sha256() | base64urlEncodeHex()
```

`hmacSha256(key, message)` — HMAC-SHA256 of `message` keyed by `key` (both
UTF-8), as a lowercase hex string. Argument order matches the usual
`HMAC-SHA256(key, message)` notation. Use it to verify a signed webhook payload:

```tavnit
timingSafeEqualHex(hmacSha256(secret, rawBody), receivedSignature)
```

`timingSafeEqualHex(expected, received)` — decode two hexadecimal strings and
compare their bytes with `crypto.timingSafeEqual`. Hex letter case does not matter.
Returns `false` for empty, malformed, or unequal-length input; non-string arguments
are errors. Use fixed-length digests such as HMAC-SHA256. Input validation and length
checks can still affect timing, so this function only protects the byte comparison.

`uuid()` — generate a random UUID v4 string. Useful for idempotency keys and
correlation IDs:

```tavnit
uuid()
```

`ulid()` — generate a [ULID](https://github.com/ulid/spec): a 26-character
Crockford base32 string whose first 10 characters encode a millisecond
timestamp, so ULIDs sort lexicographically by creation time. Monotonic within a
millisecond (the random component is incremented, not regenerated). Useful as a
sortable document id or as a key prefix:

```tavnit
ulid()                                   // "01JBRX8K4E7QJ2M9V3T0YB6WFA"
"chat/" + ulid()                         // time-ordered composite key
```

`randomString(n, charset?)` — generate a cryptographically random string of
length `n`. If `charset` is omitted, uses the URL-safe character set
`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~`
(the PKCE code-verifier alphabet, RFC 7636 §4.1):

```tavnit
randomString(43)                         // 43-char URL-safe random string
randomString(64, "0123456789abcdef")     // 64-char hex-alphabet string
```

`n` must be between 1 and 256 inclusive; values outside this range throw
`ExpressionError`. For PKCE, RFC 7636 recommends a length between 43 and 128.

---
