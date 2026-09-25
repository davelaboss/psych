# Psych Website — Project Master

Last updated: 2026-09-24

This file is the authoritative human-readable project record for the Psych website.

The current Git repository and committed source files remain the technical source of truth for what is actually deployed.

Every future programming chat should:
1. Read this file first.
2. Inspect the current committed files relevant to its assigned task.
3. Work on only one assigned workstream.
4. Preserve all completed/verified behavior listed here.
5. Update this file when its task is successfully completed and committed.

---

# 1. PROJECT

Production:
https://thelabossieres.com

GitHub repository:
davelaboss/psych

Branch:
main

Local repository:
C:\Users\davel\Documents\GitHub\psych

Local development:
npx netlify dev

Local URL:
http://localhost:8888

Hosting/deployment:
Netlify automatically deploys from GitHub main.

Admin:
https://thelabossieres.com/admin

---

# 2. PROJECT WORKING RULES

## Delivery / workflow

- Do NOT create ZIP bundles.
- Do NOT request API tokens.
- Do NOT request ADMIN_TOKEN.
- Do NOT use internal site previews.
- Use Netlify + GitHub main as the deployment workflow.
- Work from the exact current committed source whenever possible.
- Inspect relevant files before changing them.
- Make the smallest coherent change necessary.
- Do not redesign unrelated parts of the website.
- Do not add speculative improvements outside the assigned task.
- One programming chat should own one coherent workstream.
- Do not have multiple chats modifying the same files simultaneously.

## User workflow

The site owner is not a programmer.

When command-line commands are needed:
- provide ONE command at a time;
- wait for its result before giving the next command when practical;
- do not group multiple commands into one code block unless specifically requested.

Do not use:

git add .

Stage exact files instead.

Never commit:
- .bak files;
- temporary installers;
- abandoned runtime patch files;
- secrets.

## File delivery

Direct .js downloads have previously failed in the browser.

When complete file replacement is required, the established working delivery method is:
- downloadable `.txt` PowerShell installer;
- installer writes complete replacement file(s);
- installer is only a delivery mechanism, NOT a runtime patch architecture.

Do not make the owner manually splice JavaScript functions, braces, handlers, etc.

---

# 3. SECURITY / PRIVATE INFORMATION

This repository is PUBLIC.

Never place any of the following in this file or committed source:
- ADMIN_TOKEN;
- passwords;
- private API keys;
- customer personal information;
- private order-access tokens;
- bank credentials;
- secrets of any kind.

Production ADMIN_TOKEN is configured through Netlify and must not be requested from the owner.

---

# 4. CURRENT ARCHITECTURE

The site originated from a Vinext/Cloudflare-oriented application.

A full source migration to Netlify was previously attempted and abandoned.

The current production architecture intentionally retains a static/public storefront with Netlify backend functionality.

Important current files/components include:

- index.html
- css/site.css
- js/site.js
- js/volume2-storefront.js
- _redirects
- netlify.toml
- Netlify Functions
- Netlify Blobs

Relevant backend/shared files have included:

- netlify/functions/_shared/commerce.mjs
- netlify/functions/_shared/volume2-public.mjs
- netlify/functions/admin-product.mjs
- netlify/functions/admin-product-photo.mjs
- netlify/functions/product-photo.mjs
- netlify/functions/admin-legacy-inventory.mjs
- netlify/functions/volume2-catalog.mjs

Relevant source/history files have included:

- source/lib/phase2-batch.ts
- source/lib/volume2-batch.ts
- source/lib/volume2-image-map.mjs

A future chat must inspect the CURRENT repository before assuming all listed files remain unchanged or equally relevant.

---

# 5. CATALOG ARCHITECTURE

The public catalog has been consolidated.

Original inventory and Volume 2 now use the unified public catalog path.

Netlify Blob admin overrides remain the highest-priority current override layer.

Do NOT recreate separate competing storefront/catalog controllers.

Do NOT layer additional runtime patch scripts over the current consolidated architecture.

The consolidated storefront controller includes:

js/volume2-storefront.js

