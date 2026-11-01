# Sale Pulse marketing packet

`GET /api/admin/sale-pulse` remains admin-only (`x-admin-token`) and uncached.
It now returns `salePulse.marketingPacket` (schema version 1) alongside the existing
analytics and marketing report. In Admin → Resumen → Sale Pulse, **COPIAR PAQUETE
PARA MARKETING** copies readable JSON. **COPIAR INFORME PARA MARKETING** still copies
the existing text report.

**COPIAR PARA CHATGPT** starts a new authenticated, uncached Sale Pulse request on
every click and copies a self-contained Spanish handoff for an ordinary ChatGPT
conversation. It includes the exact server-selected regular-campaign batch (at most ten Items),
current product and main-image URLs, and the optional Personal Google Drive
Marketing Production Desk folder. Selection ranks the full fresh eligible
catalog against trusted campaign history before serialization; no fixed
36-product shortlist remains. The complete batch must fit within 18,000 characters. It states the
snapshot time, total marketable count, included count, and that omitted Items
are not thereby sold or unavailable. The ending marker `FIN DEL PAQUETE MOVIL`
lets the receiving conversation detect paste truncation before recommending.
The newly fetched packet is final authority for current marketability, prices,
titles and quantities; older Drive preflight warnings cannot override it.
Story and WhatsApp links are derived from each product URL in the conversation.
If fewer than 10 marketable products exist, the handoff includes all eligible
products and explains the limit. If it cannot fit a safe complete handoff, it
copies nothing and shows a Spanish error. The separate raw packet button still
copies the full, unmodified `marketingPacket`. If refresh or clipboard write
fails, the button permits another click. On supported mobile browsers, the
clipboard write begins in the original tap gesture while the fresh request
resolves.

## Regular ChatGPT campaign: coverage, preparation and publication

The authenticated existing Sale Pulse endpoint now supports two explicit POST
actions for campaignId regular-chatgpt-daily-v1: prepare and confirm. GET remains
passive for campaign history. Only COPIAR PARA CHATGPT requests prepare; report,
raw-packet copy, ordinary refresh and downloads do not confirm publication.

### Minimal persistence and confirmation

Private Netlify Blobs files in mudanza-regular-chatgpt-marketing hold an immutable
baseline-v1.json anchor and versioned history-v1.json ledger. This reuses the
installed storage service and existing authenticated endpoint; no database,
migration, separate service, new Admin tab or independent-ad interface is added.
The browser cannot reliably read private synced Desk files and there is no actual
automatic social-publication signal in the existing Desk. Keeping the authoritative
ledger server-side permits dependable mobile/cross-device reads without Drive
credentials or manual file uploads. Desk folders and scripts remain unchanged.

The existing Sale Pulse panel shows prepared batches and their David/María Item
checkboxes. After actually posting, the seller clicks CONFIRMO PUBLICADOS once for
that person's completed batch. For partial posting, uncheck unposted Items before
confirming. Each request explicitly declares PUBLISHED_REGULAR_CAMPAIGN and must
match campaign, cycle, batch, person and assigned product IDs. Preparation,
approval, copying and downloading never set postedAt. No automatic publication or
messages are performed. Confirmation records the seller's declaration, not a
provider receipt; truthful confirmation is necessary.

The ledger retains stable product IDs, Item numbers, cycle identity, immutable
batch assignments, preparation times and per-Item confirmation times. Conditional
ETag writes and retry/re-read prevent lost concurrent updates. Repeated confirmation
preserves the original timestamp; reopening today's incomplete batch is idempotent.
A handoff preparation records PREPARED handoff evidence, not a claim that external
Story images were generated or published. Failed clipboard writes leave a
reopenable prepared batch and zero publication confirmations.

### Priority pass boundary and historical uncertainty

The higher-value pass uses the stable batch tag `passId: priority-over-50000-v1`.
The first priority preparation appends a tagged batch to the existing ledger using
the same conditional writes and verified readback. Its actual preparation time is
returned as `passStartedAt`; `startedAt` continues to identify the original cycle.
Untagged broad-campaign batches, all prior POSTED timestamps, preparation evidence,
and the immutable baseline remain intact. Earlier postings do not satisfy priority
coverage, including late confirmations on old batches. Only tagged pending batches
appear in the current confirmation panel. Existing old batch confirmations remain
valid for truthful earlier publications. Passive reads never establish a pass.
There is no date-based reset or automatic change on November 15.

