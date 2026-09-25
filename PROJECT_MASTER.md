# Psych Website — Project Master

Last updated: 2026-09-24

This file is the authoritative human-readable project record for the Psych website.

The current Git repository and committed source files remain the technical source of truth for what is actually deployed.

Every future programming chat should:

1. Read `NEW_CHAT_PROMPT.md` first.
2. Read this file completely.
3. Inspect the current Git state and committed files relevant to its task.
4. Work on only one assigned workstream.
5. Preserve all completed/verified behavior recorded here.
6. Update this file when its assigned workstream is successfully completed and committed.

---

# 1. CANONICAL PROJECT COORDINATION FILES

This repository uses two canonical coordination files:

- `NEW_CHAT_PROMPT.md` — permanent operating instructions for future programming chats.
- `PROJECT_MASTER.md` — current project status, architecture, business rules, completed work, pending work, known facts, and active workstream ownership.

GitHub is the authoritative location for both files.

Do not maintain a second authoritative copy of either file in:

- ChatGPT Library;
- Notes;
- old chats;
- local scratch documents.

If a permanent rule about how future programming chats should operate changes:

update `NEW_CHAT_PROMPT.md`.

If project status, architecture, requirements, completed work, pending work, product facts, business rules, or workstream ownership changes:

update `PROJECT_MASTER.md`.

Old chats are historical evidence, not the canonical project record.

---

# 2. PROJECT

Production:

https://thelabossieres.com

GitHub repository:

davelaboss/psych

Branch:

main

Local repository:

C:\Users\davel\Documents\GitHub\psych

Local development command:

npx netlify dev

Local development URL:

http://localhost:8888

Hosting/deployment:

Netlify automatically deploys from GitHub `main`.

Admin:

https://thelabossieres.com/admin

---

# 3. PROJECT WORKING RULES

## Delivery and workflow

- Do NOT create ZIP bundles.
- Do NOT request API tokens.
- Do NOT request `ADMIN_TOKEN`.
- Do NOT use internal site previews.
- Use Netlify + GitHub `main` as the deployment workflow.
- Work from the exact current committed source whenever possible.
- Inspect relevant current files before changing them.
- Make the smallest coherent change necessary.
- Do not redesign unrelated parts of the website.
- Do not introduce speculative improvements outside the assigned task.
- One programming chat should own one coherent workstream.
- Do not have multiple chats simultaneously modifying the same files/workstream.

## User workflow

The site owner is not a programmer.

When command-line commands are required:

- provide ONE command at a time;
- allow the command to complete before giving the next important command;
- do not combine several Git commands into one code block unless specifically requested.

Do not use:

`git add .`

Stage exact intended files instead.

Never commit:

- `.bak` files;
- temporary installers;
- debugging debris;
- abandoned runtime patch files;
- secrets.

## File delivery

Direct `.js` downloads have previously failed in the browser.

When complete file replacement is required, the established working delivery method is:

- downloadable `.txt` PowerShell installer;
- installer writes the required complete replacement file(s).

The PowerShell installer is only a delivery mechanism.

It must NOT become a runtime patch architecture.

Do not require the owner to manually splice JavaScript functions, event handlers, braces, or large code fragments.

---

# 4. SECURITY / PRIVATE INFORMATION

This repository is PUBLIC.

Never place any of the following in this file or committed source:

- `ADMIN_TOKEN`;
- passwords;
- private API keys;
- customer personal information;
- private customer/order tokens;
- bank credentials;
- secrets of any kind.

Production `ADMIN_TOKEN` is configured through Netlify.

Do not ask the owner to reveal it.

---

# 5. MULTI-CHAT COORDINATION

Because separate ChatGPT conversations do not reliably share full project state, this file coordinates the project.

Rules:

1. Only one chat owns a particular workstream at a time.

2. A chat must not modify files belonging to another active workstream without explicit owner approval.

3. Before editing, a chat should:
   - read `NEW_CHAT_PROMPT.md`;
   - read this file;
   - inspect `git status`;
   - inspect the current committed source relevant to the task.

4. If the working tree is dirty because another active chat has changes:

   STOP.

5. Do not overwrite, reset, restore, stash, delete, pull/rebase over, or commit another chat's work without explicit coordination.