js/site.js remains part of the existing storefront/product/cart behavior.

---

# 6. INVENTORY

Original inventory:
Items 001–057

Previous audit identified 52 sellable original records.

Volume 2:
Items 058–158

Volume 2 contains:
101 products

Current regression-tested storefront total:
153 articles

The item-number range and sellable-card count are not assumed to be identical.

Future inventory additions may continue beyond Item 158.

---

# 7. DATA AUTHORITY / PRECEDENCE

For original inventory reconciliation and future product editing, preserve this precedence:

1. Current Netlify Blob admin override, if one exists.
2. Explicit current seller-confirmed information.
3. Established current public information where it is known to supersede stale legacy information.
4. Older embedded/static/Phase 2/admin/source data is historical evidence and is not automatically authoritative.

A newer timestamp alone does not prove that a value is authoritative.

When sources conflict:
- do not guess;
- do not silently overwrite;
- report genuine ambiguity to the owner.

Internal research/pricing/reviewer information must remain private unless explicitly approved for public display.

---

# 8. GLOBAL PUBLIC PRODUCT-COPY RULES

Never publicly describe merchandise using:

- usado
- usada
- usados
- usadas

as product-condition language.

"Poco uso" or "nuevo" may be used only when specifically confirmed.

Reviewer/admin/TODO text must never leak into public product fields.

Examples of material that belongs in admin/internal context rather than public product copy include:
- verification instructions;
- reviewer notes;
- "confirmar..." TODOs;
- unverified defects;
- internal research notes.

"Medidas confirmadas:" was standardized to:

"Medidas:"

Public known-defect fields must contain actual confirmed defects, not tasks to investigate later.

---

# 9. COMPLETED AND VERIFIED — STOREFRONT / DATA

The following work is complete and must not be unnecessarily redone.

## Unified catalog

- Unified override-aware public catalog for original inventory + Volume 2.
- Netlify Blob admin overrides preserved as highest priority.

## Original-inventory public-data hygiene

A systematic hygiene audit of current embedded original-inventory public data was performed.

It previously found:
- 20 original items containing prohibited usado/usada/usados/usadas wording;
- 18 occurrences of "Medidas confirmadas:";
- verification/TODO material in knownDefects for:
  - Item 013
  - Item 014
  - Item 024
  - Item 026
  - Item 027
  - Item 028
  - Item 029
  - Item 031
  - Item 033
  - Item 035
  - Item 054
  - Item 057
- additional public-data issues in Items 021 and 029.

Public cleanup was performed:
- prohibited wording removed;
- reviewer/TODO/verification leakage removed;
- "Medidas confirmadas" normalized to "Medidas";
- relevant original public copy corrected.

This public-data hygiene audit is NOT the same thing as the still-pending full cross-source Items 001–057 reconciliation audit.

---

# 10. CONFIRMED PRODUCT CORRECTIONS

## Item 002

Previous public wording included prohibited condition wording such as:
"Usado y parcialmente funcional"

and referenced:
"bidones usados"

The public copy was corrected.

Do not restore the prohibited wording.

## Item 032

The actual product photo was edited to remove visible pruning shears.

The corrected image is the intended image.

Do not restore the old photo containing the shears.

## Item 033

Confirmed price:

Gs. 24.000

## Item 039

Known wording/data correction was completed during the original-inventory cleanup.

Refer to the current committed source for the final authoritative text.

## Item 047

Included:
- 3 shelves;
- 3 metal rear/support brackets PER shelf.

Not included:
- black horizontal bar;
- hooks/S-hooks.

Do not describe the black bar or hooks as included.

## Item 057

Color:
white / blanco

Quantity:
2 units

The two units are NOT interchangeable because their wear/use characteristics differ.

Public information should make clear:
- photographs show one of the two units;
- both have comparable signs of wear.

---

# 11. HOMEPAGE — COMPLETED

The old section:

"PAGO COMPLETO / disponibles para retirar ahora"

was removed.

The delayed/reservation section was retained:

"SEÑA CONFIGURABLE"

