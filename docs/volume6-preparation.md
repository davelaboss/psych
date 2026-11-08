# Volume 6 preparation

Prepared November 7, 2026. **Not authorized for production.** Keep this PR draft and do not merge or deploy until David approves the exact release list.

The additive batch contains 30 owner-reviewed household listings, permanent Items 616–645, with 49 source-associated WebP photographs. Every listing is immediate pickup with full payment. Temporary photo-group numbers remain separate from permanent Item IDs. Item 615 remains reserved for the Chevrolet Tracker and is absent from this batch. Held and excluded groups are absent.

The existing public projection and product-detail fields now recognize Volume 6. Earlier catalog products and operational override/inventory precedence remain unchanged. The Volume 5 release helper accepts the additional catalog argument while preserving its existing activation behavior. No new Admin import mechanism, database migration, payment rule, marketing workflow or review interface was introduced.

Validation: 870 repository tests passed, zero failures; seven optional independent PostgreSQL concurrency tests skipped. Local browser validation covered all 30 pages, permanent-ID search, photo covers/lightbox, exclusions, 390px layout, four-unit pricing and checkout rendering. Browser requests stayed on localhost, cart storage used disposable PGlite, analytics were blocked, and no order was submitted. The private reconciliation package retains the full 55-group workbook, original-source hashes, READY/HOLD/EXCLUDE decisions and photo provenance outside this public repository.

Before authorized activation: compare the exact batch and photos with David's approved list, recheck current main and supported live Admin inventory for ID conflicts or prior publication, verify deployment controls, and preserve the prior commit/deploy. Do not perform a second data import or reset operational quantities. After authorized deployment, verify the 30 product pages/search/photos/prices/quantities and retained existing records without creating test orders.

Rollback: before any new orders, revert only this additive activation. After buyer activity, preserve identities and all orders, reservations, payments, overrides and inventory history; pause only affected new listings through supported Admin controls. Never restore an old operational database over later activity.