Pre-deployment owner reconciliation: the new Admin panel hides untagged pending
broad-campaign batches, even before the first priority preparation. Before an
approved deployment, David and María must review those batches in the current
Admin interface and confirm only Items they can truthfully attest were actually
POSTED. Leave unpublished or unverifiable Items PREPARED; never confirm them just
to clear the list. Pause further publishing from unfinished broad-campaign batches
during cutover. If actual earlier publications still await verification or
confirmation, defer deployment until the owners reconcile them in the current
interface. The server still accepts valid old-batch confirmations with their
original identities, but the new panel no longer provides their controls. This
preflight is documented only; this PR does not migrate, delete, reset or reconcile
production records.

The first successful prepare initializes an auditable active coverage cycle with
its actual start timestamp and historicalCompleteness UNRECONCILED. Existing
trusted ledger records are never reset or replaced on later preparation. No old
POSTED records were found or invented. Items lacking confirmation are UNCONFIRMED
in this cycle, not asserted to have historically NEVER POSTED.

Read-only inspection of the regular Desk campaign folders dated October 21–27
provided 65 preparation references covering 51 stable Item IDs. The committed
regular-campaign-seed.mjs preserves asset provenance and preparation dates only.
These records preserve preparation provenance without overriding price ordering;
they never satisfy coverage. The known October 26–27
overlaps 120/063 and 007/144/195 are preparation evidence only. Historical coverage
remains explicitly unreconciled, without halting the valid active cycle.

### Actual selection and clipboard integrity

On prepare the server reads fresh authoritative Sale Pulse marketability and
the strong-consistency ledger. It ranks the entire eligible catalog, excluding
all Items already confirmed POSTED in this priority pass. Only marketable products
with purchasable stock and current asking price strictly greater than PYG 50,000
qualify, after the existing Admin/Netlify Blob overrides. No fixed list or count is
used. Protected products follow the same eligibility rule; no prices are changed.
Lower-priced products remain in the public catalog and raw Sale Pulse packet.
New selections rank current asking prices from highest to lowest, then Item number
and stable product ID for ties. Preparation evidence never outranks price. Take at most
ten, assigned five to David then five to María, with no overlap. Fewer remaining
first-pass Items produce fewer entries, never repeat fill. Reopening, including on a later date,
returns only still-eligible, unconfirmed assigned Items. Once those Items are all
confirmed (or no longer eligible), another click can prepare the next batch on the
same date: morning and afternoon need no new controls. Price changes never reshuffle
an unfinished batch. The pass identity, old assignments and POSTED timestamps stay
intact. Incomplete eligible product facts fail closed.

When no eligible unposted Items remain, preparation stops with a Spanish message
to reuse existing photos and messages; it creates no repeat batch or automatic
reposting process. Newly eligible unposted products can enter the same priority
pass later. Sold/held/unlisted Items never enter selection; confirmation of a
genuinely earlier publication is still allowed if the Item subsequently sold or
became unavailable. Legacy PHASE_2 records stay valid historical records.

The browser follows the exact server product IDs and person assignments. It no
longer ranks popularity/category lanes or trims away selected Items to fit a
shortlist. The complete selected batch, active-cycle metadata and unchanged
FIN DEL PAQUETE MOVIL marker must fit the 18,000-character limit; otherwise nothing
is copied. The regular ledger reads neither independent advertisements, email
delivery history nor Sale Pulse traffic/cart metrics. No independent-post action,
import field or reporting requirement exists.

### Marketplace drafts and reusable website messages

The existing public Sale Pulse allowlist now includes descriptions, condition and
defect notes, functionality, measurements, inclusions/exclusions, accessories,
payment/deposit fields, pickup dates and buyer logistics, plus all original photo
references after catalog overrides. No seller notes, questions or customer data
are exported. The mobile JSON retains complete nonempty listing facts in
`marketplace`; the existing absolute `mainImageUrl` is the cover, while
`additionalImages` preserves the other original references relative to the site
(or their original absolute URLs). Only positive vehicle/loading requirements are
included; omitted/blank facts remain unverified, never promises of no restrictions.
For DELAYED listings only, blank terms use the approved global fallback: 25%
deposit, final payment December 1–8, 2026, and pickup December 9–12, 2026. Explicit
Item-specific values/exceptions, including pickupAvailableDate, take precedence.
These are handoff instructions only; catalog, checkout and campaign records are unchanged.