6. Do not run `git pull` blindly when the working tree contains uncommitted work.

7. After a task is tested and the owner says NOMINAL:
   - stage exact intended files;
   - commit;
   - push;
   - update this file;
   - record the new checkpoint.

8. If work fails or remains untested:
   do not mark it completed here.

9. Architecture capability is not the same as completed data verification.

10. `NEW_CHAT_PROMPT.md` is the canonical operating-instruction file for future programming chats.

11. Permanent workflow-rule changes belong in `NEW_CHAT_PROMPT.md`.

12. Ordinary project-state changes belong in this file.

13. Do not maintain duplicate authoritative copies of these files elsewhere.

14. New programming chats should normally need only the short bootstrap instructions from `NEW_CHAT_PROMPT.md`, not giant historical handoff prompts.

---

# 6. CURRENT ARCHITECTURE

The site originated from a Vinext/Cloudflare-oriented application.

A full source migration to Netlify was previously attempted and abandoned.

The current production architecture intentionally retains a static/public storefront with Netlify backend functionality.

Important current files/components include:

- `index.html`
- `css/site.css`
- `js/site.js`
- `js/volume2-storefront.js`
- `_redirects`
- `netlify.toml`
- Netlify Functions
- Netlify Blobs

Relevant backend/shared files have included:

- `netlify/functions/_shared/commerce.mjs`
- `netlify/functions/_shared/volume2-public.mjs`
- `netlify/functions/admin-product.mjs`
- `netlify/functions/admin-product-photo.mjs`
- `netlify/functions/product-photo.mjs`
- `netlify/functions/admin-legacy-inventory.mjs`
- `netlify/functions/volume2-catalog.mjs`

Relevant source/history files have included:

- `source/lib/phase2-batch.ts`
- `source/lib/volume2-batch.ts`
- `source/lib/volume2-image-map.mjs`

Future chats must inspect the CURRENT repository before assuming every listed file remains unchanged or equally relevant.

---

# 7. CATALOG ARCHITECTURE

The public catalog has been consolidated.

Original inventory and Volume 2 use a unified public catalog path.

Netlify Blob admin overrides remain the highest-priority current override layer.

Do NOT recreate separate competing storefront/catalog controllers.

Do NOT layer additional runtime patch scripts over the consolidated architecture.

The consolidated storefront controller includes:

`js/volume2-storefront.js`

`js/site.js` remains part of the existing storefront/product/cart behavior.

---

# 8. INVENTORY

Original inventory:

Items 001–057

A previous audit identified 52 sellable original records.

Volume 2:

Items 058–158

Volume 2 contains:

101 products

Current regression-tested storefront total:

153 articles

The item-number range and number of currently sellable cards are not assumed to be identical.

Future inventory may continue beyond Item 158.

---

# 9. DATA AUTHORITY / PRECEDENCE

For original inventory reconciliation and future product editing, preserve this precedence:

1. Current Netlify Blob admin override, where one exists.
2. Explicit current seller-confirmed information.
3. Established current public information when known to supersede stale legacy information.
4. Older embedded/static/Phase 2/admin/source information is historical evidence and is not automatically authoritative.

A newer timestamp alone does not prove semantic authority.

When sources conflict:

- do not guess;
- do not silently overwrite;
- report genuine ambiguity to the owner.

Internal research, pricing analysis, reviewer notes, and verification material must remain private unless explicitly approved for public display.

---

# 10. GLOBAL PUBLIC PRODUCT-COPY RULES

Never publicly describe merchandise using:

- usado
- usada
- usados
- usadas

as product-condition language.

"Poco uso" or "nuevo" may be used only when specifically confirmed.

Reviewer/admin/TODO text must never leak into public product fields.

Examples of material that belongs in admin/internal context rather than public copy include:

- verification instructions;
- reviewer notes;
- "confirmar..." TODOs;
- unverified defects;
- internal research notes.

`Medidas confirmadas:` was standardized to:

`Medidas:`

Public known-defect fields must contain actual confirmed defects, not tasks to investigate later.

---

# 11. COMPLETED AND VERIFIED — UNIFIED CATALOG

The following work is complete and must not be unnecessarily redone.

