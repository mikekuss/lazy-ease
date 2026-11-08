# Implementing a lazy-ease backend

Target: 0.3.0. The [specification](design-spec.md) defines the wire contract. A compatible backend can be a PHP template reading a build manifest, a single Node process, or a CDN with regional rendering workers.

## Smallest working deployment

Serve one optimized file. Give the template its URL, accessible description and any known layout dimensions. Use src for native HTML or data-le-url for the prepared fade. This works without a metadata endpoint, crop token, browser format probe or client URL builder. To add responsive selection, publish the actual encoded width and URL of each permitted variant. A PHP author can turn those pairs into srcset and reuse the same list for all three display modes in the [recipes](image-recipes.md).

For the reference loader, a public uncropped WebP URL is `/_img/lake.jpg?fmt=webp&q=75&w=640`. In an HTML attribute the separators serialize as `&amp;`. At upload time record oriented dimensions, a revision representing the bytes, supported crops, and optional focus/color/ThumbHash. Preserve original SVG and animation on the pass-through path. External URLs are consumed directly by the browser.

## Admission and rendering

1. Resolve a source within the configured namespace and real root, checking symlinks, type and path boundaries. Preserve the existing file-size and pixel limits. Keep metadata generation an upload/build operation.
2. Validate the canonical raw path and query before a cache lookup. Require an allowed width, format and quality. Allow a crop only if the source policy authorizes that ratio and focus. Enforce the same profile in PHP, client loader, CDN and renderer. Give tokenless deployments a finite list per source; include uncropped among the choices when needed.
3. Optionally validate a crop token over the canonical source identity, ar/fx/fy and revision, including unambiguous absent values. Scope keys to the deployment/tenant. Use a versioned, unambiguous encoding, a server-side MAC, constant-time verification and published positive/negative test vectors. The byte format and vectors are in [`@lazy-ease/testing`](../packages/testing/README.md#crop-token), together with fixtures for the canonical query, paths and encoded sizes. Keep signing secrets on the backend. The token has no expiry. Changing width/format/quality within the admitted sets keeps the same grant. For private media enforce revocable viewer access separately.
4. Bound active work and pending jobs. Start the response deadline on admission, coalesce simultaneous identical jobs, and return 503 with Retry-After when saturated. A 504 ends the response. Keep the render slot and in-flight identity until underlying native work actually ends. Observe file, pixel, time and encoder effort limits.
5. Auto-orient, crop in oriented coordinates, scale without enlargement, convert to sRGB and strip metadata. Return the encoded content type/length, ETag, conditional GET and HEAD semantics. Fail malformed inputs before rendering. Preserve established 400, 404, 413 and 504 behavior. Avoid exposing internal paths.
6. Include tenant/source, validated revision, transform profile version, format, width, quality and effective crop in the variant identity. Key ETags by representation. Only validated immutable revisions qualify for immutable public caching. Use revalidation for mutable public sources and a suitable private cache policy for private responses. A caller-supplied arbitrary version must never create an unlimited public cache namespace.

## Raspberry Pi and persistent cache

Default Node storage is a byte-bounded disk cache. Put cache data outside the originals and publish a completed file atomically. Use a recoverable index or reconcile disk contents on startup. Clean abandoned temporary files. Coordinate concurrent processes sharing a cache directory or explicitly require exclusive ownership. Keep accounting correct through duplicates, interrupted writes and restart. Skip caching objects larger than the byte budget. Protect source images during eviction.

Offer a separate RAM-only mode with a bounded in-process cache. On a small host start with one renderworker, a short width ladder, one quality and WebP/JPEG. The renderer must actually enforce this format list. Choose the disk byte quota, pending limit and concurrency from the available storage and measured peak memory. Record hardware and workload when quoting throughput.

Keep frequently used variants longer when space permits. Recency plus a hard byte cap is sufficient for a small deployment. Optional per-source top-K over a bounded time window can promote frequently accessed variants; expire cold variants. Apply per-source and global quotas even to promoted entries. Serving an original, granting a transform and retaining an encoded result are independent decisions.

## CDN and regional renderer

For an AWS-style deployment, perform access checks and canonicalization on the viewer-request path. Configure the distribution's cache policy to include ar, fmt, fx, fy, q, v and w when present. A verified token can be removed from the internal representation key only after each viewer request has been authorized. Carry a trusted source namespace through to the regional origin. Prevent bypass of viewer authorization at the origin and respect private browser-cache requirements. Use explicit formats for the reference loader. Third-party loaders declaring auto must use a matching negotiation and cache policy.

On a miss, check object storage, coordinate regional rendering by key, then publish the completed object conditionally. A conditional write alone can still allow duplicate encodes. Measure CDN hits as well as misses before ranking variants by popularity. CDN freshness and object retention are different controls. Storage lifecycle rules can expire cold classes independently of CDN eviction.

Use a local integration fixture or a reviewed provider configuration to verify two different focal crops get different cache entries, an unauthorized viewer cannot read a warm entry, revision rollover changes the bytes, equivalent spellings cannot fragment the cache, and concurrent misses produce a valid object. The first release supplies a working Node reference and integration guidance. A supported cloud adapter requires its own integration tests.

[CloudFront query-string policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/QueryStringParameters.html) · [CloudFront request events](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-cloudfront-trigger-events.html) · [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
