# Held listings and public availability

Investigation snapshot: November 13, 2026, 21:52 UTC; production source `f38f87d`.
All reads used current Admin overrides, operational inventory/reservations and two
fresh catalog requests (no cookie and an unrecognized random session). No live
purchase, Admin write, inventory change or deployment was performed.

## Item by item evidence

All four have capacity 1, committed quantity 0, active held quantity 1 and **zero
units purchasable by a new customer**. None is partially reserved or uninitialized.

| Item | Admin/public price | Mode | Active hold | Frozen accepted unit price |
|---|---:|---|---|---:|
| 216 | 100,000 | Delayed, 25% | Protected ORDER; no expiry | 50,000, 25% deposit |
| 447 | 55,000 | Immediate | CART; expires 23:01:13 UTC in this snapshot | 55,000, pre-PR-76 agreement |
| 275 | 50,000 | Immediate | Protected ORDER; no expiry | 25,000 |
| 413 | 50,000 | Immediate | Protected ORDER; no expiry | 25,000 |

216/275/413 have current asking-price overrides; 447 uses the authoritative base
price without an override. Existing agreements must remain intact. Item 447's cart
was accepted at 21:01 UTC, before PR #76 was published at 21:33 UTC; it is not a new
undiscounted offer after that correction. A shared cart deadline can change through
normal customer activity; no expiry is promised for protected ORDER holds.

Final readback at **22:08 UTC**: 216 and 275 have since transitioned to SOLD,
remaining quantity 0, with COMMITTED inventory at the same accepted 50,000/25,000
unit prices. 413 remains protected by an ORDER hold at 25,000; 447 remains held in
its CART at 55,000. These live business transitions happened during the read-only
investigation; they are distinct from the earlier snapshot and were not performed
by this work.

Incognito cannot clear another buyer's global inventory hold. Both fresh catalog
requests returned identical prices across all 292 AVAILABLE records. All four
operational rows already exist, so prior initialization is not their cause.

## Why the previous audit passed and what is defective

`loadCatalog()` derives AVAILABLE from authoring status and remaining quantity
after committed sales; active CART/ORDER holds are not subtracted from that status.
`loadSaleCatalog()` correctly withholds a new liquidation offer when free stock is
zero. The public renderer nevertheless used only AVAILABLE for its badge, available
count and enabled button. Live browser inspection confirmed that misleading result
on all four details. A fresh claim is rejected by the existing locked inventory
check, not sold at the public reference amount.

The previous zero-mismatch result compared **pricing against purchasable stock**.
It correctly counted fully held exclusions, but did not validate whether the public
availability label and enabled action told the same story. That was a coverage gap.
The complete current snapshot has **35 held listings marked AVAILABLE**, 254 eligible
unprotected products (81 at 10%, 173 at 50%), and three protected items. No purchasable
unprotected item is missing its discount. Item 084 is partially held: two remaining,
one held, one free, and correctly discounted to 15,000.

## Focused correction

Add read-only, session-aware public purchase quantity/hold metadata after existing
price projection. Admin status, original quantities and all prices remain unchanged.
Held catalog/detail views say **Reservado**, disable a new purchase and identify the
displayed amount as a reference price. They no longer show a pay-now invitation.
Counters separate available/reserved listings; available-product recommendations
exclude fully held stock. Partial quantities show only free units. Detail boot waits
for authoritative availability rather than flashing an embedded available label.
Own active CART holds remain excluded from the stock subtraction, so the holder's
frozen quote remains usable. No pricing, reservation, payment, order, schema or
campaign-control logic changes.

## Validation

**49 focused tests pass**, including replay of all four current CART/protected ORDER
hold conditions through real isolated claim handlers: each fresh claim rejects 409,
existing snapshots remain unchanged, partial stock remains purchasable, and releasing
an isolated hold restores the correct discounted offer. First-claim, both-tier,
protected-item, frozen-price and discovery/loading regressions pass.

All 292 AVAILABLE records were rechecked through corrected projection and card
rendering: **257 available / 35 reserved**, zero customer-visible eligibility
mismatches and every price unchanged. Isolated browser checks verify all four detail
labels, disabled controls and absence of a new payment quote.

[Corrected isolated detail](liquidation-review/13-reserved-detail.png).

Correction PR only. Owner approval is required before merging or deploying through
the existing verified release branch and exact-SHA, publish-and-lock procedure.
No new migration or production data correction is required.
