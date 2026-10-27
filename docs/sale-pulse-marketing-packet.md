# Sale Pulse marketing packet

`GET /api/admin/sale-pulse` remains admin-only (`x-admin-token`) and uncached.
It now returns `salePulse.marketingPacket` (schema version 1) alongside the existing
analytics and marketing report. In Admin → Resumen → Sale Pulse, **COPIAR PAQUETE
PARA MARKETING** copies readable JSON. **COPIAR INFORME PARA MARKETING** still copies
the existing text report.

**COPIAR PARA CHATGPT** starts a new authenticated, uncached Sale Pulse request on
every click and copies a self-contained Spanish handoff for an ordinary ChatGPT
conversation. It includes a compact, complete JSON subset selected only from the
fresh `marketableProducts` list, current product and main-image URLs, and the
optional Personal Google Drive Marketing Production Desk folder. The subset aims
for 36 varied candidates and fits within 18,000 characters. It states the
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

## October 27 clipboard correction — partial; rotation blocked

The handoff now requests a marketing text document for each person with five
individual Stories and five native WhatsApp Status entries using that person's
same five Items, with no David/María overlap. Each document requests **only four
JW Group product entries**, chosen from that person's five for likely sales
potential, or fewer when fewer than four valid Items exist. No additional Item
or fifth JW entry/photo is requested. Story/Status retain `src=story`; JW links
retain `src=jw-group`, and the existing link-preview and phone instructions stay.

Buyer-facing promotional copy requests name, price, a brief truthful description,
authentic photo and direct link. Routine payment/pickup dates, location,
pickup/delivery/transport arrangements, unrelated photo objects and administrative
disclaimers are omitted. An unusual material limitation must still be disclosed
when omission could mislead. Website/checkout terms, inclusions, exclusions and
disclosures are unchanged. This changes the handoff instructions, not existing
campaign assets or product records.

### Root cause and evidence

`mobileMarketingCandidates()` takes the current marketable catalog, interleaves
category/interest/low-exposure/Item-number lanes and stops at 36 (or fewer to fit
the clipboard). It reads no campaign history. With unchanged inputs it produces
the same shortlist on successive dates. The old prompt also permitted repeats
with a new angle. Neither preparation nor confirmed publication removes an Item
from those lanes. Marketable Items outside that shortlist can be omitted
indefinitely. The selector remains unchanged in this partial correction.

Read-only inspection of the existing Personal Drive Marketing Production Desk on
October 27, 2026 found:

- `Individual-Stories-2026-10-26-For-Approval` and
  `Individual-Stories-2026-10-27-For-Approval` contain the five repeated prepared
  Items: David 120/063 and María 007/144/195. The October 26 text files explicitly
  say “NOT YET POSTED”; October 27 files require David's approval. These are
  preparation evidence, not confirmed publication evidence.
- `Current/manifest.json` has `status: NO_CURRENT_MARKETING_PACKAGE` and an empty
  `selectedItems`. The separate dated Story folders are not represented there.
- `Scripts/dmpd-core.mjs` validates selected Items, creates preparation manifests
  (`PREPARED_REQUIRES_FINAL_SALE_PULSE`) and runs public availability preflight.
  `Scripts/OPERATING-NOTES.txt` describes export/archive and availability checks,
  not a regular-campaign publication-confirmation mechanism. The Logs folder
  contains availability-preflight results, not publication receipts.
- The website's `marketing_email_features` history is written after Resend
  accepts an email, and `recentMarketingHistory()` reads only 45 days by default.
  An email delivery is not a confirmed social publication and is a different
  workflow. Sale Pulse views/cart additions also cannot prove publication or
  distinguish independent advertisements.

No reliable, complete confirmed-publication history or Desk-to-Sale-Pulse history
reader was found in these relevant systems. Do not interpret missing records as
NEVER POSTED, a prepared asset as POSTED, or independent advertising as campaign
history. Existing history and Desk files were not changed.

### Governance blocker and smallest required remedy

**Strict first-pass rotation is not implemented or verified by this PR.** The
clipboard explicitly discloses the missing history and instructs the receiving
chat to stop selection when complete reliable regular-campaign history is
unavailable. This is a disclosure/instruction safeguard, not algorithmic rotation
enforcement. The 36-candidate coverage problem also remains unresolved.

Before expanding implementation, Governance needs to approve a reliable
publication-confirmation source within the regular campaign workflow and a
readable connection to the selector. The smallest proposed remedy is to extend
the existing Desk package/archive metadata, retaining campaign and product
identity, preparation evidence and a separate actual-publication confirmation
with timestamp/provenance. Reuse that history across all campaign dates; do not
infer completion from approval, an email send, traffic or a folder name. Establish
whether the historical baseline is complete before treating an absent Item as
never posted. No independent-advertisement tracking or reporting is needed.

Once that source and connection are authorized, selection must rank the **full**
fresh Sale Pulse marketable catalog before applying any clipboard size reduction:
never-posted before all repeats, unprepared first-pass before already-prepared
first-pass, fewer than ten when necessary, and no repeat fill. Only after all
currently eligible Items have confirmed regular-campaign publication may Phase 2
rank repeats by descending current price, without an invented threshold or routine
cheap repeats. Newly eligible never-posted Items immediately preempt Phase 2.
Missing/incomplete history must block selection. Synthetic multi-day tests must
prove that behavior, full-catalog coverage, PREPARED/POSTED separation and complete
exclusion of independent advertisements before claiming strict enforcement.

No new database, Admin interface, tracking subsystem, production integration or
manual reporting requirement was added. Rotation acceptance tests remain blocked;
the automated tests here verify clipboard copy requirements, availability gates,
link/phone safeguards, truncation/privacy limits, retry behavior and honest
history disclosure. No real campaign or image is generated for validation.

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
reservations, extends a hold, or releases another buyer's reservation. Its only
write remains the existing analytics-retention DELETE. Reservation durations,
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
