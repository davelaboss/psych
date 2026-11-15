# Pickup scheduling independent of payment

> Superseded for development by David's November 14, 2026 authorization. See [Item payment scheduling](item-payment-pickup.md) for the proposed replacement. The text below records the earlier policy; it is not the policy implemented by the new development branch. Production activation still requires Governance approval.

Owner authorization: November 2, 2026. Governance review only; no merge or deployment authorized by this change.

Every valid active order may schedule and reschedule immediately, including orders with no payment, pending receipts, partial payments, a confirmed seña, or full payment. Customer private-order pages and Admin use `schedulingEligible`. Existing orders receive the same policy dynamically; no backfill or order-state migration is needed.

`eligible` retains its existing payment-readiness meaning for compatibility, also exposed as `handoverEligible`. An appointment does not change payments, balances, order status, inventory commitments, or delivery records. David and María must verify payment obligations before physical handover. Scheduling is not permission for early collection or release of merchandise.

Immediate dates and hourly availability are unchanged. Delayed dates remain December 9–12, 2026, intersected with any narrower Item-specific window. Website payment arrangements remain 25% seña and the delayed balance due December 1–8. Marketplace arrangements in PR #68 are separate.

Cancelled, completed, expired, and unknown order states cannot schedule. Saving checks the authoritative locked order and rechecks available slots after the date lock. Booking neither renews a reservation nor commits inventory. Cancelled/expired orders do not consume appointment capacity or appear in the upcoming agenda. The existing independent reservation-renewal path clears an expired appointment before renewing the inventory hold, so it cannot resurrect a booking and overfill a slot. Order cancellation clears its appointments in the same transaction.

Capacity remains four overlapping appointments, including legacy half-day overlap. Timing-part separation, rescheduling, cancellation, transactional seller-only notification pairs, and idempotency are preserved. Sale Pulse counts unscheduled active timing parts regardless of payment or inventory commitment and continues excluding delivered parts.

The previously requested Admin copy action retrieves the existing private link only after Admin authentication, verifies its token against the stored hash, and returns it without caching. It does not rotate access, change an order, or send a WhatsApp reminder. Links are fetched on demand and are not added to order lists or marketing exports.

Verification includes real SQL in isolated in-memory PostgreSQL, customer/Admin renderer and clipboard execution, and the repository test suite. Payment scenarios exercise both actors and both pickup types at zero, partial, 25%, and full payment; 25% on an immediate Item remains an approved partial payment, not satisfaction of its full due-now amount. Tests compare complete payment/order/inventory records before and after scheduling and verify unchanged handover payment readiness. Coverage also checks narrower windows, expiry, same-slot retries, expiry during lock waits, renewal, cancellation, Sale Pulse, legacy overlap, failed rescheduling, outbox rollback, and seller-only delivery. The five independent-worker concurrency tests require an optional local PostgreSQL database and remain explicitly skipped when none is configured.

Release coordination: this work lives on its own branch and checkout, with a separate review PR. After PR #68 merges, update against latest main, resolve conflicts without altering its Marketplace behavior, and rerun relevant tests before Governance approval. No merge or deployment is automatic.