For every assigned Item the handoff requests seven Spanish Marketplace fields:
photos/references, title, asking price, recommended category, condition, San Lorenzo
location, and a concise ready-to-copy description. Beyond required listing fields,
original photo references and URLs, posting TXT may include only confirmed condition,
dimensions, availability and the delayed-pickup terms below. Do not automatically
insert other auxiliary details, including routine defects, restrictions, immediate
payment requirements or delivery notices. Preserve complete source facts in the
handoff JSON for verification. Flag material defects/restrictions privately, outside
posting TXT, and do not mark an advertisement ready until the owner has resolved
any disclosure necessary to avoid misleading buyers.
Marketplace uses only original photographs: no promotional graphics, overlays,
screenshots or generated representations. DELAYED / RETIRO POSTERIOR descriptions
include `Seña: 25%` and applicable dates, unless a confirmed Item-specific exception
applies; never describe this disclosure as optional. Missing facts and questions
stay in separate private seller review, outside posting TXT. Read the Desk's existing
`Config/marketplace-overrides.json` to distinguish already-advertised Items from
new listings. Historical prices are not current prices. Each person's five entries
may include existing listings: no duplicate active ads or assumed absence. Unknown
status requires owner checking; recommend Renew only when Facebook offers it.
María removes sold listings;
David manages website inventory. No Marketplace account or tracking system is added.

The eight approved general website messages are fixed text, reused verbatim with
one shared link for Stories/Status (`https://www.thelabossieres.com/?src=story`) and
one for JW (`https://www.thelabossieres.com/?src=jw-group`). They promote the whole
catalog, including inexpensive Items. They are not regenerated per batch.
Instructions are concise to retain the complete batch and source facts
within 18,000 characters. If it does not fit, nothing is copied; no disclosure,
photo reference or selected Item is silently dropped.

### Owner-approved production format

Request exactly `David.txt` and `Maria.txt`, with simple English posting instructions
and natural Spanish buyer copy. Each file covers the same five assigned Items:
five Instagram Stories automatically shared to Facebook, five WhatsApp Status/Updates,
four staggered JW WhatsApp Group posts selected from those five, and five Marketplace
entries. Preserve shorter server assignments without filling from other Items.
Four JW posts per person means eight total, never a fifth post per person.

Social graphics must follow the approved Item 274 vertical 9:16 template, containing
only `VENTA POR MUDANZA`, Item number, authentic original photograph, product name
and current price. Reuse the same finished graphic for Instagram, Facebook Stories
and WhatsApp Status. No collages, website screenshots, product cards or AI-reconstructed
products. If the approved template is unavailable, request it rather than inventing
a replacement. No condition, defects, dimensions, availability, pickup or other
auxiliary information in social posting sections. Graphics also exclude descriptions
and URLs; direct product links belong in the TXT text/sticker instructions.
Keep only the approved verified details in Marketplace posting TXT. Material concerns
and seller-only questions belong in private review, with readiness blocked until
required disclosure is resolved. Website/checkout disclosures and product data are unchanged.

Stories entries identify Item number, graphic filename, direct `src=story` product
URL and `VER ARTÍCULO` sticker. Status entries use the same graphic, short copy and
direct `src=story` URL. JW entries contain short natural Spanish, name, current price,
direct `src=jw-group` URL and a correct native preview or original photo where needed.
Preserve URL parameters, preview-cache safeguards and David's publication approval.
Detailed phone control walkthroughs are left to the Desk rather than repeated in
the size-limited handoff.

### Separate Desktop Production Desk adjustments still required

Read-only inspection found that Admin instructions alone cannot enforce image production:

- Local `Documents/Moving Sale/Marketing Production Desk/templates/render_collages.py`
  still requires two or three Items per graphic, adds availability/pickup text and a
  website footer, and uses `VENTA DE MUDANZA`. Although 1080×1920, it does not implement
  the approved single-Item 274 template. Adapt or replace that local rendering path
  using the approved graphic; do not regenerate the product photograph.
- The local `START-HERE.txt` and `templates/desk-operating-instructions.txt` still
  describe collage output. Synced `Desktop/Google Drive/Moving Sale/Marketing Production
  Desk/Scripts/OPERATING-NOTES.txt` still requests pickup details in Status and permits
  a fifth group photo; `Scripts/dmpd-core.mjs` embeds the old Status guidance in exports.
  Align those instructions/exported guidance with the two TXT files, single-Item
  graphic, four JW posts per person, social exclusions, Marketplace TXT limits/private
  readiness review and original-only Marketplace images before producing another package.