- Unified override-aware public catalog for original inventory + Volume 2.
- Netlify Blob admin overrides preserved as highest priority.
- Original inventory and Volume 2 follow the unified catalog architecture.
- No return to competing runtime catalog controllers.

---

# 12. COMPLETED AND VERIFIED — ORIGINAL PUBLIC-DATA HYGIENE

A systematic hygiene audit of current embedded original-inventory public data was performed.

It previously found:

- 20 original items containing prohibited `usado/usada/usados/usadas` wording;
- 18 occurrences of `Medidas confirmadas:`;
- verification/TODO material in `knownDefects` for:
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

Public cleanup was completed:

- prohibited wording removed;
- reviewer/TODO/verification leakage removed;
- `Medidas confirmadas` normalized to `Medidas`;
- relevant original public copy corrected.

This public-data hygiene work was separate from the later full Items 001–057 cross-source reconciliation audit.

---

# 13. CONFIRMED PRODUCT CORRECTIONS

## Item 002

Previous public wording included prohibited language such as:

`Usado y parcialmente funcional`

and referenced:

`bidones usados`

The public copy was corrected.

Do not restore the prohibited wording.

## Item 019

The comprehensive reconciliation audit identified Item 019 as the only remaining owner ambiguity.

Owner decision:

2 individual baskets at Gs. 140.000 each.

This decision is authoritative unless the owner explicitly changes it.

## Item 032

The actual product photo was edited to remove visible pruning shears.

The corrected image is the intended image.

Do not restore the old photo containing the shears.

## Item 033

Confirmed price:

Gs. 24.000

## Item 039

Known wording/data correction was completed during original-inventory cleanup.

Refer to current committed source for the final authoritative text.

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

The two units are NOT interchangeable because their individual wear/use characteristics differ.

Public information should make clear:

- photographs show one of the two units;
- both have comparable signs of wear.

---

# 14. HOMEPAGE — COMPLETED

The old section:

`PAGO COMPLETO / disponibles para retirar ahora`

was removed.

The delayed/reservation section was retained:

`SEÑA CONFIGURABLE`

The delayed/reservation shelf now:

- uses the unified delayed-product catalog;
- has navigation arrows;
- shows X de Y;
- shows the total delayed-product count;
- provides navigation through additional products;
- includes `Volver arriba` links where required.

Existing homepage behavior was preserved:

- search;
- result count;
- filters;
- sorting;
- reset behavior.

---

# 15. PRODUCT DETAIL — COMPLETED

## Pickup information

The previous `Para el retiro` content was reorganized.

Detail pages now distinguish:

`ESTE ARTÍCULO`

from:

`POLÍTICA GENERAL`

Item-specific logistics remain separate from universal pickup policy.

Existing fields such as these are used appropriately where relevant:

- `logisticsNotes`
- `requiresVehicle`
- `requiresLoadingHelp`

The general pickup-location wording is aligned to:

`Retiro personal en San Lorenzo, Barrio Santo Tomás.`

## Photo/lightbox viewer

Detail-page product-photo viewing is working.

Verified functionality includes:

- Ver foto(s);
- main-photo lightbox;
- multiple-photo thumbnail strip;
- active thumbnail;
- switching photos via thumbnails;
- previous/next photo arrows;
- keyboard navigation;
- larger close target;
- mouse-wheel zoom;
- drag/pan while zoomed.

Homepage photo/lightbox behavior also remains working.

---

# 16. FOOTER — COMPLETED

The previous wording:

`La dirección exacta nunca se publica.`

was removed.

Current intended footer wording:

`Retiro personal en San Lorenzo, Barrio Santo Tomás · Sin delivery ni envíos.`

---

# 17. ENCODING / MOJIBAKE — COMPLETED

Known customer-facing commerce mojibake/UTF-8 problems were corrected at SOURCE level.

No runtime text-repair hack was introduced.

The main current customer/admin sources were checked for the common mojibake markers previously encountered.

Do not reintroduce runtime text-replacement patches to hide source encoding errors.

If a future encoding problem appears:

fix the actual source.

---

# 18. PREVIOUS STOREFRONT REGRESSION BASELINE

A full storefront regression pass was successful before the current reconciliation implementation work began.

Known-good behavior included:

