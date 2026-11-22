# Owner authorization of physical delivery

Status: isolated implementation for Governance review. No release authorization.

Review baseline: production commit `e91ef4c9d6eb75efecdd18e18646a0ce3485af3c`,
published deployment `6afdcd3d9d6eb2bdddddee88`. Its automatic publishing lock was
verified before implementation. Divergent `main` is not the release baseline.

## Behavior

The existing fully paid order recognition remains unchanged. A PREPARED batch
whose payment evidence is insufficient returns `DELIVERY_PAYMENT_EVIDENCE_REQUIRED`.
Admin then offers “Autorizar entrega como propietario”, explicitly explains that
no payment or balance is changed, and requires a reason of 1–500 trimmed characters.
Cancelling either confirmation or the reason prompt records no delivery.

The endpoint authenticates the existing OWNER credential or OWNER session before
passing a trusted actor separately from the request payload. REVIEWER credentials,
cookies and submitted roles cannot grant this authority. Internal transitions also
require the trusted OWNER actor before accepting the authorization.

Only the payment-evidence restriction can be bypassed. Current order state,
committed inventory ownership, membership, batch state, merged-batch protection,
row locks and expected revision checks remain mandatory. A blocked or unknown
order is never made deliverable by changing its financial status.

The existing DELIVER event stores actor OWNER, reason, affected items, revisions,
blocked payment-evidence items and the database timestamp. The batch update and
event are atomic. A stale retry cannot append a second delivery event.
Existing LEGACY_FROZEN historical confirmation retains its separate meaning.

Delivery takes the existing fulfillment advisory lock but does not run global
buyer/assignment maintenance. Other operations retain their existing behavior.
Delivery of a batch containing `VM-2026-96200FE0` is explicitly blocked while its
separately governed correction is in progress. Removing that guard needs a
separate review; this change does not modify the correction project.

No payment, allocation, exception, receipt, order balance/status, reservation,
inventory quantity, appointment or notification is created or updated by delivery.
No database migration is required.

## Verification and release prerequisites

116 focused checks passed with zero failures/skips. The run included
`fulfillment-batches.test.mjs`, `item-payment-pickup.test.mjs`,
`admin-sessions.test.mjs` and `owner-delivery.test.mjs`. Tests used synthetic
PGlite fixtures, intercepted desktop/mobile browser requests and independent
PostgreSQL workers on a disposable localhost `pickup_test_*` database. No live
customer record was read or changed by those tests.

Before release: Governance reviews the exact diff and test evidence, rechecks the
live commit and separate correction status, and explicitly authorizes a controlled
release against the current production branch. Retain the automatic publishing
lock and existing data protections. Do not merge divergent main or reconcile
branches as part of this fix. Production verification and owner acceptance remain
outstanding. Commit/PR skip markers suppress automatic builds during draft review.
