/**
 * Prototype-restriction list — names that are banned from property access,
 * filter registration, let-binding names, and arrow parameter names.
 *
 * Checked at parse time (member access, arrow params, let bindings),
 * at runtime (path() dotPath segments), and at engine construction/derive
 * time (filter registration names).
 */
export const RESTRICTED = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
]);
