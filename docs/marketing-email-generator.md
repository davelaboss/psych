# Marketing Email Generator

## Authoritative product source

Marketing selection uses `loadCatalog(origin)` from `netlify/functions/_shared/commerce.mjs`, the same resolved runtime projection returned by `volume2-catalog.mjs` to the public storefront.

That projection is authoritative because it combines:

1. the deployed base product record;
2. strong-consistency Netlify Blob product overrides (`mudanza-product-overrides`);
3. current PostgreSQL rows from `operational_inventory`, read by `readCommittedInventory()`;
4. a computed `quantityRemaining`, with an `AVAILABLE` product forced to `SOLD` when remaining quantity reaches zero.

For marketing, `readPurchasableInventory()` then applies the same PostgreSQL availability rule used by cart reservation: capacity minus committed quantity minus every unexpired `CART` or `ORDER` reservation. A product without a current `operational_inventory` row is treated as unverified and cannot be selected.

The generator never reads `index.html` or an old JSON snapshot directly. The homepage markup remains one input to the existing runtime resolver, but it cannot override current Blob fields or PostgreSQL committed inventory.

After loading that runtime projection, `isMarketingEligible()` applies a second strict gate. A product must be exactly `AVAILABLE`, have at least one unit remaining, be public/visible, not need review, not be a demo, have a positive price, a slug, and a public image.

## Selection and rotation

The default is three products. The selector prefers category and price-band variety, gives a deterministic visual-strength preference based on current product metadata/photos, and prevents three bulky products from appearing together. It avoids products featured in the previous 14 days and products already used in the other same-day slot when at least two fresh alternatives exist. If only two suitable fresh products exist, it returns two.

Only successful sends enter rotation history. PostgreSQL stores that history in `marketing_email_features`, linked to the immutable packet snapshot in `marketing_email_packets`.

## Admin workflow

The existing authenticated `/admin` page includes a **Marketing** tab:

1. choose one of the ten weekday AM/PM slots and a date;
2. generate a preview (no email is sent);
3. review the copy, photos, and direct product links;
4. optionally regenerate the selection;
5. press **Enviar a Maria** once.

Immediately before delivery, every selected ID is reloaded through `loadCatalog()` and rechecked for current eligibility. If any selected item is no longer purchasable/public, sending stops and the seller is asked to regenerate.

## Email and attachments

The email has three numbered sections: copy-ready social text, photos, and direct product links. Its layout is capped at 620 px and uses a single-column mobile-safe structure.

At send time, the cover image for each selected product is requested through Netlify Image CDN with `fm=jpg`, resized to a maximum width of 1600 px, checked for a JPEG response, base64 encoded, and attached through the existing Resend API integration as `Item-022.jpg`, `Item-049.jpg`, and so on. No ZIP file is used.

## Duplicate protection

Each saved preview has a stable Resend idempotency key. PostgreSQL also claims one packet per date/slot in `marketing_email_send_slots`. Repeated clicks, concurrent requests, and safe retries therefore do not intentionally create duplicate deliveries.

## Environment configuration

- `RESEND_API_KEY` — existing Resend credential.
- `MARKETING_EMAIL_TO` — exactly one recipient address.
- `MARKETING_EMAIL_FROM` — optional dedicated sender; falls back to `SELLER_NOTIFICATION_FROM`.
- `MARKETING_SITE_URL` — optional canonical link origin; falls back to the Netlify site URL.

No credentials or recipient addresses are stored in source.

## Scheduling status

Automatic scheduling is intentionally not configured. Once the owner confirms the exact AM and PM times, add a dedicated Netlify Scheduled Function that calls the same generation/send service and configure its two weekday UTC schedules. Netlify schedules run in UTC, so the confirmed America/Asuncion times must be converted deliberately. The admin preview/send workflow remains available for manual operation and testing.
