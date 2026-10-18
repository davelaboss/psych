# Sale Pulse marketing packet

`GET /api/admin/sale-pulse` remains admin-only (`x-admin-token`) and uncached.
It now returns `salePulse.marketingPacket` (schema version 1) alongside the existing
analytics and marketing report. In Admin → Resumen → Sale Pulse, **COPIAR PAQUETE
PARA MARKETING** copies readable JSON. **COPIAR INFORME PARA MARKETING** still copies
the existing text report.

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