- 153 articles;
- search;
- filters;
- sort ascending/descending;
- reset filters;
- reservation carousel;
- delayed-product count/navigation;
- targeted Items 002/032/033/039/047/057;
- product-detail rendering;
- detail photo/lightbox behavior;
- homepage photo/lightbox behavior;
- Agregar;
- Reservar;
- cart count;
- footer;
- visible text encoding.

Future changes touching storefront/customer data should preserve this baseline.

Because the Items 001–057 reconciliation implementation is currently still in progress, its completed corrections must receive an appropriate final regression before that workstream is closed.

---

# 19. ABANDONED APPROACHES — DO NOT RESURRECT

The project previously suffered regressions from stacked runtime controllers/patches.

Do not resurrect:

- `js/catalog-runtime-fix-v4.js`
- `js/catalog-runtime-fix-v5.js`
- `js/catalog-runtime-v6.js`

These files/approaches are abandoned.

Previous `.bak-*` files are not production architecture.

Backup files may only be consulted as historical evidence when specifically necessary.

Never automatically deploy or commit backups.

Do not reintroduce competing catalog event-handler systems.

Do not reintroduce runtime text-repair hacks.

---

# 20. CURRENT ACTIVE WORKSTREAM

ACTIVE OWNER:

Chat #4

ACTIVE TASK:

Complete implementation of the approved Items 001–057 reconciliation results and perform final verification/regression for that workstream.

## Audit status

The comprehensive Items 001–057 admin/public/source/history reconciliation audit is COMPLETE.

It is no longer a pending discovery task.

The audit found one owner ambiguity:

Item 019.

Owner decision:

2 individual baskets at Gs. 140.000 each.

## Implementation status

Implementation of the approved reconciliation results is IN PROGRESS.

Items 016, 025, and 036 were corrected locally in `index.html`.

Those changes were safely preserved, committed, rebased with the project-master addition, and pushed.

Current synchronized checkpoint after that work:

`d6e911e`

Branch:

`main`

Working tree was confirmed clean and synchronized with `origin/main` after the push.

Chat #4 owns ONLY this reconciliation implementation workstream until it is completed or explicitly reassigned.

No other programming chat should simultaneously modify files belonging to this workstream.

---

# 21. ITEMS 001–057 RECONCILIATION — AUDIT COMPLETE

The comprehensive Items 001–057 cross-source reconciliation audit has been completed.

The audit compared available current and legacy/admin/source/history information across the applicable original inventory.

The purpose was to identify stale legacy values, current authoritative values, clearly reconcilable discrepancies, and genuine ambiguity.

The only owner ambiguity identified by the completed audit was Item 019.

That ambiguity has been resolved by the owner.

Owner resolution:

Item 019 = 2 individual baskets at Gs. 140.000 each.

The current workstream is therefore no longer:

discover all discrepancies.

The remaining work is:

1. implement all approved reconciliation corrections;
2. preserve current Blob override precedence;
3. preserve all previously confirmed product facts;
4. verify resulting data;
5. perform relevant regression testing;
6. update this file when implementation is complete;
7. commit and push the final completed workstream.

Do not restart the entire Items 001–057 audit unless new evidence establishes a specific unresolved discrepancy.

## Fields covered by the reconciliation requirement

The audit requirement included available fields such as:

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
- `requiresVehicle`;
- `requiresLoadingHelp`;
- availability/reservation-related data;
- relevant image/primary-image metadata;
- other public-facing product fields;
- current Blob override data;
- relevant recoverable editing/history information.

## Reconciliation classifications used

A. MATCH

Sources materially agree.

B. CLEARLY RECONCILABLE

Sources differ but established precedence clearly determines the authoritative value.

C. AMBIGUOUS — OWNER DECISION REQUIRED

Sources conflict and available evidence does not establish the correct value.

D. LEGACY / INTERNAL ONLY

Difference is intentional because the source/value is historical, research, reviewer, internal pricing, etc.

E. NOT APPLICABLE / INSUFFICIENT SOURCE DATA

A meaningful comparison cannot be made.

Do not silently convert category C into category B.

## Important historical example: Item 031

Item 031 helped expose stale-data divergence.

Known historical discrepancy included:

- old admin/source price around Gs. 170.000;
- established public value around Gs. 25.000.

