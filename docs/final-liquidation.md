# PR #75 — Final refinement and release readiness

Draft only. No merge, production deployment, hosted migration, campaign activation,
Admin write, or marketing publication was performed.

## Refinements

- Replaced the large banner with the exact **LIQUIDACIÓN FINAL · Hasta 50% OFF**
  strip, 34px high. It stays at the top on home, product, cart, checkout and order
  pages. The original pickup notice and header scroll away. Desktop cart notices
  sit below the strip; their existing mobile scrolling behavior is preserved.
- Mobile catalog is one full-width card per row: proportion-preserving photo left,
  full title and prices right, full-width 44px purchase control, readable availability.
  Desktop keeps its proportions with original/badge left and red price/label right.
- Checkout now states unit prices and deposits. Order confirmation states the frozen
  agreed unit prices. Mixed orders say “Pago inicial requerido” and distinguish the
  later balance from the entire unpaid balance; financial calculations are unchanged.
- Final checkout refinement puts total / due now / later balance first, makes due
  now largest, compacts the item rows, and shares identical payment/pickup dates.
  Per-item quantities, agreed unit prices, deposits, balances and date exceptions
  remain visible. No new steps or expandable controls. Mobile summary is 1,039px
  versus 1,301px before (390px viewport), about 20% shorter.
- New purchases of Items **405/441** use **25%**, with campaign ON or OFF. When their
  recorded pickup dates are absent, the approved December 9–12 window is used;
  narrower recorded dates are retained. New cart snapshots also freeze these dates.
  Existing accepted carts/orders/payments remain unchanged. Underlying Admin values
  still need a separately authorized 25%/pickup-field correction; no live edit occurred.

## Pricing and safeguards

Current Admin overrides remain authoritative. AVAILABLE, purchasable PYG stock gets
10% at/below 12,000 and 50% above it. Boundary checks: **12,000 → 10,800**;
**12,001 → 6,001**. Whole-guarani half-up unit/deposit rounding is retained.
Fully held, sold, unavailable or missing operational stock gets no new offer.
Items **274/313/615** remain excluded: current prices **2,950,000 / 1,800,000 /
US$18,000**, respectively. Tracker stays inquiry-only. “Hasta 50% OFF” is truthful;
the smaller tier and exclusions never acquire a 50% badge. Two-hour deployed holds
remain unchanged; the earlier 15-minute reference is superseded by this assignment.

## Validation and visual evidence

- Final checkout pass: **24 focused checks passed** plus real isolated browser
  checkout/order creation. 320px/390px have no horizontal overflow or clipped text;
  due now is visually largest. Same frozen order: **254,800 / 213,700 / 41,100**.
  Approved custom deposit and pickup-date exceptions are covered by rendering tests.
  The totals reducer, checkout form/submission, reservations, persistence and all
  server/payment code are unchanged from reviewed commit `3967013`.
- **147 focused checks passed**, no failures/skips. Final commitment/date follow-up:
  **19 checks passed**. No unnecessary full-suite rerun; original full-suite result
  remains 889 passed with seven optional PostgreSQL skips.
- Isolated browser: **96 ordinary catalog cards** across 320px/390px; full titles,
  one-column layout, contained photos, 44px controls, no overflow or price clipping.
  **Eight actual-scroll sticky checks**, desktop pricing geometry, search/sort,
  direct details, ON/OFF state, protected Items, checkout and real local order creation.
- Mixed order Items 018/526/405/441: **254,800 total / 213,700 now / 41,100 later**.
  The immediate Item is paid in full; all delayed lines use 25%. Order amounts and
  accepted cart prices survive deactivation. No JavaScript errors.
- The database is disposable local PGlite. The committed cart/create-order handlers
  run with isolated catalog/recovery adapters; order reads use that database's frozen
  snapshot and normal public projection. No production orders, payments or holds.
  Local order screenshots intentionally show bank details unavailable.

| Capture | Evidence |
|---|---|
| [Home 320px](liquidation-review/01-home-320-initial.png) | Pickup notice above compact strip |
| [Scrolled 320px catalog](liquidation-review/02-catalog-320-scrolled.png) | Sticky strip; pickup/header gone; ordinary products |
| [Scrolled 390px catalog](liquidation-review/03-catalog-390-scrolled.png) | Full-width rows and readable controls |
| [Desktop](liquidation-review/04-desktop-catalog.png) | Protected/discounted products and left/right pricing |
| [Detail: Item 405](liquidation-review/05-mobile-detail-405.png) | Red price and 25% deposit |
| [Single 50% cart](liquidation-review/06-cart-single-50.png) | Actual immediate-purchase cart |
| [Mixed cart](liquidation-review/07-cart-mixed.png) | Both tiers and delayed purchases |
| [Checkout before](liquidation-review/08-checkout-amounts.png) | Previously reviewed layout |
| [Checkout after 390px](liquidation-review/10-checkout-final-390.png) | Totals first, prominent due now, compact items, shared dates |
| [Checkout after 320px](liquidation-review/11-checkout-final-320.png) | Narrow mobile readability |
| [Order confirmation](liquidation-review/09-order-confirmation.png) | Final frozen prices and transaction amounts |

