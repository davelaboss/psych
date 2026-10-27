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
Marketing Production Desk folder. Selection ranks the full fresh marketable
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

### Dated baseline and historical uncertainty

The first successful prepare initializes an auditable active coverage cycle with
its actual start timestamp and historicalCompleteness UNRECONCILED. Existing
trusted ledger records are never reset or replaced on later preparation. No old
POSTED records were found or invented. Items lacking confirmation are UNCONFIRMED
in this cycle, not asserted to have historically NEVER POSTED.

Read-only inspection of the regular Desk campaign folders dated October 21–27
provided 65 preparation references covering 51 stable Item IDs. The committed
regular-campaign-seed.mjs preserves asset provenance and preparation dates only.
These records put previously prepared/unconfirmed Items behind Items with no
preparation evidence; they never satisfy coverage. The known October 26–27
overlaps 120/063 and 007/144/195 are preparation evidence only. Historical coverage
remains explicitly unreconciled, without halting the valid active cycle.

### Actual selection and clipboard integrity

On prepare the server reads fresh authoritative Sale Pulse marketability and
the strong-consistency ledger. It ranks the entire eligible catalog, excluding
all Items already confirmed in the active cycle while any eligible Item remains
unconfirmed. Within first pass, Items without preparation evidence precede
prepared/unconfirmed Items; older preparations precede newer ones. Take at most
ten, assigned five to David then five to María, with no overlap. Fewer remaining
first-pass Items produce fewer entries, never repeat fill. Same-day reopening
returns only still-marketable, unconfirmed assigned Items; future dates advance
through the catalog. Incomplete current product facts fail closed.

Only when every then-marketable Item has confirmation does Phase 2 select by
descending current asking price, without an invented threshold. It excludes Items
already prepared that day. Newly marketable unconfirmed Items immediately restore
first-pass priority, including over a prepared Phase 2 handoff. Sold/held/unlisted
Items never enter selection; confirmation of a genuinely earlier publication is
still allowed if the Item subsequently sold or became unavailable.

The browser follows the exact server product IDs and person assignments. It no
longer ranks popularity/category lanes or trims away selected Items to fit a
shortlist. The complete selected batch, active-cycle metadata and unchanged
FIN DEL PAQUETE MOVIL marker must fit the 18,000-character limit; otherwise nothing
is copied. The regular ledger reads neither independent advertisements, email
delivery history nor Sale Pulse traffic/cart metrics. No independent-post action,
import field or reporting requirement exists.

### Preserved copy policy

Each person's marketing text document requests five Stories and five native
WhatsApp Status entries using their same five assigned Items (or fewer when the
batch is short), and only four JW Group product entries chosen from that person's
five for likely sales potential, or fewer when necessary. No additional product
or fifth JW entry/photo. Preserve src=story for Stories/Status and src=jw-group for
JW, authentic photographs, preview-cache safeguards, phone/Marketplace workflows
and David's publication approval.

Promotional text focuses on name, price, a brief truthful description, authentic
photo and direct link. Routine payment/pickup dates, location, delivery/transport,
unrelated photo objects and administrative disclaimers are omitted. Retain unusual
material limitations when omission could mislead. Website/checkout sale terms,
inclusions, exclusions, disclosures and all product records remain unchanged.

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