The delayed/reservation shelf now:
- uses the unified delayed-product catalog;
- has navigation arrows;
- shows X de Y;
- shows the total delayed-product count;
- provides clear navigation through additional products;
- includes Volver arriba links where required.

Existing homepage behavior was preserved:
- search;
- result count;
- filters;
- sorting;
- reset behavior.

---

# 12. PRODUCT DETAIL — COMPLETED

## Pickup information

The previous "Para el retiro" content was reorganized.

Detail pages now distinguish:

ESTE ARTÍCULO

from:

POLÍTICA GENERAL

Item-specific logistics remain separate from universal pickup policy.

Existing fields such as these are used appropriately where relevant:
- logisticsNotes
- requiresVehicle
- requiresLoadingHelp

The general pickup-location wording is aligned to:

"Retiro personal en San Lorenzo, Barrio Santo Tomás."

## Photo/lightbox viewer

Detail-page product-photo viewing is working.

Verified functionality includes:
- Ver foto(s);
- main-photo lightbox;
- multiple-photo thumbnail strip;
- active thumbnail;
- switching photos via thumbnails;
- previous/next arrows;
- keyboard navigation;
- larger close target;
- mouse-wheel zoom;
- drag/pan while zoomed.

Homepage photo/lightbox behavior also remains working.

---

# 13. FOOTER — COMPLETED

The previous wording:

"La dirección exacta nunca se publica."

was removed.

Current intended footer wording:

"Retiro personal en San Lorenzo, Barrio Santo Tomás · Sin delivery ni envíos."

---

# 14. ENCODING / MOJIBAKE — COMPLETED

Known customer-facing commerce mojibake/UTF-8 problems were corrected at SOURCE level.

No runtime text-repair hack was introduced.

The main current customer/admin sources were checked for the common mojibake markers previously encountered.

Do not reintroduce runtime text-replacement patches to hide source encoding errors.

If a future encoding issue appears:
fix the actual source.

---

# 15. FINAL STOREFRONT REGRESSION BASELINE

A final regression pass was reported successful after the above work.

Known-good behavior included:

- 153 articles;
- search;
- filters;
- sort ascending/descending;
- reset filters;
- reservation carousel;
- delayed-product count/navigation;
- Items 002/032/033/039/047/057 targeted checks;
- product-detail rendering;
- detail photo/lightbox behavior;
- homepage photo/lightbox behavior;
- Agregar;
- Reservar;
- cart count;
- footer;
- visible text encoding.

Future changes touching the storefront should preserve this baseline.

---

# 16. ABANDONED APPROACHES — DO NOT RESURRECT

The project previously suffered regressions from stacked runtime controllers/patches.

Do not resurrect:

- js/catalog-runtime-fix-v4.js
- js/catalog-runtime-fix-v5.js
- js/catalog-runtime-v6.js

These files/approaches are abandoned.

Previous .bak-* files are not production architecture.

Backup files may only be consulted as historical evidence when specifically necessary.

Never automatically deploy or commit backups.

Do not reintroduce competing catalog event-handler systems.

---

# 17. CURRENT ACTIVE WORKSTREAM

ACTIVE OWNER:
Chat #4

ACTIVE TASK:
Comprehensive Items 001–057 admin/public/source/history reconciliation audit.

Chat #4 owns ONLY this reconciliation workstream until it is completed or explicitly reassigned.

No other programming chat should simultaneously modify files related to that audit.

---

# 18. ITEMS 001–057 RECONCILIATION — STILL PENDING

This is the remaining unresolved task from the earlier original website scope.

The architecture supports overrides, and broad public-copy cleanup was performed.

However, a comprehensive item-by-item comparison of all applicable Items 001–057 has NOT yet been verified as complete.

The audit must compare available current and legacy information for every applicable original item across fields including, where present:

- item number / identity;
- slug;
- title;
- legacy/admin Nombre;
- price;
- description;
- observations;
- condition;
- known defects;
- accessories;
- inclusions;
- exclusions;
- quantity;
- measurements;
- color;
- logistics notes;
- requiresVehicle;
- requiresLoadingHelp;
- availability/reservation-related data;
- relevant image/primary-image metadata;
- other public-facing fields;
- current Blob override data;
- relevant recoverable editing/history data.

