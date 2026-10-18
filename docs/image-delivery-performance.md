# Image delivery performance — governance report

Measured 2026-10-18. No production publish, merge, order, reservation, upload or inventory change was performed. Browser cart interactions used intercepted fixtures. The final preview uses the site's normal database connection; measurement contexts intercepted cart GETs with the same empty-cart fixture on both sides and blocked other non-GET requests. Initial read-only preview experiments caused cart GET errors, so those screenshots were discarded and both baseline and optimized homepage/product measurements were repeated with matching cart fixtures. Item 184's additional before/after sample used the earlier read-only preview with non-GET requests blocked; its image measurements are reported separately.

BASE origin/main: e15e5cbe802778e19033502601b71ed679b8f8f6
WORKTREE: C:\Users\davel\Documents\GitHub\psych-image-delivery-performance
BRANCH: fix/image-delivery-performance
STARTING HEAD: e15e5cbe802778e19033502601b71ed679b8f8f6
Original checkout: existing changes preserved; no implementation there.

## Delivery decision

IMAGE DELIVERY STRATEGY: Netlify Image CDN with a verified eligibility manifest; no static derivative binaries.

The existing preview successfully transformed JPG, uppercase JPG/JPEG, PNG and WebP, including inventory/, assets/media/, volume-2a/2b/3/4, versioned sources and all 19 current Blob URLs. A separate image-format preview verified a copied original with EXIF 6 at .JPEG and a synthetic semitransparent PNG. Both preserved orientation/aspect; PNG retained alpha. [Netlify's official documentation](https://docs.netlify.com/build/image-cdn/overview/) documents the same-origin endpoint and fit=contain behavior.

Verification checked 755 unique canonical sources: 741 public images plus 14 additional shell sources (including brand). There were zero unresolved sources. 749 sources have at least one approved size: 744 small, 737 medium, one brand. All approved responses were smaller than their sources, did not upscale, retained the complete proportional frame within one pixel of rounding, and retained transparency when meaningful. Twenty-seven size candidates were rejected: 22 were not smaller and 5 exceeded the conservative one-pixel dimension tolerance. Six sources have no approved size. These retain originals; there are no missing generated files.

CARD STRATEGY: 720 × 720 maximum bounds, contain, WebP quality 85. Catalog, related cards, cart rows, teaser and gallery/lightbox thumbnails share the resolver. Catalog cards keep lazy loading; decoding is asynchronous. No cropping, additional eager loading, or changes to click/add-to-cart behavior.

DETAIL STRATEGY: 1440 × 1440 maximum bounds, contain, quality 85. The measured desktop main image box is 402 × 332 px, gallery thumbnails 65 × 66 px, mobile card photos approximately 148 × 226 px; brand 84 × 63 desktop / 70 × 53 mobile. The selected bounds allow density headroom; no source is enlarged. Pre-existing CSS object-fit:contain is preserved.

LIGHTBOX ORIGINAL STRATEGY: every gallery/teaser img stores data-original-src. The lightbox reads those originals in gallery order and matches the clicked original, retaining deduplication, zoom, pan, keyboard and focus behavior. Only its active full-photo image requests an original. Lightbox thumbnail requests use the same small delivery resolver. There is no original preload.

DYNAMIC IMAGE FALLBACK: currently verified Blob keys use CDN. Future keys and unknown sources immediately render the original. Any CDN error retries data-original-src once, removing srcset. New uploads do not require a Git commit to display. Keeping a verified allowlist instead of blindly transforming new objects guarantees known transformations are useful and avoids enlarging already efficient photos. Refreshing the manifest opts new images into optimization.

QUERY STRINGS: only v is removed from the eligibility lookup; the full original query remains nested in the CDN url parameter. Blob key and all other identity-bearing parameters remain in the lookup. Two different keys cannot share a derivative. External URLs fall back unchanged.

The head loads the small generated manifest and resolver before image markup, allowing failed static image requests to recover too. The maintained HTML shell's display src attributes use the same CDN scheme. This is necessary because browsers were fetching hidden shell catalog photos even on product pages. Embedded product data was not rewritten. The markup refresh tool is repeatable and returns an image to its original if eligibility is removed.

## Public image audit

TOTAL public products: 381
TOTAL image references: 745
UNIQUE image references: 741
Repository-local: 722 distinct files, 715,200,321 bytes (682.07 MiB)
Dynamic/Blob: 19 unique, 3,296,046 bytes
Unresolved: 0
External URLs: 0
Total unique public source bytes: 718,496,367
Products with image overrides relative to base: 33; references on those products: 100. These overlap source categories rather than forming another disjoint category.
Current optimized public WebP: 282 (all Volume 4). Other local public files: 440 JPEG. No current public product PNG or .JPEG extension; the brand PNG and separate .JPEG fixture were tested.
Median local bytes: 333,652; maximum: 7,772,713.

| Source category | Unique | Local bytes | Median bytes | Max bytes |
| --- | ---: | ---: | ---: | ---: |
| assets/media | 49 | 55,087,423 | 326,454 | 7,772,713 |
| images/volume-2 | 198 | 101,408,964 | 240,956.5 | 4,576,910 |
| override/product-media | 19 | 0 | 0 | 0 |
| inventory | 3 | 869,646 | 292,552 | 309,924 |
| images/volume-3 | 190 | 472,439,846 | 2,944,965.5 | 6,226,858 |
| images/volume-4 | 282 | 85,394,442 | 249,549 | 990,934 |
| other | 0 | 0 | 0 | 0 |

images/volume-2 includes existing volume-2a and volume-2b directories. The detailed JSON lists every source, dimension, EXIF orientation, category and format.

## Largest 20 local public sources

1. assets/media/real-20260828-19-0.jpg?v=1789322487199 — 7,772,713 bytes; 4032 × 3024; jpeg; EXIF 6
2. assets/media/real-20260828-52-1.jpg?v=1789747700900 — 6,688,361 bytes; 4590 × 8160; jpeg; EXIF 1
3. /images/volume-3/IMG_8246.JPG — 6,226,858 bytes; 4032 × 3024; jpeg; EXIF 6
4. assets/media/real-20260828-45-1.jpg?v=1789747676028 — 6,168,998 bytes; 4590 × 8160; jpeg; EXIF 1
5. /images/volume-3/IMG_8050.JPG — 5,129,568 bytes; 4032 × 3024; jpeg; EXIF 1
6. /images/volume-3/IMG_8031.JPG — 4,958,546 bytes; 4032 × 3024; jpeg; EXIF 1
7. /images/volume-3/IMG_8033.JPG — 4,775,634 bytes; 4032 × 3024; jpeg; EXIF 1
8. /images/volume-3/IMG_8329_right90.jpg — 4,666,788 bytes; 3024 × 4032; jpeg; EXIF 1
9. /images/volume-2a/PXL_20260918_010258398.jpg — 4,576,910 bytes; 4590 × 8160; jpeg; EXIF 1
10. /images/volume-3/IMG_8205.JPG — 4,503,149 bytes; 4032 × 3024; jpeg; EXIF 1
11. /images/volume-3/IMG_8293.JPG — 4,465,156 bytes; 4032 × 3024; jpeg; EXIF 6
12. assets/media/real-20260828-01-0.jpg?v=1789311777876 — 4,451,022 bytes; 4590 × 8160; jpeg; EXIF 1
13. /images/volume-3/IMG_8176.JPG — 4,419,337 bytes; 4032 × 3024; jpeg; EXIF 6
14. /images/volume-3/IMG_8247.JPG — 4,360,855 bytes; 4032 × 3024; jpeg; EXIF 6
15. /images/volume-2a/PXL_20260918_010239970.jpg — 4,353,043 bytes; 4590 × 8160; jpeg; EXIF 1
16. /images/volume-3/IMG_8295.JPG — 4,295,392 bytes; 4032 × 3024; jpeg; EXIF 6
17. /images/volume-3/IMG_8003.JPG — 4,216,320 bytes; 4032 × 3024; jpeg; EXIF 1
18. /images/volume-3/IMG_8291.JPG — 4,122,385 bytes; 4032 × 3024; jpeg; EXIF 6
19. /images/volume-3/IMG_8188.JPG — 4,094,421 bytes; 4032 × 3024; jpeg; EXIF 1
20. /images/volume-3/IMG_8216_left90.jpg — 4,047,050 bytes; 4032 × 3024; jpeg; EXIF 1

## Representative source and delivered responses

These are response body bytes, excluding HTTP headers. Full delivered URLs and byte/percentage savings are in wire-evidence.json.

| Surface | Original bytes (dimensions, format) | Delivered bytes (dimensions, format) | Reduction |
| --- | ---: | ---: | ---: |
| Brand | 3,293,424 (1448×1086, png) | 9,938 (252×189, webp) | 99.70% |
| Item 001 card | 4,451,022 (4590×8160, jpeg) | 27,342 (404×720, webp) | 99.39% |
| Item 001 detail | 4,451,022 (4590×8160, jpeg) | 46,488 (810×1440, webp) | 98.96% |
| Volume 3 / Item 184 card | 2,451,079 (4032×3024, jpeg) | 33,346 (720×540, webp) | 98.64% |
| Volume 3 / Item 184 detail | 2,451,079 (4032×3024, jpeg) | 76,486 (1440×1080, webp) | 96.88% |
| Volume 4 / Item 327 card | 101,546 (1275×2400, webp) | 15,770 (382×720, webp) | 84.47% |
| Volume 4 / Item 327 detail | 101,546 (1275×2400, webp) | 44,968 (765×1440, webp) | 55.72% |

BRAND: 3,293,424 bytes, 1448 × 1086 PNG → 9,938 bytes, 252 × 189 WebP; 99.70% reduction. Header and footer share this 3× maximum-density source. Original PNG retained.

## Browser transfer comparison

Chromium, clean context and disabled HTTP cache, service workers blocked, no scroll before initial capture, no throttling. Desktop 1440 × 1000; mobile 390 × 844. Initial capture occurs six seconds after authoritative catalog readiness. All measured image responses had completed (no zero-byte pending entries). CDP encodedDataLength includes HTTP overhead; this is intentionally different from body-only source/derivative sizes above. Cart sync was a matched empty fixture in both runs; non-GET requests were blocked. Browser image count and naturally loaded photos were not reduced. These are single observations, not timing distributions or a controlled latency claim.

| Surface | Requests before / after | Image bytes before / after | Largest before / after | Reduction |
| --- | ---: | ---: | ---: | ---: |
| home-desktop | 21 / 21 | 22,165,447 / 1,486,885 | 7,777,086 / 128,823 | 93.29% |
| home-mobile | 9 / 9 | 9,671,967 / 354,745 | 4,453,578 / 86,036 | 96.33% |

Desktop page transferred bytes: 22,421,800 → 1,727,973.
Mobile page transferred bytes: 9,929,360 → 595,708.
Catalog-ready time from navigation: desktop 3036 → 2165 ms; mobile 2279 → 2647 ms. This measures truthful catalog insertion, not completed image decode. Timing varies; no latency speedup is claimed from these single samples.
Each measured route used one catalog request and returned the same 381 products. At the unscrolled homepage viewport the brand is visible and catalog photos fall below the filter area; normal browser lazy-load proximity still fetched 20 desktop / 8 mobile product images. Scrolled desktop/mobile screenshots confirm photos appear naturally.

| Product page | Initial image bytes before / after | Reduction | Additional wire bytes on main lightbox open | Original available |
| --- | ---: | ---: | ---: | --- |
| Item 1 | 25.61 MiB / 1.18 MiB | 95.39% | 4,453,644 | yes |
| Item 184 | 46.55 MiB / 1.39 MiB | 97.01% | 2,452,620 | yes |
| Item 327 | 23.53 MiB / 1.47 MiB | 93.75% | 101,776 | yes |

The lightbox previously triggered zero new bytes because originals were already fetched. Afterward the selected full original is requested on demand. Item 001's original was absent before opening. The Volume 4 sample retains its small efficient originals where recompression was not useful. Item 169 was additionally tested: 40.44 MiB → 1.62 MiB, with its original available on demand.

Decode observation: Item 001 normal main natural size falls from 4590 × 8160 (37.45 MP) to 810 × 1440 (1.17 MP); card derivative 404 × 720 (0.29 MP). This demonstrates reduced decode input dimensions; CPU decode time was not separately profiled.

## Browser and regression validation

- Desktop/mobile: normal brand and photos; no visible broken photos; Item 001 first; initial 48 cards; search, progressive render, and actual scroll-position restoration after detail/back passed. The final JSON records restored scroll positions.
- Cart: intercepted lease for Item 19; optimized photo; one sync and one catalog request; quantity control and reservation deadline visible. No real reservation or order was created.
- Lightbox: Item 001 desktop/mobile, Item 169, Item 327; original source and clicked index; next/previous, 125% zoom, drag, Escape and focus return passed. Item 184 separately confirmed its original full photo.
- Dynamic fallback: unknown identity query on a real Blob photo rendered the original successfully. Aborting the CDN request recovered the original without a broken display.
- Visual review: 12 original/display pairs, including dark and light furniture, upholstery discoloration, appliance labels, surface wear, thin metal, plants, portrait and landscape photos, and brand. No material color, condition, proportion, object or framing change observed at normal display size. True-alpha PNG checked separately; no public product PNG has transparency.
- Social preview: available and SOLD responses retain canonical full/source images; full public catalog deep-equals production. Admin photo-management code and backend code are unchanged.
- PR #42 truthful-loading, PR #38 history, and PR #43 performance suites pass. No backend performance code changed; no cache or orchestration changes.

FOCUSED TESTS: 129 passing, 0 failing, including product detail/social, catalog cards, cart/reservations, loading, history and catalog performance.
FULL npm test: 375 passing, 0 failing (baseline 354; 21 new focused tests).
SYNTAX: all modified JS/MJS checked; pass.
git diff --check: pass.

PRODUCT.images CONTRACT CHANGED: NO
ORIGINAL FILES OVERWRITTEN: NO
ORIGINAL FILES REMOVED: NO
CROPPING INTRODUCED: NO
RETOUCHING INTRODUCED: NO
STATIC DERIVATIVE FILE COUNT: N/A (0)
STATIC DERIVATIVE TOTAL SIZE: N/A (0 bytes)
Repository growth: delivery metadata, resolver, tools, tests and documentation only. No duplicate image binaries or runtime image-processing dependency. Sharp was already a development dependency.

NETLIFY PREVIEW: https://image-delivery-performance--fastidious-marigold-b723dd.netlify.app
UNEXPECTED SCOPE: none. HTML display attributes needed optimization in addition to requested runtime surfaces because of measured hidden-shell downloads. A small separate fixture deploy validated .JPEG and PNG alpha; no fixture binaries were committed.

REMAINING PERFORMANCE BOTTLENECKS:
1. Hidden static catalog shell still causes redundant proximity image requests on product routes; bytes are now small. Removing the duplicate rendering shell is a separate rendering workstream requiring loading/history review.
2. Authoritative catalog/network startup still determines truthful catalog readiness; timing varied despite major image savings. No additional backend change is recommended from these single timing samples.
3. Future unknown uploads safely use originals until reverified; this favors source correctness over unmeasured transformation. The current allowlist refresh command below is the maintenance path.

RECOMMENDED NEXT PERFORMANCE WORK: investigate hidden-shell request elimination with browser timing evidence; preserve truthful loading and history behavior. No blind compression or new backend cache is recommended.

COMMIT: see PR / final response.
PR NUMBER / URL: see final response.
READY FOR GOVERNANCE REVIEW: YES. Do not merge.

## Reproduce delivery verification

From the clean repository worktree, save a fresh public catalog JSON, then run:

```powershell
node tools/image-delivery/verify.mjs public-catalog.json https://your-preview.netlify.app verification-report.json
node tools/image-delivery/sync-markup.mjs
npm test
```

Use this refresh whenever deployed static originals change or new uploaded keys should gain verified optimization. The verifier reads originals and requests CDN results, then writes only the manifest and report. It never creates, overwrites or removes original photo files. Unknown images continue displaying during this process.

## Current rendered first 48 primary photos

The default storefront excludes sold products; this is distinct from the raw catalog's first 48 entries, which are also included in the audit JSON.

1. Item 001 — /assets/media/real-20260828-01-0.jpg?v=1789311777876
2. Item 003 — /assets/media/real-20260828-03-0.jpg
3. Item 004 — /assets/media/real-20260828-04-0.jpg
4. Item 006 — /assets/media/real-20260828-06-0.jpg
5. Item 007 — /assets/media/real-20260828-07-0.jpg
6. Item 008 — /assets/media/real-20260828-08-0.jpg
7. Item 012 — /assets/media/real-20260828-12-0.jpg
8. Item 014 — /assets/media/real-20260828-14-0.jpg
9. Item 016 — /assets/media/real-20260828-16-0.jpg
10. Item 018 — /assets/media/real-20260828-18-0.jpg
11. Item 019 — /assets/media/real-20260828-19-0.jpg?v=1789322487199
12. Item 020 — /assets/media/real-20260828-20-0.jpg
13. Item 023 — /assets/media/real-20260828-23-0.jpg?v=1789316746427
14. Item 024 — /assets/media/real-20260828-24-0.jpg
15. Item 027 — /assets/media/real-20260828-27-0.jpg
16. Item 028 — /assets/media/real-20260828-28-0.jpg
17. Item 030 — /assets/media/real-20260828-30-0.jpg
18. Item 035 — /assets/media/real-20260828-35-0.jpg
19. Item 038 — /assets/media/real-20260828-38-0.jpg
20. Item 039 — /assets/media/real-20260828-39-0.jpg
21. Item 042 — /assets/media/real-20260828-42-0.jpg
22. Item 043 — /assets/media/real-20260828-43-0.jpg
23. Item 045 — /assets/media/real-20260828-45-0.jpg
24. Item 046 — /assets/media/real-20260828-46-2.jpg?v=1790012513514
25. Item 047 — /assets/media/real-20260828-47-0.jpg
26. Item 049 — /assets/media/real-20260828-49-0.jpg
27. Item 050 — /assets/media/real-20260828-50-0.jpg
28. Item 052 — /assets/media/real-20260828-52-0.jpg
29. Item 056 — /images/volume-2a/IMG_8127.JPG
30. Item 063 — /images/volume-2a/IMG_7808.JPG
31. Item 065 — /images/volume-2a/IMG_7815.JPG
32. Item 068 — /images/volume-2a/IMG_7826.JPG
33. Item 073 — /images/volume-2a/IMG_7833.JPG
34. Item 080 — /images/volume-2a/IMG_7846c.jpg
35. Item 083 — /images/volume-2a/IMG_7850.JPG
36. Item 084 — /images/volume-2a/IMG_7851.JPG
37. Item 088 — /images/volume-2a/IMG_7858.JPG
38. Item 091 — /images/volume-2a/IMG_7867.JPG
39. Item 092 — /images/volume-2a/IMG_7868.JPG
40. Item 093 — /images/volume-2a/IMG_7874.JPG
41. Item 094 — /images/volume-2a/IMG_7870.JPG
42. Item 095 — /images/volume-2a/IMG_7879.JPG
43. Item 097 — /images/volume-2a/IMG_7882.JPG
44. Item 098 — /images/volume-2a/IMG_7883.JPG
45. Item 100 — /images/volume-2a/IMG_7886.JPG
46. Item 101 — /images/volume-2a/IMG_7889.JPG
47. Item 102 — /images/volume-2a/IMG_7891.JPG
48. Item 104 — /images/volume-2a/IMG_7906.JPG