These local files and the existing Marketplace history were inspected, not changed.
The approved sample graphic itself was not present in the inspected template paths;
provide it to the Desk for exact visual matching. This PR changes only the Admin
handoff, its tests and this documentation; it generates no package or graphics.

### Failure and deployment boundaries

Storage errors, malformed active history, mismatched cycle anchors or missing
history after initialization stop preparation; there is no stale/stateless
fallback or silent cycle reset. Other Sale Pulse metrics remain readable. If a
first initialization is interrupted, the next prepare can resume its provisional
history record with the original cycle ID, start time, preparation evidence and
initial batch. Initialization conditionally creates history-v1.json marked
PROVISIONAL, creates its matching immutable baseline anchor, then activates that
same history record as ESTABLISHED using its ETag. Concurrent requests adopt the
winning provisional record; a conflicting anchor is rejected. No handoff or
publication confirmation is allowed before activation. Ordinary GETs stay passive
and report setup as uninitialized until activation completes.

Recovery re-reads both strongly consistent files and never overwrites existing
history unconditionally. Failed writes, conditional-write conflicts and uncertain
activation responses can be retried. Activation uses onlyIfMatch, so a stale
recovery cannot recreate missing established history or replace newer POSTED
records. Established histories from the earlier format, without an initialization
marker, remain supported unchanged when their anchor matches. A missing/corrupt
established history, or a legacy baseline-only state with no trustworthy
provisional record, still requires recovery from verified records: neither is
silently recreated. Retain these files when backing up the site; never restore old
history over newer confirmations. Campaign history is separate from Desk assets
and from all operational business records.

All campaign conditional writes use an independently verified safeguard while
the dependency remains locked to @netlify/blobs 11.1.0. That SDK can incorrectly
return modified:true with an empty ETag after a rejected write. The campaign path
requires a valid nonempty strong write ETag and an authoritative strong-consistency
readback before acknowledging a change. Missing, blank, weak, wildcard or malformed
ETags fail safely; modified:true alone never advances or acknowledges history.

Baseline readback must match the immutable anchor. Ledger readback must retain the
same cycle and immutable metadata, every intended batch/assignment and every
intended POSTED timestamp/provenance, at an equal or higher revision. Additional
legitimate batches or confirmations are allowed; exact ETag equality is not
required after concurrent updates. Responses use the verified persisted ledger,
so another session's valid confirmations are retained. A newer revision alone
does not prove that the requested publication was recorded.

The SDK's modified:false result remains a genuine HTTP 412 precondition conflict
and follows the existing re-read/CAS retry path. Provider/transport failures and
unverifiable success fail the request instead of being interpreted as a conflict
or publication success. An uncertain write may actually have committed: its data
is never rolled back or cleared, and a retry can acknowledge it only from verified
durable history. These checks cover provisional history creation, baseline,
activation, preparation and publication confirmation. Real locked-SDK tests inject
HTTP responses without network access, including all six exhausted 503 attempts.

Code and tests alone do not initialize a production cycle. This PR makes no
production writes, real campaigns/images, emails, merge or deployment. After
separate deployment authorization, the first normal clipboard preparation starts
the baseline; the seller must confirm actual regular-campaign publications.

Verification uses synthetic catalog/history and an isolated conditional-write
store, covering multi-day full-catalog coverage, partial publication, PREPARED
versus POSTED, baseline uncertainty, Phase 2/new arrivals, concurrency, independent
input rejection, availability, copy instructions and mobile clipboard integrity.

## Authority and safety

Availability comes from passive server-side database reads, never Add to Cart.
`readPurchasableInventory()` uses the same inventory definition as before:
capacity minus committed units minus active CART and ORDER holds, clamped at zero.
The reader now also aggregates hold quantities and the earliest finite active
expiry in that same query. CART holds require an expiry strictly after database
`clock_timestamp()`. ORDER holds remain active when expiry is null or in the future.
COMMITTED reservations are not subtracted twice.

The authoritative catalog supplies current title, price, image, category, slug,
sale mode and remaining units. Catalog remaining stock caps purchasable stock;
the current inventory read also caps remaining stock if commitments changed
between reads. Operational inventory is initialized lazily by the reservation
path. After a successful inventory read, Sale Pulse completes its own in-memory
map for missing AVAILABLE products with a positive safe integer catalog
`quantityRemaining`: capacity and purchasable quantity equal that current value,
committed/CART/ORDER quantities are zero, and next release is null. The reservation
foreign key requires an operational row for every CART, ORDER or COMMITTED row,
so a missing operational row cannot have a reservation. Existing database rows
remain authoritative and are never replaced or mutated. This projection never
seeds or writes back inventory and is not used by checkout or carts.
Invalid/missing catalog quantities receive no fallback. Without a successful
inventory read, missing inventory still fails closed as `INVENTORY_NOT_VERIFIED`;
inventory read errors fail the request rather than returning a stale packet.
Existing public projection rules exclude internal NEEDS_REVIEW and UNLISTED
products from packet records and candidates. Delivered zero-stock products are
never marketable.