## Admin deposit follow-up

The unchanged real Admin renderer and event binder were exercised in an isolated
browser without submitting: IMMEDIATE 100 → DELAYED stays 100; DELAYED 25 → IMMEDIATE
stays 25; a custom 40 stays 40. The 25/100 default is applied only on initial render
when the stored percentage is null/missing. Availability and percentage are saved as
independent fields. This behavior could explain 405/441, but their edit history was
not verified. No Admin form or live record was changed.

Existing preservation is the visible, editable per-item stored percentage/override;
there is no dedicated approved-deposit-exception marker in this editor/save path.
Smallest safe separately authorized follow-up: show a 25/100 suggestion when mode
changes, with explicit “use suggested percentage” acceptance into the existing field
before Save. Keep every existing/custom percentage until accepted. This preserves
approved exceptions without a schema change or silent overwrite. Controlled 405/441
record correction remains separate authorization and is not a PR #75 blocker.

## Campaign controls

In Netlify's project **Environment variables**, set production
`FINAL_LIQUIDATION_ENABLED` to the literal **true** for ON, **false** for OFF; ensure
its scope includes **Functions**. Missing/unset also means OFF. Save, then build and
publish the approved production source. This is not an instant live switch: **both
ON and OFF require a new deploy**, with ordinary deployment usage/credits. Netlify
currently documents 15 credits per successful production deploy on credit-based plans.
[Function environment rules](https://docs.netlify.com/build/functions/environment-variables/),
[deployment credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/).

David can change the value in the dashboard without Desktop Work. A safe end-to-end
change also needs the approved source branch selected, as explained below; blindly
rebuilding current main is unsafe. After release, independently open
[public campaign state](https://thelabossieres.com/.netlify/functions/campaign-state)
for `liquidationActive: true/false`, and check a fresh private-window catalog for the
strip and offers. The endpoint is read-only/no-store and is not deployed yet.
**Admin has no campaign-state indicator or toggle**; none was added.

OFF stops new offers and hides the strip. It preserves frozen accepted cart prices,
existing orders/payments and their dates. Keep the nullable column and this code;
**no migration rollback is needed or appropriate**. Never restore an old database
or deploy pre-snapshot code as the deactivation mechanism.

## Verified baseline and exact release path

Read-only Netlify API confirms current published production deploy
**6af25e1cdb32b9059c6e3559**, source **2fea836e73ffbead5bc0a98683b09fed304d0fd8**,
production-context branch label `main`, **locked: true**. Storefront JS/CSS match that
commit; HTML differences are Netlify's pretty-link rewrite and RUM injection only.
Live catalog contains 488 records including Tracker and later inventory.

PR #75 correctly targets **fix/catalog-price-order-20261109** at that exact commit.
Current repository main **115baa4** diverges at **8ee1a4d** and contains a different
marketing change; neither branch is a fast-forward of the other. Do not retarget
or merge this release into main casually.

After David authorizes the release:
1. Retain/positively recheck the publication lock and unchanged published deploy.
2. Merge PR #75 only into its verified production release branch. Build that exact
   resulting SHA in production context using the established controlled-release path.
3. For dashboard-only future ON/OFF operations, the recommended additional owner
   decision is to set Netlify's production branch to this reviewed release branch.
   Alternatively, keep the established exact-SHA release process; main reconciliation
   is separate scope. No branch/hosting setting was changed in this assignment.
4. If launch is authorized, set the flag true for that one approved build. Preserve
   `20261113_cart_pricing.sql` unchanged. Netlify's native gate applies this additive
   nullable-column migration immediately before publication and blocks publication on
   failure. Verify the migrated schema and publish only the approved commit/deploy.
   No manual SQL, restore or extra deployment is required.
[Production branch controls](https://docs.netlify.com/deploy/deploy-overview/),
[native migration sequencing](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/).

**Next decision:** Implementation is ready for David's final visual/release review.
No remaining code blocker was found in this focused checkout pass.
Approve the exact release commit and controlled production deployment/activation;
explicitly choose the source-branch arrangement for future owner-operated toggles.
The live Admin correction for 405/441 remains separate authorization. Campaign remains
OFF in production and the PR remains draft until approval.
