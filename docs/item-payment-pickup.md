# Item payment requirements for pickup scheduling

Owner authorization: November 14, 2026. This development change supersedes the November 2 payment-independent scheduling policy. Governance review is required before any production migration, merge, or deployment.

## Eligibility and authoritative terms

Immediate Items require their full agreed payment confirmed in Admin. Delayed Items require their agreed deposit confirmed in Admin to schedule; the full agreed balance is required before collection. Receipt upload, partial-payment approval, reservation protection, and an order status alone never establish Item payment eligibility.

Use the frozen Item's `dueNowPYG` and `futureBalancePYG`. They are accepted line amounts and already include quantity and historical rounding. Do not read catalog prices or recompute deposits. Missing or invalid terms require owner review unless Admin records an explicit Item requirement decision with the agreed scheduling and collection amounts and evidence note.

## Explicit Admin decisions

`item_payment_decisions` is an append-only sidecar ledger. The existing Admin authentication remains the authority; David confirmed he is the sole Admin. No new owner login is introduced.

- `ALLOCATE`: select an existing confirmed, nonvoided `ADMIN_VERIFIED` or `LEGACY_RECONCILED` payment and an Item, with a positive whole-guaraní amount and audit note. An explicitly Admin-approved `LEGACY_OPENING_CREDIT` can be assigned manually; it is never treated as automatically received cash.
- `REVERSE`: append a reference to an allocation being reversed. A reversal releases the allocation without modifying its payment.
- `REQUIREMENT`: explicitly record the Item's agreed amount required to schedule and total required for collection. Zero is permitted for an explicitly approved gift. This does not change frozen prices, original payment terms, or financial balances. It represents an Item-specific payment exception.
- `REVOKE`: append a reference to the requirement decision being revoked. Revoke before replacing an active requirement. Notes are audit evidence and never parsed into policy.

The Admin order's Retiros section contains the controls and decision history. The authenticated endpoint is `/api/admin/item-payment`; its direct Netlify function has the same authorization. A caller-supplied UUID supports retries. Payment confirmation, refunds, voids, ledger entries, and appointment changes share the checkout order row lock, so competing allocations cannot spend the same confirmed payment twice. Update, delete and truncate operations on the ledger are rejected by database triggers.

Only an adequately funded single-Item order is recognized automatically, from current explicit Admin verification. This does not write an automatic allocation. Once active explicit allocations exist, only their amounts count; funds cannot count both implicitly and explicitly. Historical mixed-order funds never receive inferred allocations, even when the order is fully paid or Items share a timing group.

Known single-Item post-sale adjustments retain the existing paired reduction in obligation and retained funds. Mixed-order adjustments have no reliable Item attribution and remain review-required; unsupported adjustment kinds also fail closed. Do not infer which Item received a refund. A voided payment invalidates its own allocations, while independently funded sibling Items remain eligible. Ambiguous source-less or assumed historical funds do not unlock scheduling.

## Appointments and compatibility

Keep the existing `(order_id, timing_key)` appointment identity and all timing groups. `item_ids` records explicit selected Item membership for new bookings or requested changes. A paid Item can be selected without unpaid siblings sharing its timing. There is still one slot per timing group; adding another Item to that group is an explicit update to its appointment. The UI sends the current appointment revision and rejects conflicting stale edits.

The prepared migration `20261114_item_payment_pickup.sql` creates an empty ledger and adds a nullable membership column. It performs no data backfill, allocation, snapshot update, appointment rewrite, revision change, or price change. NULL membership preserves the legacy meaning: all Items in the stored timing group. Calendar and seller agendas respect explicit membership and continue displaying legacy appointments without trying to requalify them financially.

Both booking endpoints recheck the current SQL order and ledger inside the transaction, including direct function requests and same-slot retries. The read endpoint also uses current SQL rather than a supplied or Blob snapshot, so payments confirmed after an audit snapshot are recognized. Customer responses contain eligibility facts, not private ledger notes. Existing appointments stay visible even when their payment evidence needs review; no view or ledger entry cancels them.

Current `PREPARED -> DELIVERED` collection records also check every member Item's full agreed requirement under the order locks, including an explicit Item exception where applicable. The separate, explicitly confirmed `LEGACY_FROZEN` action documents an already-completed historical delivery and retains its existing retrospective meaning. It is not permission for a new collection.

Capacity remains four overlapping appointments, including legacy half-day overlap. Paraguay dates, hourly windows, delayed date intersections, blackout locks, order cancellation safeguards and notification transactions are retained. Booking does not renew reservations or commit inventory. The existing reservation-renewal mechanism still clears a legacy expired-hold appointment before reclaiming the hold, preventing resurrection and overcapacity. Development regression fixtures exercise this existing behavior without modifying production appointments.

Sale Pulse counts payment-eligible unscheduled timing groups using the ledger. Active existing scheduled groups remain counted even if attribution needs review. Public order summaries direct customers to the authoritative scheduler for Item eligibility; summary snapshots are not permission to book.

## Validation and release boundary

Isolated PostgreSQL-compatible SQL tests cover thresholds, receipt-only rejection, historical rounding, single-Item recognition, mixed same-time Items, allocations and reversals, explicit exceptions and revocations, credits, gifts, refunds, voids, direct API authorization, late confirmation, stale requests and migration preservation. Existing operational tests cover notification rollback, capacity, blackouts, expiry during date-lock waits and reservation renewal. Browser tests use intercepted synthetic APIs with an isolated database at desktop and mobile sizes; no live service is contacted.

Independent-worker tests accept only a localhost database named `pickup_test_*` via `PICKUP_TEST_DATABASE_URL`. They remain explicitly skipped when no expendable local PostgreSQL server is provided. The migration must be separately approved and applied before the new code is deployed; old code can run with the additive schema. A rollback must retain ledger and membership data and account for the old code's broader scheduling policy. Do not drop audit data to roll back.

The PR targets `fix/catalog-price-order-20261109`, based on production commit `0a580c6d19cda72fa0efaf27e013a296611ab51c`. Divergent `main`, liquidation pricing, production allocations and appointments are outside this change. No automatic migration runner or publishing change is introduced.
