# Authorized Revisión cleanup — deployment notes

This batch changes only the twelve historical Items approved by David on October 21, 2026. No general status manager, archive interface, marketing changes, or Volume 5 items are included.

| Items | Result |
| --- | --- |
| 017, 044, 053, 111, 117, 118, 128 | Archived; excluded from catalog, checkout, marketing and ordinary Admin inventory/Revisión. |
| 031 | Restored as approved, Gs. 170,000 unless a saved seller price supersedes it. One committed plant plus one separate remaining plant. |
| 090 | Restored, Gs. 750,000 unless superseded; original photographs, ignition disclosure, accessories and delayed pickup preserved. |
| 096, 132, 137 | SOLD, asking price zero, remaining zero; private reason REGALADO. No customer, order, payment or revenue entry is created. |

Item 096's historical quantity is corrected to one. Item 137 is identified as “Juego 7 en 1”, with seven different games and no invented game names. Original source records and media remain intact. Item 117's original set description, photograph and Gs. 90,000 price remain historical; its future panel listings belong exclusively to Volume 5.

## Live inspection and clarified commitment

The signed-in production Admin showed exactly the twelve requested pending records and 487 ordinary inventory records. None of the twelve was in the public catalog. Inspection of all 181 fulfillment lines across 74 batches found one match: Item 031 in paid order `VM-2026-042A512D`. David explicitly clarified that the recovered plant is **a separate remaining plant**, not the committed plant. The order and payment must remain unchanged. No other batch Item appeared in the fulfillment lines; the Admin showed zero awaiting-payment orders.

The existing Admin does not expose the operational capacity or raw reservation rows for these unpublished products. No production database or override was changed during preparation. Final operational availability must be checked after the approved release; source projection alone cannot certify current live stock or transient holds.

## Approved release procedure

1. Obtain final owner/governance approval before merging, deploying or applying SQL.
2. Apply `netlify/database/migrations/20261021_item031_remaining_plant.sql` through the site's database migration process with the approved release. It changes **only** Item 031, only if capacity is one and committed quantity is one, and only if the known paid commitment is still present. Capacity already two or higher is left unchanged. The SQL can be repeated without adding another unit after a subsequent sale. No schema or customer/order/payment data changes are required.
3. Deploy the approved code. If Item 031 has no operational row, has capacity below two, or lacks its existing commitment, it remains unavailable and pending Revisión instead of assuming that the stock is safe. Investigate any such discrepancy; do not manufacture or modify customer transactions. A conflicting committed quantity on a gifted Item likewise leaves that Item unresolved and unavailable.
4. Reload Admin and the storefront. Expected ordinary Admin inventory: 480 records, Revisión: zero when the operational checks pass. Public catalog gains the two restored Items and three non-purchasable SOLD records; delivered-item exclusions continue to apply normally.
5. Confirm Items 031 and 090 have one eligible unit each, subject to current holds, and retain their seller overrides/photos. Verify checkout rejects all archives and gifts. Do not place a test production order.
6. Confirm existing order `VM-2026-042A512D`, its payment and its fulfillment line are unchanged. Recheck gifted Items have price/remaining zero, Item 096 total one, and Item 137's corrected identification. Reload once more to verify persistence.

## Administrative historical retrieval

The existing authenticated `GET /api/admin/legacy-inventory` response includes `archivedProducts`, preserving all seven historical records, original photo filenames, saved Admin media and private fields, along with the owner's archival reasons. Its ordinary `products` array excludes archives, so the existing UI needs no new archive feature. Active gift records include a private `reviewDisposition` with reason REGALADO. Public projections do not include private disposition reasons.

The immutable ID/number allowlist is applied after saved overrides for gifts and before catalog admission for archives, so old overrides and source synchronization cannot resurrect them. Other IDs, including 045, 054 and 129, are unaffected.
