# @lazy-ease/testing

Portable conformance fixtures for the lazy-ease image contract (0.3). The JSON files describe what a loader, template or backend must produce: the default ladders, canonical numbers and URLs, focal crop windows, encoded pixel sizes, candidate lists, what the reference backend admits, and the optional crop token. A PHP, Go or CDN implementation can read the same files the JS packages are tested against. The package has no dependencies and no build step.

The package is planned for npm with the 0.3 release; until then it lives in the repository only. Once published:

```bash
npm install --save-dev @lazy-ease/testing
```

```js
import { casesOf, fixtures } from '@lazy-ease/testing'
import { createLoader } from '@lazy-ease/core'

for (const { id, input, expected } of casesOf('urls', 'url', { skipTopics: ['token'] })) {
  const url = createLoader({ baseUrl: input.baseUrl }).url(input.request)
  if (url !== expected.url) throw new Error(`${id}: ${url}`)
}
fixtures.ladders.data.widths // [64, 128, ..., 3840]
```

Each file is also exported on its own, e.g. `import outputs from '@lazy-ease/testing/fixtures/outputs.json' with { type: 'json' }`. Outside JS, read the files from `node_modules/@lazy-ease/testing/fixtures/` or from the release assets.

## Files

| File | Operations | Contents |
| --- | --- | --- |
| `manifest.json` | | Every other file with its byte length, SHA-256 and case count |
| `ladders.json` | snapWidth, snapRatio, snapQuality | `data`: default widths, 73 ratios, qualities, formats |
| `numbers.json` | formatNumber | Canonical number spelling |
| `focal.json` | normalizeFocalPoint | Whole-percent focal points; the center is absent |
| `crops.json` | cropWindow | Focal crop windows in oriented pixels |
| `outputs.json` | outputSize | Encoded width and height for a request |
| `candidates.json` | (one) | Request widths per layout mode, encoded sizes, srcset or single URL |
| `urls.json` | encodePath, url | Canonical source paths and complete loader URLs |
| `backend.json` | query, path | Queries and source paths the backend admits or rejects |
| `tokens.json` | sign, verify | Optional crop token: signed bytes, test keys, vectors |

From the 0.3 release on, the plan is to attach these ten files unchanged as GitHub release assets (`node scripts/fixture-assets.mjs <new-dir>` in the repository collects them from the packed package into a new or empty directory). Check them against `manifest.json` after downloading. The files use UTF-8 with LF line endings and only ASCII characters (non-ASCII text is written as `\u` escapes).

## Envelope and conventions

```json
{
  "format": "lazy-ease-fixtures",
  "fixtureVersion": 1,
  "contract": "0.3",
  "file": "outputs",
  "description": "...",
  "data": { },
  "cases": [
    { "id": "height-rounds-to-zero-wide", "op": "outputSize", "note": "...",
      "input": { "srcWidth": 2000, "srcHeight": 1000, "width": 10, "aspectRatio": 25 },
      "expected": { "requestWidth": 10, "width": 10, "height": 5 } }
  ]
}
```

- `fixtureVersion` changes when the schema or the meaning of a field changes. A release may add cases without changing it. `id` is unique within its file and stable, so failures can be reported by id.
- `op` names the operation when a file has several. `note` is a comment. `data` holds shared tables and is absent in most files.
- `topics` marks a case that exercises a capability beyond the base contract: `nfc` (NFD input normalized to NFC), `strict-q` (a missing `q` is rejected), `token` (crop tokens) and `url-parsing` (a source that is not a plain path, resolved as a URL; see Source paths). An implementation may skip a topic it does not support yet, but should list the skipped cases rather than drop them silently.
- Read every JSON number as an IEEE 754 double, as JS does. `2**70` is written as an integer literal that does not fit 64 bits.
- Inputs omit absent optional fields; they never contain `null`. Expected objects are complete: a field with no value is `null`, never missing. `{ "error": "range" }` or `{ "error": "invalid-input" }` means the operation must fail.
- `{ "special": "NaN" }` stands for a number JSON cannot write (`NaN`, `Infinity`, `-Infinity`).