Title/Nombre divergence was also observed.

Item 031 was one of the reasons the comprehensive reconciliation audit became necessary.

Legacy admin/source values must never automatically override established current values merely because they remain present in historical data.

---

# 22. RETAINED FUTURE WORK

The following tasks remain part of the project but are NOT part of Chat #4's current assignment.

They should be handled as separate future workstreams/chats.

---

## A. Volume 2 public-copy hygiene audit

Items 058–158 should be systematically verified for internal/reviewer material leaking into public customer copy.

Known examples previously identified included language similar to:

`No se identificaron otros objetos visibles que deban considerarse incluidos.`

`Se conservan las fotografías originales sin retoque.`

`Revisar señales de uso y detalles visibles antes de aprobar.`

`Defectos conocidos: No verificado. Confirmar marca, modelo, capacidad, enfriamiento y medidas.`

These examples indicate the need to distinguish between:

- customer-facing information;
- internal reviewer/admin instructions;
- verification TODOs;
- actual confirmed defects.

Do not assume the completed Items 001–057 cleanup automatically covered Volume 2.

STATUS:

Needs verification/completion in a separate workstream.

---

## B. Product-to-product navigation on detail pages

A prior requirement requested a user-friendly way to navigate from one PRODUCT detail page to other products.

This is separate from navigating between multiple photos of one product.

The already-completed photo lightbox navigation does NOT fulfill this requirement.

Possible implementation may use:

- previous product;
- next product;
- another suitable product-navigation interface.

Do not redesign it during unrelated work.

STATUS:

Apparently not yet completed.

Verify current behavior before implementing.

---

## C. Pickup scheduling after approved payment

A simple pickup-scheduling feature was previously requested.

This is a future commerce workstream.

Pickup scheduling must only become available after seller-approved payment.

See the commerce workflow below.

STATUS:

Not yet confirmed implemented.

---

# 23. COMMERCE / ORDER WORKFLOW — RETAINED BUSINESS RULES

The intended customer/payment flow is:

1. Customer adds item(s).
2. Customer proceeds through cart/checkout.
3. Buyer details are collected.
4. Server creates the order/hold.
5. Customer receives bank-transfer instructions.
6. Customer uploads comprobante/payment receipt.
7. RECEIPT UPLOAD ALONE DOES NOT CONFIRM PAYMENT.
8. Seller/admin manually verifies that the funds were actually received.
9. Seller/admin explicitly approves/confirms payment.
10. Order state changes appropriately.
11. Only after required payment is approved may pickup scheduling become available.

For immediate/full-payment items:

approved payment can move the item toward sold/ready-for-pickup status.

For delayed/reservation items:

approved required deposit can establish the reservation according to existing commerce rules.

Do not casually redesign this state machine.

---

# 24. CUSTOMER PORTAL RULES

The customer portal/order-access system uses:

- order number;
- private/random access token or private order link.

It is NOT intended to use phone-number-only authentication.

Future work must preserve private order access.

---

# 25. FUTURE PICKUP-SCHEDULING REQUIREMENT

Pickup scheduling must NOT be a general public calendar.

Intended sequence:

Order placed

→ payment instructions

→ receipt uploaded

→ seller verifies actual funds

→ seller manually approves payment

→ ONLY THEN pickup scheduling becomes available to that order/customer.

The customer should then be able to choose from available pickup date/time options through the private customer order portal.

The selected pickup appointment should be associated with the order and visible to seller/admin.

Do not allow pickup scheduling merely because a receipt was uploaded.

Payment approval is the gate.

STATUS:

Retained future commerce feature.

Not assigned to Chat #4.

---

# 26. COMMERCE ENGINEERING CAUTIONS

These are retained technical cautions, not automatically assigned work.

## Blob concurrency / locking

Previous project analysis noted that Netlify Blob-based order/inventory locking is not necessarily fully transactional.

This may need review before significant real-money transaction volume.

Do not redesign it during unrelated tasks.

## Product-override listing pagination

`listProductOverrides()` may eventually require pagination review if the number of overrides grows.

This is a future robustness concern unless current behavior demonstrates a real problem.

---

# 27. HISTORICAL / PHOTO MIGRATION NOTE

