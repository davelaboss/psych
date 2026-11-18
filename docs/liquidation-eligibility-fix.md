# Liquidation first claim eligibility correction

Correction candidate only. Production remains at `a341202`; this PR is not merged
or deployed and changes no production data, settings or migrations.

## Cause and scope

`liquidationPrice()` required an operational inventory row. The established purchase
path creates that row lazily on the first claim, using the authoritative catalog
quantity. Consequently an ordinary available item could be purchased at full price
solely because nobody had initialized its operational row. The first claim then froze
that incorrect full price, which the commitment safeguards correctly retained.

The November 13 21:13 UTC read-only snapshot contained 488 public records, including
292 marked AVAILABLE: 274 purchasable unprotected items, 15 fully held items, and the
three protected items. **91 purchasable items were incorrectly excluded**: 40 in the
10% tier and 51 in the 50% tier. All 91 lacked operational rows. Operational rows
existed for correctly discounted examples 275/382. Counts reflect this snapshot;
customer cart activity continues normally.

| Item | Production snapshot | Correct new purchase |
|---|---:|---:|
| 658 | 30,000 | 15,000 |
| 662 | 30,000 | 15,000 |
| 038 | 25,000 | 12,500 |
| 464 | 26,000 public; fully held | Existing holder has agreed 13,000; fresh claims remain blocked while held |

Admin asking-price overrides are already applied before this projection. They did
not cause the missing-row defect. Existing cart prices intentionally take precedence;
a pre-fix accepted full-price cart must not be silently repriced. Public/new-session
offers can therefore differ from an existing agreement. A missing-row first buyer
could previously see and be charged full price; a later fresh buyer could receive a
discount after that row was initialized. The correction makes new first claims use
the advertised approved offer before freezing it.

## Exact change and safeguards

Only `liquidation.mjs` runtime logic changes: use the same authoritative remaining /
total / default-one quantity as first-claim initialization when the operational row
is absent. Existing rows always remain authoritative; zero, held, malformed, negative
or fractional availability fails closed. Status, valid PYG price, purchase mode,
protected IDs and positive integer quantity checks remain enforced. Reservations
require an operational parent row, so absent rows cannot conceal existing holds.
No stock initialization is performed by catalog reads. Transaction locks, capacity
checks, snapshot precedence, order/payment persistence and deposit rules are unchanged.

## Validation and visual checks

- 54 focused checks passed, including first-claim cart/order creation, both tiers,
  boundary rounding, held-stock rejection, Admin overrides, protected items, payment
  regressions, frozen accepted full-price/discounted carts and idempotent order retry.
- All 292 AVAILABLE records were replayed against the captured inventory state:
  **274 correct offers (85 at 10%, 189 at 50%), zero remaining mismatches**; 15 fully
  held and three protected exceptions retained. Other catalog statuses are unchanged.
- The isolated browser fixture preserves missing rows and active holds. Catalog,
  detail, cart, checkout and an actual local order for 038/526/658/662 agree on
  **53,300 total / 45,200 now / 8,100 later**. No production purchase was made.
  [Corrected isolated checkout](liquidation-review/12-checkout-first-claim-fix.png).
- The earlier browser fixture pre-created every row and masked this regression.
  The new regression deliberately starts without the relevant rows.
- Actual production scrolling reproduced the sticky strip at top=0, height=34px
  on desktop and 390px mobile. No sticky-positioning defect was reproduced; no CSS
  or banner behavior changes are included.

## Recommended urgent release after owner authorization

Recheck the locked production deployment and this release branch, approve the exact
correction SHA, merge only into `fix/catalog-price-order-20261109`, and build the exact
resulting SHA in production context. Retain the true campaign flag and publishing
lock. No new migration is required; retain the native migration gate and existing
schema. Publish-and-lock only the approved deployment, then rerun the full available
eligibility audit, first-claim checks, protected/deposit checks and commitment hashes.
Do not reconcile or deploy divergent main, reseed stock, rewrite accepted snapshots,
change Admin values, or restore an earlier database/code version. Any adjustment of
a pre-fix accepted full-price commitment needs a separate owner decision.