## Rules

**Rounding.** `round(x)` is JS `Math.round`: the nearest integer, halves toward +infinity, on the exact double value. PHP `round()` and Python `round()` differ on halves (away from zero and to even), and `floor(x + 0.5)` is wrong too: for `x = 0.49999999999999994` the sum rounds up to `1.0` in double arithmetic, while `Math.round` gives `0`. Compare the fractional part instead, which is exact for doubles: `$f = floor($x); return ($x - $f >= 0.5) ? $f + 1 : $f;`. `clamp(v, lo, hi)` is `min(hi, max(lo, v))`.

**Numbers.** Round the exact binary value to three decimals, halves away from zero (JS `toFixed(3)`), then print the shortest decimal that reads back as the same double, without exponent or trailing zeros. `-0` prints as `0`. Values with magnitude 10^21 or more print all integer digits. `0.5625` is exactly representable and becomes `0.563`; `1.0005` is slightly below `1.0005` in binary and becomes `1`. Every double has a finite decimal expansion; decide on that exact value, since a 17-digit print cannot tell a tie from a near tie. Built-in formatting functions may round ties differently, which the tie cases in `numbers.json` catch.

**Ratios.** `ladders.data.ratios` is the ratio ladder: `round3(2^(k/16))` for k from -32 to 32 plus `round3` of 4/3, 3/2, 16/9, 21/9 and their inverses, sorted, duplicates removed. Copy the list rather than recomputing it. `snapRatio` takes the ladder value nearest in log space: for the first ladder value `upper >= r` and its predecessor `lower`, pick `upper` when `r * r >= lower * upper`, else `lower`. Ratios outside the ladder clamp to its ends.

**Widths.** `snapWidth(w)` is the smallest ladder value `>= w`, the smallest value for `w` at or below it (and for 0 or negative), and the largest for anything above. The source cap is the largest ladder value `<= srcWidth`, or the smallest ladder value when none fits. `snapQuality` takes the nearest allowed quality; a tie goes to the higher one.

**Focal point.** Round both coordinates, clamp them to 0–100. `(50, 50)` is the center and becomes absent (`null`). A focal point applies only with a crop ratio.

**Crop window** (`crops.json`). Coordinates are in oriented pixels, after EXIF rotation. `stored` gives the file's own dimensions and EXIF orientation; orientations 5 to 8 swap width and height. For a source `W × H`, ratio `ar` and focus `(fx, fy)`:

```text
if W / H > ar:  w = clamp(round(H * ar), 1, W);  left = clamp(round(fx / 100 * W - w / 2), 0, W - w);  window = (left, 0, w, H)
else:           h = clamp(round(W / ar), 1, H);  top  = clamp(round(fy / 100 * H - h / 2), 0, H - h);  window = (0, top, W, h)
```

**Encoded size** (`outputs.json`). The reference renderer extracts the crop window only when a focal point is given; a centered crop resizes the whole source with `cover`. With `width` the request width (not necessarily a ladder value here):

```text
(sw, sh) = focal crop ? window size : (W, H)
th       = ar given ? round(width / ar) : 0        # 0 means no target height
scale    = min(1, sw / width, th ? sh / th : 1)    # never upscale
outW     = max(1, round(width * scale))
outH     = th ? max(1, round(th * scale)) : max(1, round(sh * outW / sw))
```

`height-rounds-to-zero-wide` checks the `th = 0` branch: 2000 × 1000, width 10, ratio 25 encodes 10 × 5. Sources below one pixel, request widths below 1 and ratios at or below 0 are `{ "error": "range" }`.

