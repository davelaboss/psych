# Public catalog backend performance

Measured 2026-10-18 from base `f3e8e3484a6acdc67281eb3abdd701a71dac8811`
(PR #42). No production deployment or commerce mutation was performed.

## Source and implementation

The maintained legacy source is the committed root `index.html`. `netlify.toml`
publishes this file directly; the older `source/lib/phase2-batch.ts` is historical
input and does not contain all subsequently approved public corrections. The
current committed HTML and deployed homepage produced identical base catalogs
before implementation. No second maintained catalog was created.

`loadBaseCatalog()` now reads the deployment's bundled `index.html` locally.
The existing embedded parser and merchandising merge remain unchanged. Global
Netlify `included_files` bundles that same file for **all** functions, including
admin, cart, checkout, marketing and product social-preview consumers of the
shared catalog loader. The catalog loader no longer fetches `/`. The product
social-preview handler still fetches its HTML shell as before.

`loadCatalog()` starts base products, product overrides and committed inventory
with `Promise.all()`. They have no ordering dependency: each reader returns its
own result without modifying another reader's inputs. The existing override,
inventory, Item 054/058 correction and sort operations run after all three finish.
Delivery rows continue to run in parallel in `loadPublicCatalog()`.

Override loading uses eight workers, retaining results at their list indexes.
This preserves deterministic `productId` mapping and last-entry precedence even
when reads finish out of order. Both the store and individual reads retain
`consistency: 'strong'`. List/read errors reject the catalog; null Blob values
retain the existing skip behavior. The SDK already collects listing pages.

No cross-request memoization was added. Every request rebuilds the static base
and reloads overrides, committed inventory and delivery state. The public schema,
endpoint `Cache-Control: no-store` and client `cache: 'no-store'` are unchanged.

## Measurement method

Seven sequential GETs per endpoint: retain the first observation separately and
report the following six as warm-intent samples. Netlify does not expose instance
identity here, so neither a confirmed cold start nor instance reuse is claimed.
TTFB is time to fetch response headers; total includes consuming the JSON body.
All requests ran from the same Windows machine, without orders or reservations.

Temporary `AsyncLocalStorage` profiling and `Server-Timing` headers were deployed
only to manual comparison previews. They were removed before committing.
Both previews read the same site-scoped strong-consistency Blobs and the same
database, with `default_transaction_read_only=on` set for the preview connection
(verified with `SHOW`). No database configuration or credentials are committed.
The previews initially failed to start due to manual-deploy environment/bundling
configuration; those failed requests are excluded, and only successful,
equivalent full catalog responses appear in these samples.

Instrumented baseline: deploy `6ad4b7d1f1d41c9b37b15cd0`.
Instrumented optimized: deploy `6ad4b8af8a9dd57fc6901576`.
Clean implementation preview: deploy `6ad4b92119c9bb41c78f2560`.

| Follow-up endpoint samples (ms) | Min | Median | Max |
| --- | ---: | ---: | ---: |
| Unmodified production total | 2632 | 3018 | 3252 |
| Baseline comparison preview total | 2830 | 2904 | 3094 |
| Optimized comparison preview total | 695 | 785 | 912 |
| Baseline comparison preview TTFB | 2720 | 2772 | 2829 |
| Optimized comparison preview TTFB | 575 | 591 | 668 |

Comparable preview median total improvement: **73.0%**. Server public-catalog
preparation improved **86.6%**, from 2508.8 ms to 336.2 ms.
First-observed total requests were 3851 ms before and 2301 ms after; these are
not certified cold-start measurements.

| Server stage, median (ms) | Before | After |
| --- | ---: | ---: |
| Entire base catalog | 33.840 | 9.682 |
| Root HTTP response headers | 13.563 | removed |
| Root response text | 10.550 | removed |
| Bundled file read | n/a | 1.872 |
| Embedded parse | 0.804 | 1.117 |
| Merchandising product construction | 4.166 | 5.764 |
| Override list | 29.585 | 29.378 |
| Override reads, elapsed wall time | 2446.273 | 296.817 |
| Entire override loading | 2474.835 | 335.420 |
| Committed inventory | 2.861 | 16.787 |
| Fulfillment delivery rows | 6.677 | 18.669 |
| Override + inventory + corrective projection and sort | 0.313 | 0.432 |
| Public delivery projection | 0.158 | 0.279 |
| JSON response creation | 2.992 | 4.051 |
| Entire `loadPublicCatalog()` | 2508.808 | 336.215 |

There were **82 override Blobs** on every measured request. Before optimization,
the median sum of individual read durations was 2445.567 ms, approximately
29.82 ms/read. Afterward, summed read time was 2288.610 ms, approximately
27.91 ms/read; it overlaps across workers and must not be confused with wall
time. Wall time is computed per sample as override total minus listing time.
Stage medians are independent and should not be added to reconstruct a sample.
The synchronous projection was measured as one combined stage, without changing
its behavior. Database reads are fresh and overlap with base/Blob work afterward.

## Homepage and contract checks

Six fresh browser contexts per comparison preview, desktop 1440 x 1000, normal
assets, no throttling. Non-GET browser requests were blocked to avoid analytics
or commerce writes. A mutation observer recorded removal of the existing
`catalog-route-pending` class. Each successful navigation made exactly one
catalog request and rendered 381 authoritative products, without an error state.
The first observation was excluded from the five-sample summaries.

| Truthful loading duration (ms) | Min | Median | Max |
| --- | ---: | ---: | ---: |
| Baseline preview, from navigation | 3244 | 3988 | 4600 |
| Optimized preview, from navigation | 1112 | 1364 | 2445 |

From catalog request start to truthful catalog readiness, medians were
3002 ms before and 885 ms after. Asset delivery/startup accounts for variation
before the request; no client or image changes were made.

The full clean-preview JSON response deep-equals the baseline, including all
381 products. Serialized SHA-256:
`14e5fc396fc74e869c86d4fa9d07fb30f5a6c20e394ed7fb9432b0c41fefbd7b`.
Decoded bytes remain **391,979**. Explicit gzip wire GETs measured 43,582 bytes
on production and 43,406 bytes on the clean preview; locally gzipping the
identical decoded bodies yields 41,328 bytes in both cases. Small server gzip
differences are not a payload optimization. No fields were removed.

Read-only deployed smoke checks verified available and SOLD product social
images; delivered Item 009 is absent from the normal catalog, returns exactly
`id`, `slug`, `title`, `itemNumber`, `category` when explicitly requested, and
does not receive normal product-photo social metadata. Delivered responses
deep-equal the baseline. Fixture regressions additionally cover UNLISTED and
NEEDS_REVIEW exclusion, partial/full inventory commitments, seller confirmations,
image overrides, Item 054/058 corrections and failure propagation.

## Validation and follow-up

- Original baseline: 335 passing, 0 failing.
- New focused optimization tests: 19 passing.
- Broader focused suites (catalog, social preview, cart/reservation/payment,
  discovery/history, fulfillment and PR #42 loading): 166 passing, 0 failing.
- Full `npm test`: 354 passing, 0 failing.
- Production JS syntax and `git diff --check`: pass.
- No database migration, new endpoint, inventory/fulfillment cache, image work,
  commerce transaction changes, pricing/content changes or client rewrite.

Strong-consistency Blob reads remain the principal server cost (roughly 0.3 s).
Network/runtime overhead and transfer now account for a larger share of total
time. Root-file parsing and projection are inexpensive; static memoization and
a payload rewrite are not justified by these measurements. The next approved
performance workstream remains oversized images and brand imagery.
