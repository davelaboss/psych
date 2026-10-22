# Issue #56: field visibility and Spanish interface audit

Baseline: `e70e8d22319dd89cfa7ba027557a6b1f74ffbdc6` (current main, including PR #54).
Verification date: October 22, 2026. Scope: the Netlify static application served by `_redirects`, root `index.html`, `js/*.js`, and its existing API handlers.

## Changes

- Added `css/form-controls.css`: white editable surfaces, distinct #75877c perimeters, existing forest palette, 44px minimum height, 16px minimum input text, and strong keyboard outlines. Covers text, search, telephone, email, password, numeric, date, URL, textarea and select controls. Errors have a thicker perimeter and a Spanish explanation; disabled controls have a muted surface and dashed boundary.
- Added `js/form-controls.js`: shared Spanish file-picker presentation with the real native input remaining clickable, keyboard focusable, required, and included in FormData. Shows `Seleccionar archivo`, `Ningún archivo seleccionado`, and literal selected filenames. Announces filename changes, preserves existing labels/descriptions, handles form reset, and enhances dynamically rendered forms. Multiple uploads use `Seleccionar archivos`.
- Localized native constraint-validation messages for website inputs, so an English browser still receives Spanish missing-value, email, range and generic validation messages.
- Added receipt preflight validation for the existing JPEG/PNG/WebP/PDF whitelist and 1–3,000,000-byte bounds. Server authorization, validation, storage and submission endpoint are unchanged. Error focus returns to the input; server rejection and network errors preserve the file for retry. Existing Spanish receipt-success display is retained.
- Changed checkout `Email` and Admin order-search `email` to `Correo electrónico`; translated header/FAQ `delivery` to `entregas`; corrected the Alias copy fallback accent. Customer fetch/parsing errors now use the existing Spanish fallback rather than browser-generated English exceptions. Unknown order statuses receive a Spanish fallback.
- Made the existing Admin add-photo input keyboard reachable while keeping its Spanish label and immediate-upload behavior. Replacement-photo buttons and existing Spanish upload labels retain their behavior.
- Loaded the shared assets from the common HTML shell. Did not change the marketing handoff function or PR #54 instructions.

## Reviewed views and field inventory

| Area | Fields and states reviewed | Verification |
| --- | --- | --- |
| Catalog and filters | Search, category, condition, price, sort, sold checkbox; category and availability buttons, empty/error states | Live public storefront inspection; local shipped route at 1280px and 390px; rendered search/dropdown checks |
| Product detail and cart | Product actions and quantity selects; unavailable/empty states and reservation notices | Source audit; shipped cart with local authoritative catalog/reservation fixtures; existing product/cart regressions |
| Checkout | Name, WhatsApp, optional email, required final-sale checkbox; loading/error/empty states and submit | Shipped route with local fixtures at both widths; Spanish required-validation and label checks; existing checkout tests |
| Order access | Remembered private-order link, private URL/access handling, missing/invalid link, cancelled/expired views | Source audit; private route with local authorized-order fixture; existing access/cancellation tests. No separate editable order-number lookup exists in the deployed static routes |
| Payments and deposit | Bank values and copy-only Alias, initial/additional payment summary, receipt picker, payment/receipt statuses | Payment fixtures before/after at both widths; actual shipped order route; Alias remains readonly |
| Receipt upload | Empty, all four allowed types, zero bytes, invalid type, >3 MB, exact 3 MB, long filename with markup-like characters, reset, server rejection, network failure, success | Browser assertions in English browser locale, with exclusively local/mocked transport. Payload endpoint, method, order ID, access token, file type and retry behavior checked |
| Pickup and cancellation | Per-fulfillment native select, appointment/eligibility messages; cancellation confirmation/keep buttons | Shipped order route at both widths; existing scheduling/cancellation/authorization tests |
| Admin access | Private password input and validation | Shipped login route at both widths; no production login or permission change |
| Admin inventory/review/pricing | Search and batch/publication filters; item fields for name, category, asking price, description, condition, observations, defects, included items, sale mode, deposit percentage, pickup dates, quantities and vehicle/loading checkboxes | Source audit; actual inventory/review/pricing renderers at both widths; representative editor screenshots from production field-rendering helpers |
| Admin internal editing | Market estimates/range, fast-sale recommendation, price floor, confidence, pending review, research and internal notes | Source audit and shared text/number/textarea coverage; no values saved |
| Admin orders and finance | Order search/filter, buyer grouping, receipt upload, payment classification/verified amount, partial/overpayment checkboxes, reconciliation basis/amount/notes, duplicate-payment void notes, refund amount/type/notes | Source audit; actual orders renderer and representative receipt picker; existing finance, grouping and reconciliation regressions |
| Admin pickup/planillas | Pickup slot and compatible-batch selectors; prepare/reopen/deliver/print confirmations | Source audit and existing fulfillment/pickup regressions |
| Admin marketing/Sale Pulse | Date and slot selectors, refresh/copy/generate/send controls and states | Actual marketing renderer at both widths; existing handoff/overview tests; no send or live write |
| Admin photos | Add-photo input, replacement-photo picker, previews and Spanish upload actions | Source audit; hidden-to-focusable add-photo fix; shared focus styles on existing upload labels |

Buttons, hidden inputs, radio/checkbox sizing, product photographs and decorative panels are excluded from editable-field surface rules. Readonly Alias retains its existing white copyable appearance and readonly attribute. Disabled controls remain disabled. Proper product/brand names, technical identifiers and user filenames remain unchanged. The alternate React implementation under `source/` and generated bundles were not rebuilt; the deployed static route map is the audited application.

## Automated results

- `npm test`: **573 passed, 0 failed, 0 skipped**.
- `npm run test:forms`: **106 browser assertions passed** in Chromium at 1280×1000 and 390×1000, with `en-US` browser locale and Spanish document language.
- Browser coverage includes actual static route bootstraps for `/`, `/carrito`, `/checkout`, `/pedido/...`, `/admin`; actual Admin inventory/review/pricing/marketing/orders renderers; keyboard entry to the native file chooser; focus/labels; all editable field types; readonly/disabled/hidden preservation; email validation; file-validation/retry/payload behavior; long filenames; and horizontal-overflow checks.
- `node --check` passed for all four changed JavaScript files. `git diff --check` passed.
- Reproduce: `npm ci`, `npx playwright install chromium`, `npm test`, `npm run test:forms`. Set `FORM_QA_OUTPUT` for screenshot location; `FORM_QA_BASE` can override the baseline SHA. Browser tests start their own loopback server and never create production data.
- During setup, one existing assertion expected the old English email label and was updated. An image-integrity test initially failed in the sparse checkout; after fetching the unchanged original assets, the complete suite passed. No application failure remains from those setup runs.

## Screenshots and scope of evidence

These screenshots use synthetic local customer/bank/product data with the same renderer functions and CSS as the application. Before views are generated from the baseline commit, after views from the PR code. They are not screenshots of real private customer orders. Desktop and mobile are viewport tests, not physical iOS/Android or screen-reader certification.

| View | Before | After |
| --- | --- | --- |
| Payment, desktop | [Before](issue56-screenshots/payment-1280-before.png) | [After](issue56-screenshots/payment-1280-after.png) |
| Payment, mobile | [Before](issue56-screenshots/payment-390-before.png) | [After](issue56-screenshots/payment-390-after.png) |
| Admin editor, desktop | [Before](issue56-screenshots/admin-1280-before.png) | [After](issue56-screenshots/admin-1280-after.png) |
| Admin editor, mobile | [Before](issue56-screenshots/admin-390-before.png) | [After](issue56-screenshots/admin-390-after.png) |

Additional local outputs include full-route screenshots, Admin tab screenshots, long-filename/error/focus examples, `browser-results.json`, and the full automated-suite log.

## Browser/hosting limitations and release gate

The website-owned picker and validation text are Spanish regardless of browser locale. The operating system file-selection window, browser date-picker/calendar formatting, autofill UI and assistive-technology chrome follow device/browser settings; the website cannot translate those native dialogs. Filenames intentionally remain verbatim.

**Known external English UI remains on current production:** Netlify injects a `Powered by Netlify` badge and English build-your-own-site invitation into an isolated frame. It is not in this repository. Netlify documents the supported global removal at **Project configuration → General → Powered by Netlify badge → off → Save**, effective on the next request without a redeploy: [official documentation](https://docs.netlify.com/manage/projects/powered-by-netlify-badge/). Governance should include that hosting-setting change in release approval before asserting that production has no English interface controls. It has not been changed here because this assignment requires a final Governance decision before production release changes.

**Readiness:** code and automated evidence are ready for Governance review. Do not merge or deploy without David's final authorization. Complete no-English production acceptance additionally requires disabling that hosting badge and checking the released site. No production checkout, upload, payment, cancellation or authenticated Admin mutation was exercised; existing backend regression tests cover their operational/security contracts.

No inventory data, Item IDs, prices, orders, receipts, reservations, permissions, authentication, checkout rules, Volume 5 data/workflows, seller-confirmed information, or marketing handoff instructions were changed. Existing full-suite tests that cover those areas were run unchanged except for the email-label assertion.

**Does David need to do anything?** Review the PR and before/after evidence through Governance. At release approval, include the Netlify badge toggle above. No immediate data entry or production test order/payment is needed.