**Candidates** (`candidates.json`). `requestWidths` depends on `mode`: `measured` takes the ladder up to `min(snapWidth(2 * slotWidth), cap)`; `fixed` takes `snapWidth(slotWidth)` and `snapWidth(2 * slotWidth)`, each limited to the cap, duplicates removed; `full` takes the ladder up to the cap. When both source dimensions are known, `outputs` is the encoded size of each request. `srcset` keeps the first request for each distinct encoded size and is labeled with the encoded `width` (`640w` for `requestWidth` 1080 that encodes 640 px). When only one distinct size remains, `srcset` is `null` and `single` names that request. When either source dimension is unknown, the encoded sizes are unknown: `outputs` and `srcset` are `null` and `single` is the largest request width with `width` and `height` `null`.

The JS packages do not emit these labels yet: `buildSrcSet` in `@lazy-ease/core` still labels each request with its request width and does not merge equal outputs. Its test pins the candidate records that differ (`full-crop-dedupe` and four more); the 0.3 controller and React step that emits actual-width descriptors and a single `src` must make them pass.

**Source paths** (`urls.json`, op `encodePath`). The source is resolved as a URL path relative to an `http` base, as the WHATWG URL parser does (`new URL(src, 'http://host').pathname`):

- leading and trailing C0 controls and spaces are trimmed, and ASCII tab, LF and CR are removed everywhere;
- a scheme and authority are dropped (`https://cdn.example/p/x.jpg` and `//cdn.example/x.jpg` keep only `/p/x.jpg` and `/x.jpg`), and a bare name is relative to `/`;
- a backslash counts as a slash;
- the query and fragment are dropped;
- `.` and `..` segments are resolved, also when written as `%2e`/`%2E` (`/a/%2e%2e/b.jpg` is `/b.jpg`).

Then each segment is percent-decoded as UTF-8, normalized to NFC, and encoded again as JS `encodeURIComponent` does. That leaves only ASCII letters, digits and `- _ . ! ~ * ' ( )` unencoded, with uppercase hex. PHP `rawurlencode` also encodes `! * ' ( )`, so restore those five after calling it. A segment that does not decode (a stray `%`) is encoded as the URL parser left it, so `%` becomes `%25`. The result starts with `/`.

The cases tagged `url-parsing` cover the inputs where this differs from plain path handling. A template implementation that does not parse URLs may reject such sources instead, but it must never emit a different URL for them. Schemes other than `http`, `https`, `ws`, `wss` and `ftp` are outside the fixtures.

**Loader URL** (`urls.json`, op `url`). `{baseUrl}{path}?{query}` with `baseUrl` stripped of trailing slashes (default `/_img`). Query keys in this order, absent ones omitted: `ar`, `fmt`, `fx`, `fy`, `q`, `token`, `v`, `w`. Numbers use the canonical spelling, `q` is always present, and `v` and `token` are opaque values passed through `encodeURIComponent` with their case preserved. Write `&` as `&amp;` only when the URL goes into an HTML attribute.

**Backend admission** (`backend.json`, op `query`). The query is validated as a raw string before any cache lookup, with the default ladders. It must contain the keys in the order above, each at most once, with a value, and nothing else. `w` must be a ladder width, `ar` a ladder ratio and `q` an allowed quality, each in its exact canonical spelling (`640.0`, `0640` and `6.4e2` are 400). `fmt` is `avif`, `webp` or `jpeg`. `fx` and `fy` come together, only with `ar`, as whole numbers 0 to 100 without leading zeros, and never as `50`/`50`. `v` matches `[A-Za-z0-9._~-]{1,64}` and `token` the token pattern below. Anything else is a 400. Expected `params` show the parsed request with `null` for absent fields.

