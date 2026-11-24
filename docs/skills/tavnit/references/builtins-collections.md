### Collections

<!-- contents -->
**Contents**

- [first, last, slice](#first-last-slice)
- [sum, min, max, range](#sum-min-max-range)
<!-- /contents -->

> **Array-returning functions always return an array — never `null`.** `filter`,
> `map`, `flatMap`, `concat`, `reverse`, `sort`, `uniqBy`, and `slice` return
> `[]` when the result is empty. You never need to null-guard their return
> values; guard an *input* with `?? []` only when it can actually be null — a
> value whose source already guarantees a list does not need it.
>
> **`size(null)` returns `0`** — safe to call on unset context keys. No `!= null` pre-check needed.

`size(v)` — length of array or string; number of own enumerable keys for objects; `0` for `null`:

```tavnit
items | size                  // number of elements
"hello" | size                // 5
config | size                 // number of keys in config
null | size                   // 0 — safe on unset context keys
```

`null` returns `0` rather than throwing, so `size(s.problems) > 0` is safe even when `s.problems` is `null` (e.g. an unset state key). The full `!= null &&` guard is never needed before a `size` check.

`map(arr, fn)` — transform each element via a 1-parameter function:

```tavnit
items | map(x => x.name)
items | map(x => x.price * x.qty)
```

`filter(arr, fn)` — keep elements where `fn` returns truthy:

```tavnit
items | filter(x => x.active)
items | filter(x => x.status == "ok" && x.amount > 0)
```

`find(arr, fn)` — first element where `fn` returns truthy, or `null`:

```tavnit
items | find(x => x.id == targetId)
```

`some(arr, fn)` — `true` if any element satisfies `fn`.

`every(arr, fn)` — `true` if all elements satisfy `fn`.

`reduce(arr, fn, init)` — fold left; `fn` receives `(accumulator, item)`.
`init` is optional and defaults to `null`; pass it for numeric folds:

```tavnit
items | reduce((acc, x) => acc + x.price, 0)
items | reduce((acc, x) => acc + ", " + x.id, "")
```

`flatMap(arr, fn)` — map each element to an array, then concatenate the
results into a single flat array (one level of nesting removed):

```tavnit
// items = [{ tags: ["a", "b"] }, { tags: ["b", "c"] }]
items | flatMap(x => x.tags)
// => ["a", "b", "b", "c"]
```

`join(arr, separator?)` — join array to string; `separator` defaults to `","`.

`concat(arr1, arr2?)` — concatenate two arrays. To **append a single item**, wrap it in an array: `arr | concat([newItem])`. The string function `append(str, suffix)` does the same for strings; there is no array-append.

`reverse(arr)` — reverse array. Returns a new array.

`uniqBy(arr, fn)` — deduplicate by key extractor; items with the same returned
key are collapsed to the first occurrence:

```tavnit
items | uniqBy(x => x.id)
```

`sort(arr, fn?, { locale }?)` — sort array. Three forms, and an optional locale:

- `sort(arr)` or `arr | sort` — natural ascending order. Numbers sort numerically; strings sort lexicographically (JavaScript's default UTF-16 code-unit order, same as `Array.prototype.sort`); `Instant` and `PlainDate` sort temporally. Arrays containing mixed types or `null` follow JavaScript's default sort comparison (elements converted to strings) — use a key extractor or comparator for reliable ordering of heterogeneous data.
- `sort(arr, x => key)` — ascending by key extractor (1-parameter function)
- `sort(arr, (a, b) => n)` — custom comparator (2-parameter function; see [Arrow Functions](language.md#arrow-functions))

Returns a new array. Sorting is stable: equal elements keep their input order.

**Locale.** Natural order compares strings by UTF-16 code unit, which puts `ё` after `я`.
Pass `{ locale: "ru" }` to order strings by the rules of a language (`Intl.Collator`), as
the second argument or after a key extractor:

```tavnit
["ё", "е", "я", "а"] | sort                          // ["а", "е", "я", "ё"]
["ё", "е", "я", "а"] | sort({ locale: "ru" })        // ["а", "е", "ё", "я"]
users | sort(u => u.name, { locale: "ru" })          // by name, Russian order
```

`locale` is a BCP 47 language tag. An invalid tag, an unknown option key, or a locale
combined with a two-parameter comparator throws. Numbers and other values order as
without a locale.

`groupBy(arr, fn)` — group into `{ [key]: item[] }` keyed by the value returned
by `fn` for each item:

```tavnit
items | groupBy(x => x.category)
```

`keyBy(arr, fn)` — map into `{ [key]: item }` keyed by the value returned by
`fn` for each item. Unlike `groupBy`, each key holds the single item directly
(not an array) — if two items produce the same key, the later item wins:

```tavnit
items | keyBy(x => x.id)
// [{ id: "a", n: 1 }, { id: "b", n: 2 }] => { a: { id: "a", n: 1 }, b: { id: "b", n: 2 } }
```

#### first, last, slice

`first(arr)` — first element of `arr`, or `null` if `arr` is empty. The `null`
return is required when accessing a field on the result — use `?.`:

```tavnit
(items | first)?.name ?? "none"
(results | find(x => x.status == "failed"))?.error
```

When the parenthesised form feels noisy, `let` binding avoids the double wrapping:

```tavnit
// equivalent — let avoids (expr)?. wrapping
let r = items | first in r?.name ?? "none"
let r = results | find(x => x.status == "failed") in r?.error
```

`last(arr)` — last element of `arr`, or `null` if `arr` is empty. Same `?.`
and `let` patterns apply.

`slice(arr, from?, to?)` — subarray from index `from` (inclusive) to `to`
(exclusive); `from` defaults to `0`, `to` to the array length. Returns `[]` if
the range is out of bounds; never returns `null`.

`chunk(arr, size)` — split `arr` into consecutive sub-arrays of length `size`;
the last chunk holds the remainder if `arr.length` does not divide evenly.
`size` is required and is truncated to an integer (throws if it is `<= 0`):

```tavnit
[1, 2, 3, 4, 5] | chunk(2)   // [[1, 2], [3, 4], [5]]
[] | chunk(2)                // []
```

`indexOf(arr, value)` — for arrays, returns the zero-based index of the first element strictly equal to `value`, or `-1` if not found. For strings, returns the zero-based index of the first occurrence of substring `value`, or `-1` if not found:

```tavnit
["a", "b", "c"] | indexOf("b")     // 1
items | indexOf(targetItem)         // -1 if not present
"hello world" | indexOf("world")   // 6
"hello world" | indexOf("xyz")     // -1
```

#### sum, min, max, range

`sum(arr)`, `min(arr)` and `max(arr)` take one array of numbers, so they sit at the end of
a pipe: `prices | sum`. A non-array or an element that is not a number (`null` included)
throws, naming the index: `sum() requires an array of numbers, got null at index 1`. `sum([])`
is `0`; `min([])` and `max([])` are `null`, like `first([])`. Use `compact` first to drop
`null` elements, and `x in arr` to test membership (`includes` is string-only).

```tavnit
[3, 1, 2] | sum                       // 6
[3, 1, 2] | min                       // 1
items | map(x => x.price) | max       // the highest price
items | map(x => x.price) | compact | sum
```

`range(end)` and `range(start, end, step?)` — an array of numbers from `start` (default
`0`) up to but not including `end`, in steps of `step` (default `1`). A step against the
direction gives `[]`; a step of `0` or a non-finite bound throws. The length counts against
`maxIterations` before the array is built, so `range(1000000)` fails under the default
limit rather than allocating.

```tavnit
range(4)                              // [0, 1, 2, 3]
range(2, 5)                           // [2, 3, 4]
range(10, 0, -5)                      // [10, 5]
range(3) | map(i => i * i)            // [0, 1, 4]
```

`joinFilled(arr, separator?)` — like `join`, but drops blank items first (`null`, `""`,
whitespace-only strings, `[]`, `{}`; `0` and `false` stay). `null` input gives `""`;
other non-arrays and a non-string separator throw. `separator` defaults to `","`.

```tavnit
[city, street, null, "  "] | joinFilled(", ")
```

`compact(arr)` — remove all `null` values from an array and return a new array.
Falsy non-null values (`0`, `false`, `""`) are kept. Always returns an array —
`[]` when all elements were `null`, never `null` itself.

The idiomatic pattern for building strings from several nullable fields:

```tavnit
let parts = [plan.name, plan.startDate, plan.endDate]
in parts | compact | join(" ")
```

`flatten(arr, depth?)` — flatten nested arrays. `depth` defaults to `Infinity` (all levels). Pass a number to flatten only that many levels:

```tavnit
[[1, 2], [3, [4, 5]]] | flatten()      // [1, 2, 3, 4, 5]
[[1, 2], [3, [4, 5]]] | flatten(1)     // [1, 2, 3, [4, 5]]
items | flatMap(x => x.tags) | flatten()   // flattens the mapped tags further — flatten() is depth ∞
```