## Reconciliation classifications

Each meaningful comparison should be classified as:

A. MATCH
Sources materially agree.

B. CLEARLY RECONCILABLE
Sources differ but established precedence clearly determines the authoritative value.

C. AMBIGUOUS — OWNER DECISION REQUIRED
Sources conflict and evidence does not establish the correct value.

D. LEGACY / INTERNAL ONLY
Difference is intentional because the source/value is historical, research, reviewer, internal pricing, etc.

E. NOT APPLICABLE / INSUFFICIENT SOURCE DATA
A meaningful comparison cannot be made.

Do not silently convert category C into category B.

## Important known example: Item 031

Item 031 helped expose stale-data divergence.

Known historical discrepancy included:
- old admin/source price around Gs. 170.000;
- established public value around Gs. 25.000.

Title/Nombre divergence was also observed.

Item 031 must therefore be carefully reconciled from actual evidence rather than assuming the legacy admin/source value is correct.

## Required audit deliverable

The audit should ultimately produce an item-by-item reconciliation report identifying:

- item number;
- field(s) compared;
- current value/source;
- conflicting legacy/history value/source where applicable;
- A/B/C/D/E classification;
- factual resolution when established;
- whether owner input is required.

Do not modify ambiguous data until the owner decides.

---

# 19. RETAINED WORK AFTER RECONCILIATION

The following tasks are retained project work but are NOT part of Chat #4's current reconciliation assignment.

They should be handled as separate future workstreams/chats.

## A. Volume 2 public-copy hygiene audit

Items 058–158 should be verified for internal/reviewer material leaking into public copy.

Known examples previously identified included language similar to:

"No se identificaron otros objetos visibles que deban considerarse incluidos."

"Se conservan las fotografías originales sin retoque."

"Revisar señales de uso y detalles visibles antes de aprobar."

"Defectos conocidos: No verificado. Confirmar marca, modelo, capacidad, enfriamiento y medidas."

These examples indicate the need to distinguish:
- public customer information;
- internal reviewer/admin instructions.

Do not assume the original-inventory cleanup automatically covered Volume 2.

STATUS:
Needs verification/completion.

## B. Product-to-product navigation on detail pages

The project previously requested a way to navigate through other PRODUCTS from a product-detail page.

This is separate from navigating between multiple photos of the same item.

Possible implementation may use:
- previous product;
- next product;
- another user-friendly catalog navigation mechanism.

Do not confuse this with the already-completed lightbox photo navigation.

STATUS:
Apparently not yet completed; verify before implementing.

## C. Pickup scheduling after approved payment

A simple pickup-scheduling feature was previously requested.

This is a future commerce workstream.

See the commerce workflow section below.

STATUS:
Not yet confirmed implemented.

---

# 20. COMMERCE / ORDER WORKFLOW — RETAINED BUSINESS RULES

The intended customer/payment flow is:

1. Customer adds item(s).
2. Customer proceeds through cart/checkout.
3. Buyer details are collected.
4. Server creates the order/hold.
5. Customer receives bank-transfer instructions.
6. Customer uploads comprobante / payment receipt.
7. RECEIPT UPLOAD ALONE DOES NOT CONFIRM PAYMENT.
8. Seller/admin manually verifies that funds were received.
9. Seller/admin explicitly approves/confirms payment.
10. Order state changes appropriately.
11. Only after the required payment is approved may pickup scheduling become available.

For immediate/full-payment items:
approved payment can move the item toward sold/ready-for-pickup status.

For delayed/reservation items:
approved required deposit can establish the reservation according to the existing commerce rules.

Do not redesign this state machine casually.

---

# 21. CUSTOMER PORTAL RULES

The customer portal/order access uses:

- order number;
- private/random access token or private order link.

It is NOT intended to use phone-number-only authentication.

Future work must preserve private order access.

---

# 22. FUTURE PICKUP-SCHEDULING REQUIREMENT