Sale Pulse never claims/updates a cart lease, creates a checkout, writes inventory
reservations, extends a hold, or releases another buyer's reservation. The existing
analytics-retention DELETE is preserved; explicit campaign POSTs write only the
separate campaign files described above. Reservation durations,
transactions, checkout and orders are unchanged. No migration is needed.

## States

| State | Meaning |
| --- | --- |
| MARKETABLE | Public AVAILABLE product with verified purchasable units > 0 |
| TEMPORARILY_RESERVED | No purchasable units; active CART holds |
| PENDING_PAYMENT_OR_CONFIRMATION | No purchasable units; active ORDER holds (including no-expiry orders) |
| SOLD | Public SOLD/PICKED_UP or no remaining stock |
| NOT_MARKETABLE | Internal/non-sale state, missing inventory or otherwise unavailable |

When holds exhaust stock, ORDER takes precedence over CART for mixed holds.
Three remaining units with one CART-held unit remain MARKETABLE with two
purchasable units. Hold quantities explain partial availability.
`nextReleaseAt` is only the earliest finite active hold expiry, not a promise that
all units become available then; a protected ORDER can have no expiry.

## Packet contract

- `schemaVersion`, `generatedAt`, `signalWindowDays`, `tracking` and `productUrlBasePath`.
- `inventory`: existing committed/catalog summary, kept unchanged.
- `marketabilitySummary`: marketable, temporarilyReserved,
  pendingPaymentOrConfirmation, sold, notMarketable and purchasableUnits.
  Counts cover the loaded catalog; internal product details are excluded.
- `traffic`: existing last24Hours, last7Days and sources metrics.
- `products`: public product records, including unavailable products with reasons.
- `marketableProducts`: only MARKETABLE product records.
- `signalLists`: product IDs for hotUnsold, lowNoInterest, attention,
  viewedButNotAdded and cartInterestWithoutSale (existing top-five limits).

Each product explicitly allows only productId, itemNumber, title, slug,
productUrl (site-relative), category, askingPricePYG, saleMode, mainImage,
quantityRemaining, purchasableQuantity, cartHeldQuantity, orderHeldQuantity,
nextReleaseAt, marketabilityStatus, marketabilityReason, seven-day views/cartAdds,
and boolean `signals` memberships. Relative product/image paths resolve against
the storefront origin used to load the packet. No AI ranking is added.
`mainImage` is the first current authoritative `product.images[0]`, matching the
production cover and respecting catalog image overrides/order. Empty, missing or
invalid cover arrays produce null; the packet does not reorder or change images.

No buyer identity/contact details, order/checkout/session/cart IDs, cookies,
tokens, receipt details/URLs, bank information, private seller/customer notes,
raw checkout snapshots or individual traffic events are copied into the packet.

All five recommendation lists require MARKETABLE; factual traffic/sales metrics
still count activity on held products. The existing 24-hour low-visibility guard
and deterministic signal ordering remain intact.

This is a point-in-time operational export. Refresh before choosing products;
another customer can reserve units after export. Future Work automation should
choose products from `marketableProducts`, using facts and signal lists, then
read a fresh packet before preparing a campaign. It must never probe with a cart.

## Verification

`npm test` includes isolated in-memory PostgreSQL fixtures (PGlite, test-only) that
execute the actual inventory aggregate for active/expired/no-expiry CART/ORDER,
committed, partial quantity and mixed-hold cases and compare reservations before
and after the read. Additional tests cover every signal exclusion, unchanged
traffic/windows, public-projection exclusions, privacy allowlists, authorization,
read failure, report copy and formatted JSON copy/retry.
Completeness tests also execute the actual inventory migration, prove its foreign
key rejects all three reservation phases without operational inventory, and
compare inventory/reservation/session/checkout tables before and after fallback.
They cover untouched stock, invalid quantities, catalog overrides, existing hold
authority, and fallback participation in all five signal lists.

Browser checks should use controlled fixtures where possible. Never manipulate
live buyer reservations or use Add to Cart to validate availability.