Older filename-based product photos/assets may still need migration or connection.

This has NOT been established as a definite unfinished requirement.

STATUS:

Unverified.

Do not create a new workstream solely from this note unless current data demonstrates an actual problem.

---

# 28. NEW-CHAT STARTING PROCEDURE

Every future programming chat should first be directed to the public GitHub repository:

https://github.com/davelaboss/psych

The chat should read:

1. `NEW_CHAT_PROMPT.md`
2. `PROJECT_MASTER.md`

before changing anything.

The user then assigns ONE specific workstream.

A typical bootstrap is:

"Go to the public GitHub repository https://github.com/davelaboss/psych.

Read NEW_CHAT_PROMPT.md and PROJECT_MASTER.md completely before doing anything else.

Treat NEW_CHAT_PROMPT.md as the operating instructions for this chat and PROJECT_MASTER.md as the current project coordination record.

My assigned task is:

[ONE SPECIFIC TASK]

Do not change code until you have read both files and checked the current repository state."

No giant cross-chat historical handoff should normally be required after this system is established.

---

# 29. CURRENT PROJECT STATUS SUMMARY

## Completed

- Unified override-aware public catalog.
- Original inventory public-data hygiene cleanup.
- Prohibited original-inventory `usado/usada/usados/usadas` wording removed.
- Original public reviewer/TODO/verification leakage removed.
- `Medidas confirmadas` normalized.
- Known targeted original product corrections completed.
- Item 032 photo corrected.
- Homepage PAGO COMPLETO shelf removed.
- SEÑA CONFIGURABLE carousel completed.
- Reservation arrows / X de Y / count / Volver arriba completed.
- Search/filter/sort/reset behavior preserved.
- Detail pickup information reorganized.
- Footer/location wording updated.
- Source mojibake cleanup completed.
- Detail/homepage photo lightbox behavior completed.
- Previous full storefront regression passed.
- Comprehensive Items 001–057 reconciliation AUDIT completed.
- Item 019 owner ambiguity resolved.
- Items 016/025/036 reconciliation corrections committed and pushed.

## Active

Chat #4:

Finish implementation of all approved Items 001–057 reconciliation corrections and perform final verification/regression.

## Future retained work

Separate future chats:

1. Volume 2 public-copy hygiene audit.
2. Product-to-product navigation on detail pages.
3. Approved-payment pickup scheduling/calendar.

## Engineering cautions retained

- Blob concurrency/locking.
- `listProductOverrides()` pagination.

---

# 30. CURRENT CHECKPOINT

Current known synchronized checkpoint after preserving Chat #4's first implementation changes:

Commit:

`d6e911e`

Branch:

`main`

At the time this checkpoint was established:

- local `main` matched `origin/main`;
- working tree was clean;
- `PROJECT_MASTER.md` was present in the repository;
- Items 016/025/036 reconciliation corrections were pushed;
- Chat #4 was authorized to resume only its Items 001–057 reconciliation implementation workstream.

A future chat must verify current Git state rather than assuming this remains the latest commit forever.

---

# 31. CHANGE LOG

Future chats should append concise entries here after successfully completed/committed work.

Do not include secrets or private customer information.

Format:

## YYYY-MM-DD — Task name

- Owner/chat:
- Files changed:
- Result:
- Regression performed:
- Commit:
- Remaining follow-up:

---

## 2026-09-24 — Project coordination system established

- Owner/chat: Project governance/original project chat
- Files changed: `PROJECT_MASTER.md`
- Result: Established GitHub-based master project record and multi-chat coordination rules.
- Regression performed: Documentation-only coordination change.
- Commit: Refer to current Git history.
- Remaining follow-up: Create/maintain `NEW_CHAT_PROMPT.md` as canonical new-chat operating instructions.

## 2026-09-24 — Items 016/025/036 reconciliation implementation started

- Owner/chat: Chat #4
- Files changed: `index.html`
- Result: Approved reconciliation corrections for Items 016, 025, and 036 were applied and safely preserved.
- Regression performed: Final reconciliation regression still pending until the entire workstream is implemented.
- Commit: `d6e911e`
- Remaining follow-up: Chat #4 must finish the remaining approved Items 001–057 reconciliation implementation, test it, and close the workstream.