Pickup scheduling must NOT be a general public calendar.

Intended sequence:

Order placed
→ payment instructions
→ receipt uploaded
→ seller verifies funds
→ seller manually approves payment
→ ONLY THEN pickup scheduling becomes available to that order/customer.

The customer should then be able to choose from available pickup date/time options through their private order/customer portal.

The selected pickup appointment should be associated with the order and visible to seller/admin.

Do not allow pickup scheduling merely because a receipt was uploaded.

Payment approval is the gate.

STATUS:
Retained future commerce feature; not currently assigned to Chat #4.

---

# 23. COMMERCE ENGINEERING CAUTIONS

These are retained technical cautions, not automatically assigned work.

## Blob concurrency / locking

Previous project analysis noted that Netlify Blob-based order/inventory locking is not necessarily fully transactional.

This may need review before significant real-money transaction volume.

Do not redesign it during unrelated tasks.

## Product-override listing pagination

`listProductOverrides()` may need pagination review if the number of overrides grows.

This is a future robustness concern unless current behavior demonstrates a real problem.

---

# 24. HISTORICAL/PHOTO MIGRATION NOTE

Older filename-based product photos/assets may still need migration or connection.

This has NOT been established as a definite unfinished requirement.

STATUS:
Unverified.

Do not create work solely from this note unless actual current data demonstrates a problem.

---

# 25. TASK OWNERSHIP / MULTI-CHAT COORDINATION

Because separate ChatGPT conversations do not reliably share complete project state, this file is the coordination record.

Rules:

1. Only one chat owns a given workstream at a time.

2. A chat must not modify files belonging to another active workstream without explicit owner approval.

3. Before starting:
   - read this file;
   - inspect `git status`;
   - inspect current HEAD/committed source;
   - determine whether another chat has uncommitted work.

4. If the working tree is dirty and the changes were created by another active chat:
   STOP.
   Do not overwrite, reset, pull, stash, commit, or delete them without owner instruction.

5. Do not run `git pull` blindly when another chat may have uncommitted local work.

6. After a task is tested and the owner says NOMINAL:
   - stage exact files;
   - commit the task;
   - push;
   - update this PROJECT_MASTER.md with the completed task and any newly established project facts;
   - record the new checkpoint.

7. If a task fails:
   do not update this file as though it succeeded.

8. Architecture support is not the same thing as completed data verification.

9. Never mark something complete without evidence that it was implemented/tested as required.

---

# 26. NEW-CHAT STARTING PROCEDURE

Every future programming chat should receive this instruction:

"Read PROJECT_MASTER.md first. Treat it as the project coordination record. Then inspect the current committed files relevant to your assigned task. Work only on the assigned task and preserve all completed/verified behavior."

Each future chat should have ONE specific assignment.

Examples:

Chat — Items 001–057 reconciliation

Chat — Volume 2 public-copy audit

Chat — product-to-product detail navigation

Chat — pickup scheduling/calendar

Do not combine unrelated workstreams simply because one chat is already open.

---

# 27. PROJECT CHECKPOINT

Current known project state:

- storefront cleanup work complete;
- unified catalog complete;
- original public-copy hygiene complete;
- known targeted item corrections complete;
- Item 032 photo correction complete;
- homepage reservation shelf work complete;
- detail pickup organization complete;
- footer/location wording complete;
- source mojibake cleanup complete;
- detail lightbox/photo behavior complete;
- final storefront regression passed.

Current active work:
Items 001–057 comprehensive reconciliation audit owned by Chat #4.

Future retained work:
- Volume 2 public-copy audit;
- product-to-product detail navigation;
- approved-payment pickup scheduling.

Exact current Git HEAD:
Must be verified from the repository before each new coding task.

---

# 28. CHANGE LOG

Future chats should append concise entries here after successfully committed work.

Format:

## YYYY-MM-DD — Task name
- Owner/chat:
- Files changed:
- Result:
- Regression performed:
- Commit:
- Remaining follow-up:

Do not place secrets or private customer information in this log.