**Backend paths** (`backend.json`, op `path`). `rawPath` is the path after the mount point, as sent. A 200 case names the file under the source root it must serve (`file`, decoded and NFC). `canonical` tells whether `rawPath` is already the canonical spelling `canonicalPath`. A backend either rejects a non-canonical spelling with 400 or serves exactly the same variant as the canonical path (same bytes, ETag and cache entry). It must never cache it separately. Dot segments after decoding, backslashes, colons, NUL bytes, a leading `//` and types other than JPEG, PNG, WebP, AVIF and GIF are 400; a missing file is 404.

## Crop token

A crop token is optional. A backend that issues tokens accepts a crop only when the token matches the request's source, revision and crop; width, format and quality stay bounded by the ladders alone, so one token covers every admitted width, format and quality of that crop. Tokens do not expire, and they do not replace viewer authorization. The tenant is the deployment's namespace and is never read from the request.

Signed message (bytes, no separators beyond those shown):

```text
"lazy-ease/crop-token/1" 0x00
field(tenant) field(kid) field(source) field(revision) field(ar) field(fx) field(fy)

field(absent)  = 0x00
field(present) = 0x01 || uint32 big-endian byte length || UTF-8 bytes
```

| Field | Value | Absent |
| --- | --- | --- |
| tenant | `[A-Za-z0-9._~-]{1,64}`, from deployment configuration | never |
| kid | key id, `[A-Za-z0-9_-]{1,32}` | never |
| source | `canonicalPath` of the request path (`/my%20photos/caf%C3%A9.jpg`), see below | never |
| revision | the `v` value | when the URL has no `v` |
| ar, fx, fy | canonical spellings as in the URL | when the URL omits them |

The MAC always covers the canonical encoded path, never the spelling the request used. A verifier first admits the raw path after the mount point as in Backend paths, then signs its `canonicalPath`. A request that spells the signed path with lowercase hex, in NFD or with over-encoded characters therefore verifies, and a backend that issues tokens signs the canonical path as well. Signing rejects input the URL could not carry: `fx` without `fy`, a focus without `ar`, the center written out, a non-canonical ratio or path, an empty revision. Those cases are `{ "error": "invalid-input" }`. Absent and empty never mean the same thing.

```text
mac   = first 16 bytes of HMAC-SHA-256(key, message)
token = "1." || kid || "." || base64url(mac) without padding     (22 characters)
```

In PHP: `$mac = substr(hash_hmac('sha256', $message, hex2bin($keyHex), true), 0, 16)` with the raw key bytes from `hex2bin`, not the hex string, and `rtrim(strtr(base64_encode($mac), '+/', '-_'), '=')` for base64url.

To verify, match the token against `^1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{22}$`, look up the key by tenant and kid (an unknown kid fails), compute the expected token for the request and compare the two strings in constant time (`hash_equals($expected, $token)` in PHP, the known string first). Comparing strings rather than decoded bytes rejects the other base64 spellings of the last character, which decode to the same 16 bytes. Keep keys on the backend and rotate them by kid. In the URL the token sits between `q` and `v` and needs no escaping.

The test keys in `tokens.data.keys` are `SHA-256("lazy-ease public test key/{tenant}/{kid}")`. They are public: never accept them in production. `sign` cases give the message as hex and the token; `verify` cases give a request (without kid) and a token and say whether it must be accepted. A `verify` case with `rawPath` gives the path as the request sent it; its `grant.source` is the canonical spelling, and the MAC must be computed over that. `sign-focal-crop` also shows the complete URL.

## Checking the fixtures

`scripts/check-fixtures.py` in the repository reads the files with Python's JSON parser and recomputes every expected value from the rules above, independently of the TypeScript sources. A backend 404 case is checked against the files the 200 cases name, which stand for the whole source root. `@lazy-ease/core` and `@lazy-ease/server` run the same records in their test suites, the server against real encoded images.

- [Design specification](https://github.com/mikekuss/lazy-ease/blob/main/docs/design-spec.md)
- [Backend guide](https://github.com/mikekuss/lazy-ease/blob/main/docs/backend.md)

## License

MIT
