# Psych Website — Project Master

Last updated: 2026-09-29

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

As of 2026-09-25, the Netlify team is on the Pro plan with 3,000 credits/month.

Production deploys resumed normally after the previous Free-plan credit exhaustion paused deploys.

Do not redesign architecture because of that historical paused-deploy incident.

Use production deploys when they materially save time; optimize for completion speed rather than minimizing deploy count while staying within the current monthly credit budget.

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
- Use production deploys when they materially save completion time; do not artificially minimize deploy count.

## Production product-data workflow

Production product-data mutations should use the established supported application/admin architecture unless the owner explicitly approves another method.

Preferred path:

- use the normal `/admin` interface when it supports the required change;
- do not use ad-hoc DevTools Console mutation scripts or one-off browser mutation scripts without explicit owner approval;
- do not bypass the established admin/data workflow merely because a direct endpoint or Blob write is technically possible;
- change only the fields that actually need correction;
- do not change photos, internal pricing/research, or unrelated fields unless the assigned workstream requires them.

Optimize for owner time:

- batch known safe corrections whenever practical;
- batch verification steps whenever practical;
- request all relevant files together when files are needed;
- batch safe read-only diagnostics where doing so avoids repetitive owner interaction.

## Git workflow

The site owner is not a programmer.

For routine, known-safe Git workflows:

- provide the FULL command sequence at once;
- briefly state what should be expected after each command;
- the owner will stop and report back if the actual result materially differs.

Use one-command-at-a-time mode only when:

- the next command depends on the exact previous output;
- merge/rebase conflicts are possible;
- the working tree is unexpectedly dirty;
- local and remote history have diverged;
- restore/reset/stash operations are involved;
- another chat may have uncommitted work;
- a command could overwrite, discard, or complicate existing work.

Safe read-only diagnostics may be batched.

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
   - update this file with the completed factual status;
   - update `NEW_CHAT_PROMPT.md` if a permanent workflow rule changed;
   - stage exact intended files;
   - commit;
   - push;
   - verify the final checkpoint and clean/synchronized Git state.
   - use the grouped-vs-stepwise Git policy in `NEW_CHAT_PROMPT.md` Section 7.

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

`netlify.toml` publishes the repository root directly:

- publish directory: `.`
- functions directory: `netlify/functions`
- no separate production build step generates a replacement `index.html`

Therefore, when current GitHub `main` is successfully deployed, the committed root `index.html` is the production base document.

The September 2026 stale-production incident was caused by Netlify production deploys being paused after the Free-plan credit allowance was exhausted.

It was NOT an architecture failure.

After the Netlify team was upgraded to Pro and a production deploy was triggered, the current committed source began publishing normally again.

No architecture change was made or required because of that incident.

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

For original products, the committed base catalog is loaded from the public root document and Netlify Blob product overrides are applied on top of that base at runtime.

The current runtime precedence is therefore:

base product

→ stored Blob `publicFields` / image override where present

→ resolved public product

A stale Blob override can survive a source deployment and continue to mask corrected committed base data.

A successful source deploy does NOT automatically clear or rewrite product Blob overrides.

When a stale Blob override conflicts with an approved current product fact, correct the override through the established `/admin` workflow rather than adding a competing runtime patch.

Netlify Blob admin overrides remain the highest-priority runtime override layer.

Do NOT recreate separate competing storefront/catalog controllers.

Do NOT layer additional runtime patch scripts over the consolidated architecture.

The consolidated storefront controller includes:

`js/volume2-storefront.js`

`js/site.js` remains part of the existing storefront/product/cart behavior.

---

# 8. INVENTORY

Original inventory:

Items 001–057

Current verified published/sellable original records:

52

Legacy unpublished original records:

- Item 034
- Item 044
- Item 053

Items without a meaningful current public record in the completed reconciliation:

- Item 055
- Item 056

Volume 2:

Items 058–158

Volume 2 contains:

101 products

Current verified storefront total (2026-09-29):

158 articles

The item-number range and number of currently sellable cards are not assumed to be identical.

Future inventory may continue beyond Item 158.

---

# 9. DATA AUTHORITY / PRECEDENCE

Distinguish runtime precedence from semantic authority.

## Runtime precedence

For resolved public products, a current Netlify Blob product override is applied on top of the committed base product and therefore wins at runtime for fields it overrides.

This is an implementation fact, not proof that every stored override is semantically current.

## Reconciliation authority

For product reconciliation, preserve this authority logic:

1. Explicit current owner/seller-confirmed information.
2. Established current public information known to supersede stale historical values.
3. Current committed source that implements those approved facts.
4. Existing Blob override data when it is consistent with the approved current facts.
5. Older embedded/static/Phase 2/admin/source/history information as historical evidence only.

A newer timestamp alone does not prove semantic authority.

A stored Blob override can itself be stale.

When a Blob override conflicts with an approved current fact:

- do not treat runtime precedence as semantic truth;
- correct the stale override through the supported `/admin` workflow;
- do not add an ad-hoc runtime patch to fight the override.

When sources genuinely conflict and the established authority does not resolve the discrepancy:

- do not guess;
- do not silently overwrite;
- report the ambiguity to the owner.

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

The completed Items 001–057 reconciliation established and/or re-verified the following important product facts.

## Item 002

Current public facts:

- cold water works very well;
- hot-water function does not work;
- includes 4 large jugs;
- condition is partially functional;
- do not restore prohibited `Usado/Usada` wording.

## Item 016

The public measurement wording is:

`Medidas de la maceta:`

Do not restore:

`Medidas confirmadas de la maceta:`

## Item 017

`poco uso` / `tuvo poco uso` is seller-confirmed.

## Item 019

Owner resolution:

- 2 individual woven baskets;
- sold separately;
- Gs. 140.000 each;
- `quantityTotal = 2`;
- `quantityRemaining = 2`;
- current title: `Canasto tejido (cada uno)`;
- condition: `Excelente estado`;
- seller-confirmed `Semi-nuevo` wording remains valid.

Do not restore the stale `Juego de canastos tejidos` / Gs. 120.000 total-set data.

## Item 020

Current reconciled public facts include:

- title: `Florero azul (flores no incluidas)`;
- asking price: Gs. 100.000;
- the flowers visible in the photo are not included.

## Item 025

Current reconciled public facts include:

- title: `Reloj de pared decorativo de café`;
- asking price: Gs. 65.000;
- public `knownDefects` is blank.

Do not restore verification-task wording such as `Movimiento y precisión no verificados.`

## Item 028

Current reconciled public facts include:

- title: `Helecho con maceta con colgador metálico (sin mesa)`;
- asking price: Gs. 50.000;
- the table visible in the photo is not included;
- included: plant, pot, metal hanger;
- public `knownDefects` is blank.

## Item 031

Current authoritative public facts:

- Gs. 25.000 each;
- 2 plants available;
- each price is for one plant with its pot;
- the table is not included.

Do not restore the old higher legacy/admin price.

## Item 032

The actual product photo was edited to remove visible pruning shears.

The corrected image is the intended image.

Do not restore the old photo containing the shears.

## Item 033

Current authoritative public facts:

- asking price: Gs. 24.000;
- title includes 3 small plants, pots, and a rustic small table;
- the rustic table is included.

## Item 036

The public placeholder:

`Medidas a ser agregado.`

was removed.

Do not invent replacement dimensions without confirmed evidence.

## Item 039

Seller-confirmed wording:

`(Poco uso)`

Do not restore:

`(Apenas usada)`

## Item 047

There are 3 shelves sold individually.

Each shelf includes:

- 3 rear/support metal brackets.

Not included:

- black horizontal bar;
- hooks/S-hooks.

Do not claim screws/bolts are included without confirmed evidence.

## Item 054

Current public record:

- `Mesa auxiliar plegable blanca marmolada`;
- asking price: Gs. 220.000;
- requires a suitable vehicle.

Old review/TODO material is stale and must not control public copy.

## Item 057

Current authoritative public facts:

- white / blanco;
- quantity 2;
- sold by unit at Gs. 180.000 each;
- the two units are NOT interchangeable because individual wear differs;
- photographs show one of the two units;
- both have comparable signs of wear.

Do not restore the stale gray/interchangeable description.

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

# 18. FINAL STOREFRONT / RECONCILIATION REGRESSION BASELINE

A full storefront regression had already passed before the final Items 001–057 reconciliation closeout.

The final reconciliation regression was completed again on 2026-09-25 against production after the current source was successfully redeployed and stale Blob overrides were corrected through `/admin`.

Verified production results:

- unified catalog total = 153;
- published original records = 52;
- legacy/non-current original Items 034, 044, 053, 055, and 056 absent from the resolved public original set;
- no prohibited public `Usado/Usada/Usados/Usadas` condition wording in Items 001–057;
- no `Medidas confirmadas`;
- no obvious public review/TODO leakage matching the targeted reconciliation patterns;
- Item 019 correct;
- Item 020 correct;
- Item 025 correct;
- Item 028 correct;
- Item 033 correct;
- Item 039 correct;
- Item 047 correct;
- Item 057 correct;
- homepage reports 52 original articles;
- old `PAGO COMPLETO` shelf absent;
- `SEÑA CONFIGURABLE` present;
- footer uses the approved San Lorenzo / Barrio Santo Tomás wording;
- old footer wording absent.

The first Windows CMD comparison produced false negatives for Items 025, 028, and 047 because accented literals were involved.

A follow-up ASCII-safe production check passed all three:

- Item 025 = true;
- Item 028 = true;
- Item 047 = true.

The owner then completed the requested visual/interactive production review and confirmed the result:

NOMINAL

Known-good storefront behavior to preserve includes:

- search;
- filters;
- sort ascending/descending;
- reset filters;
- reservation carousel;
- delayed-product count/navigation;
- product-detail rendering;
- detail photo/lightbox behavior;
- homepage photo/lightbox behavior;
- Agregar;
- Reservar;
- cart count;
- footer;
- visible text encoding.

Future changes touching storefront/customer data should preserve this baseline.

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

None.

ACTIVE TASK:

None. The sale-readiness customer UX punch list was deployed and production-checked on 2026-09-25. Its source and buyer-facing changes are recorded in the closeout entry below.

Chat #4's Items 001–057 reconciliation implementation workstream is COMPLETE and CLOSED as of 2026-09-25.

## Audit status

The comprehensive Items 001–057 admin/public/source/history reconciliation audit is COMPLETE.

Do not restart it unless new evidence identifies a specific unresolved discrepancy.

The only owner ambiguity found by the completed audit was Item 019.

Owner resolution:

2 individual baskets at Gs. 140.000 each.

## Implementation status

COMPLETE.

The approved source corrections were implemented.

After the Netlify Pro upgrade restored production deployments, the current committed source was successfully published.

A fresh admin inventory export then identified four remaining stale Blob public-field overrides:

- Item 019
- Item 020
- Item 025
- Item 028

All four were corrected through the supported `/admin` interface in one owner pass.

A second inventory export verified all four corrections.

Final production regression passed and the owner confirmed NOMINAL.

No unrelated future workstream is activated by this closeout.

---

# 21. ITEMS 001–057 RECONCILIATION — COMPLETE

The comprehensive Items 001–057 cross-source reconciliation audit, approved implementation, Blob reconciliation, and final regression are COMPLETE.

The audit compared available current and legacy/admin/source/history information across the applicable original inventory.

The purpose was to identify:

- stale legacy values;
- current authoritative values;
- clearly reconcilable discrepancies;
- current runtime Blob conflicts;
- genuine ambiguity.

The only owner ambiguity identified by the completed audit was Item 019.

Owner resolution:

Item 019 = 2 individual baskets at Gs. 140.000 each.

That resolution was implemented in the committed base source and, after deployment, in the stale Blob override that had continued to mask the base value.

The final stale Blob overrides corrected through `/admin` were:

- Item 019;
- Item 020;
- Item 025;
- Item 028.

A fresh admin inventory export verified all four.

Final production regression then passed.

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

Sources differ but established authority clearly determines the authoritative value.

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

COMPLETE AND CLOSED on 2026-09-29. All 101 source records were audited against the 95 listed live products; six records remain intentionally unlisted. The three previously known boilerplate examples were already suppressed by the public transform. This pass corrected Item 153's unverified pump wording and removed Item 148's speculative candle note after owner confirmation. The live public catalog was verified after deployment.

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
- Volume 2 Items 058–158 public-copy hygiene audit completed and production verified on 2026-09-29.
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
- Comprehensive Items 001–057 reconciliation audit completed.
- Item 019 owner ambiguity resolved.
- Approved Items 001–057 reconciliation implementation completed.
- Production source redeployed successfully after Netlify deploy credits were restored.
- Stale Blob overrides for Items 019, 020, 025, and 028 corrected through `/admin`.
- Fresh admin export verified those four Blob corrections.
- Final Items 001–057 production regression passed.
- Owner confirmed final production result NOMINAL.
- Permanent production-data/admin and Git workflow rules incorporated into `NEW_CHAT_PROMPT.md`.

## Active

None. The sale-readiness customer UX punch list is complete and closed.

No future workstream should be started merely because it is listed below.

The owner must explicitly assign the next workstream.

## Future retained work

Separate future chats may address, when explicitly assigned:

1. Product-to-product navigation on detail pages.
2. Approved-payment pickup scheduling/calendar.

## Engineering cautions retained

- Blob concurrency/locking.
- `listProductOverrides()` pagination.

---

# 30. CURRENT CHECKPOINT

Immediately before the final documentation closeout, Git was verified clean and synchronized:

`## main...origin/main`

The synchronized pre-closeout commit was:

`97bb708`

Branch:

`main`

Important distinction:

- the source repository was already clean and synchronized at that checkpoint;
- the final stale product-data corrections for Items 019, 020, 025, and 028 were production Blob/admin data changes made through `/admin`, not new source-code edits;
- the final production regression passed after those admin corrections;
- the owner confirmed NOMINAL;
- the only intended repository changes for final closeout are the coordination-document updates in `NEW_CHAT_PROMPT.md` and `PROJECT_MASTER.md`.

The final closeout checkpoint is the Git commit containing this project-master update.

Future chats must verify the current Git state rather than assuming `97bb708` remains the latest commit forever.

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

## 2026-09-25 — Items 001–057 reconciliation completed and closed

- Owner/chat: Chat #4
- Files changed during source implementation: `index.html` in earlier reconciliation commits; final closeout documentation updates `NEW_CHAT_PROMPT.md` and `PROJECT_MASTER.md`.
- Production data changed during final reconciliation: Blob public-field overrides for Items 019, 020, 025, and 028, corrected through the supported `/admin` interface.
- Result: Completed the approved Items 001–057 reconciliation implementation; restored normal production publishing after the Netlify plan upgrade; reconciled the remaining stale Blob overrides; updated permanent admin/data and Git workflow rules.
- Regression performed: Fresh admin export verification; production catalog/homepage regression; ASCII-safe follow-up for Items 025/028/047; owner visual/interactive review.
- Owner confirmation: NOMINAL.
- Commit: The final documentation checkpoint is the Git commit containing this entry.
- Remaining follow-up: None for the Items 001–057 reconciliation workstream. Retained future work remains separate and unassigned until explicitly started.

## 2026-09-25 — Sale-readiness customer UX punch list, production verified and closed

- Owner/chat: Sale-readiness customer UX punch list.
- Files changed: `index.html`, `css/site.css`, `js/site.js`, `js/checkout.js`, `js/volume2-storefront.js`, and `assets/media/maria-david-luciano.png`; this coordination entry in `PROJECT_MASTER.md`.
- Result: Fixed the BUSCAR input overlap; clarified delayed-item final payment (December 1–8, 2026) and pickup (December 9–12, 2026) across product detail, cart, checkout, and private order views; aligned cart labels and payment-window callout; added cart gutters; updated the top-strip neighborhood, family illustration, homepage eyebrow, and catalog card hierarchy. Available cards say `Agregar al carrito`; delayed cards show one pickup label and `Seña 25%`. Product data, prices, deposit arithmetic, search/filter result logic, cart totals, and reservation state transitions were not changed.
- Regression performed: JavaScript syntax and `git diff --check`; static/dynamic card and date-copy checks; owner visual checks on desktop/mobile. After deploying source commit `aa18c45`, a public browser check found the 153-article catalog; a `licuadora` search returned 2 of 153, delayed-pickup filtering returned 25 of 153, sort and filter reset worked, and the reservation carousel advanced. Item 017 detail, cart, and checkout displayed the approved December 1–8 final-payment and December 9–12 pickup windows. Its Gs. 175.000 total split into Gs. 43.750 due now and Gs. 131.250 pending; adding and removing it updated the cart count, leaving the browser cart empty. No production order or payment confirmation was created.
- Owner confirmation: Owner approved the final local desktop/mobile appearance and requested closeout; the production checks above were performed in this chat.
- Commit: Buyer-facing source and initial coordination entry deployed in `aa18c45`; this final documentation entry is in a subsequent documentation-only checkpoint.
- Remaining follow-up: None for this UX workstream. The separate pickup-scheduling workstream should reconcile its `netlify/functions/_shared/commerce.mjs` `delayedPickup.endDate` of `2026-12-13` with the owner's approved December 9–12 pickup window before scheduling goes live.


## 2026-09-27 — Product merchandising / sale-readiness implementation in progress

- Owner/chat: Product merchandising / sale-readiness completion.
- Working branch: `merchandising-sale-readiness-2026-09-27`.
- Photo checkpoint already committed and pushed to `main`: `d88631cd6659684b198063e5d788a2e091d5ea10` (`Add sale-readiness product photos`).
- Source files updated on the work branch so far: `source/lib/volume2-batch.ts` and `source/lib/volume2-image-map.mjs`.
- Result so far: owner-confirmed Volume 2 merchandising facts, revised asking prices, measurements, condition/functionality wording, availability, and new photo assignments have been incorporated into the durable source baseline while preserving established photo assignments except where the owner explicitly supplied replacements/additions.
- Important Item 056 restoration: the older ChatGPT Sites inventory contained **Item 056, TP-Link MC111CS V4.0 media converter**. Preserve Item 056; do not assign it a new item number. The owner later superseded the earlier two-photo note and supplied **3 product-photo filenames** for Volume 2A: `IMG_8128`, `PXL_20260913_152523154`, and `IMG_8127`. Attach all three once the actual files are visible in the repository. The former draft asking price was Gs. 120.000, but the final price must be reconfirmed before publication.
- Other photo dependency still pending from owner: the new dark-gray folding side tables, 2 units at Gs. 70.000 each with later pickup, still need their product photos.
- Split/companion listings to preserve in later implementation: second/delayed curtain set for Item 060 as needed by the single-saleMode data model; remaining curtain rod associated with Item 060 (Gs. 90.000, later pickup); curtain rod associated with Item 117 (Gs. 45.000, later pickup); Google Chromecast 3rd generation separated from old Item 116 cover photo (Gs. 60.000); Item 081 split into simple square plus combination square; Item 152 split by availability if required by the one-saleMode-per-listing model; Item 158 split into cortahierro/cincel, wire stripper, and small hand saw.
- Duplicate/removal decisions retained: remove/unlist Item 096 (given away), Item 111 duplicate of Item 045, Item 118 duplicate of Item 054, Item 128 duplicate absorbed into Item 129, Item 132 given away, and Item 137 given away. Item 119 is sold. Item 150 is sold; do not restore the corrupt photo.
- Original Items 001–057 remain governed by the closed reconciliation workstream. Any new owner-approved changes from this merchandising chat should be applied through the supported normal `/admin` workflow where possible rather than reopening the prior reconciliation wholesale.
- Pending owner-approved original-catalog admin reconciliation after this branch is ready for test: Item 019 Gs. 120.000 each, quantity 2; Item 020 Gs. 42.000; Item 045 remains the two matching chairs and should absorb the applicable Item 111 photo `images/volume-2a/IMG_7926.JPG` before Item 111 stays unlisted; Item 047 title `Repisas macizas`, Gs. 75.000 each, quantity 3, measurements 100 × 3,7 × 29,3 cm, three rear/support metal brackets included per shelf, black horizontal bar/hooks excluded, and no `flotante/flotantes` wording; Item 052 Gs. 42.000 total; Item 054 Gs. 90.000 with December 9–12 pickup and wording that it remains wrapped/covered in its original protective plastic without calling it new; Item 057 Gs. 60.000 each, quantity 2, with later pickup and wording that the two units have their own wear while the photos show one unit.
- Public-copy rule retained: remove generic reviewer/internal boilerplate from buyer-facing copy, including generic statements about original photos, unidentified visible objects, TODO/review instructions, and generic condition wording using `usado/usada/usados/usadas`.
- Public condition-display rule clarified by owner on 2026-09-28: do not show generic buyer-facing `Estado visual según fotografías` (or equivalent photo-only condition wording) anywhere on the site. If no meaningful condition fact exists, omit the condition pill/`Estado` row entirely. Meaningful specific wear, damage, or functionality defects may still be shown. Photo-edit cleanup must also remove stale exclusions that refer to objects removed from the edited image; Item 059 specifically should no longer say that curtains or other furniture are excluded after those objects were removed from its published photo.
- Public-copy deduplication rule clarified by owner on 2026-09-28: do not repeat the same measurements, functionality statement, exclusion, or other factual sentence twice in a buyer-facing description. Keep structured facts, but the public transform should suppress a structured measurement/functionality append when that fact is already present in the description and should preserve normal sentence punctuation between composed fields. A full source scan at this checkpoint found no remaining exact duplicate sentences in the original embedded catalog and no remaining clear measurement/functionality/exclusion duplication in Volume 2 or the supplemental listings. Clear fixes made in this pass: Item 060 measurement duplication removed, Item 063 measurement duplication removed, Item 080 tester functionality wording deduplicated, and companion Item 159 measurement duplication removed.
- Expected gross asking-price revenue after the owner-confirmed merchandising changes is approximately **Gs. 30.200.000**, excluding Item 056 because its final price is not yet reconfirmed. If Item 056 retains its old Gs. 120.000 draft price, the corresponding total would be approximately **Gs. 30.320.000**.
- Source consistency validation before owner testing: the Volume 2 source still contains exactly 101 immutable Items 058–158; the supplemental source contains 10 records (Item 056 plus Items 159–167); Volume 2 status counts are 93 available, 2 sold, and 6 unlisted; all 232 referenced product-photo filenames resolve through the image map to files that exist in the branch; remaining gross asking-price math reconciles to Gs. 30.200.000 when the pending dark-gray tables are included and Item 056 is excluded, or Gs. 30.320.000 if Item 056 ultimately retains its old Gs. 120.000 draft price.
- Regression/production verification: pending until local owner testing and the complete merchandising batch are merged/deployed.
- Remaining follow-up: finish source/admin reconciliation, create the required companion/new listings without reusing retired Item IDs, incorporate Item 056 and dark-gray-table photos when supplied, run regression, obtain owner NOMINAL confirmation, then close this workstream.


## 2026-09-28 — Terminal command handoff preference

- Owner/chat: Product merchandising / sale-readiness completion.
- Permanent workflow rule: future programming chats should give terminal/Git instructions one copy-and-paste command or compact command block at a time, followed immediately by the expected result.
- Owner interaction rule: if the result matches the stated expectation, the owner may continue without pasting the output back. Request pasted output only when the result differs materially, exact output is needed for the next step, or a risky/conflicted Git state requires inspection.
- Canonical instruction updated: `NEW_CHAT_PROMPT.md`.
- Remaining follow-up: none; this rule applies to future website programming chats.

- Permanent workflow clarification from owner on 2026-09-28: when the assistant has tool/connector access to make a safe repository change directly, the assistant should make the change and the owner should verify/test it. Do not hand the owner source code to paste for changes the assistant can apply itself.

- Local test workflow correction from owner on 2026-09-28: a previous fetch + fast-forward pull + browser Ctrl+F5 did not expose the new catalog/function behavior while `npx netlify dev` was already running. For changes under `netlify/functions` or imported source/data modules, restart the Netlify dev process after pulling before browser verification; do not rely on Ctrl+F5 alone.

- Permanent photo-preservation rule from owner on 2026-09-28: adding new photos is additive by default. Do not remove, replace, or detach existing product photos unless the owner explicitly asks, or the photo is intentionally reassigned in an explicitly approved split/duplicate correction. Audit after this clarification restored unintentionally dropped legacy photos to Items 064, 071, 077, 086, 103, and 151. Item 071 now has 5 photos total: 3 newer PXL photos plus original IMG_7830.JPG and IMG_7831.JPG. Intentional split-related removals remain for Items 081, 116, 117, and 158 because those photos belong to approved companion listings.

- Item 086 owner confirmation on 2026-09-28: use IMG_7855.JPG as the cover/first photo; describe age as approximately 5–6 years old with very little use; condition is perfect and functionality is fully working with no known issue. Owner expects to upload approximately 2 additional Item 086 photos later; preserve all existing photos and add the new ones when provided.


- Detail-page defect display rule (2026-09-28): show `Defectos conocidos` only when a specific confirmed defect exists; omit the row when there is no actual defect. Item 090 is the reference case: the front-right burner lights manually, but its automatic ignition does not work. The public catalog transform now exposes specific defect statements while suppressing generic/no-defect filler.

- Detail-page condition placement rule (2026-09-28): do not show a separate condition pill/tag directly below the price on product detail pages. If meaningful condition information exists, it may appear naturally in the description and in the structured lower `Estado` row. This avoids redundant condition copy such as Item 086 showing “En perfecto estado” in three places.


- Item 106 owner verification on 2026-09-28: listing content is otherwise NOMINAL, but the currently added third photo (IMG_8353.JPG) is the wrong image for this item. Replace it when the owner provides the correct photo showing the two main compartments open-backed so the wall is visible through them. Do not remove either of the two original Item 106 photos. Item 111 is confirmed hidden/NOMINAL as a duplicate of Item 045.

- Owner workflow rule added 2026-09-28: batch local verification. Do not require stop Netlify Dev -> fetch -> pull -> restart -> hard refresh after each small change. Keep a running recheck queue and request one local refresh at sensible checkpoints, unless an immediate validation is necessary to avoid building on an uncertain result. Current pending recheck queue includes Item 117 copy cleanup; Item 106 remains pending correct replacement third photo; Item 086 remains pending approximately two additional photos.

- Item 119 correction on 2026-09-28: the sold Singer sewing machine and rolling bag are separate products. Item 119 remains SOLD at Gs. 345.000 and now uses only its first 8 sewing-machine photos, through PXL_20260904_210026385.jpg. Remove “con bolso rodante”, remove the bag from included accessories, and never put “Artículo vendido” in the description. The rolling bag is a separate pending companion listing (next available supplemental ID: Item 168) using these 15 photos: PXL_20260904_210310279.jpg, PXL_20260904_210319849.jpg, PXL_20260904_210327829.jpg, PXL_20260904_210340018.jpg, PXL_20260904_210405823.jpg, PXL_20260904_210414517.jpg, PXL_20260904_210426648.jpg, PXL_20260904_210437854.jpg, PXL_20260904_210548036.jpg, PXL_20260904_210557880.jpg, PXL_20260904_210611395.jpg, PXL_20260904_210621040.jpg, PXL_20260904_210631335.jpg, PXL_20260904_210708822.jpg, PXL_20260904_210808221.jpg. Do not publish Item 168 until owner confirms its price and availability/status timing. Sold detail pages should show VENDIDO, not generic NO DISPONIBLE. Item 150 had the same redundant “Artículo vendido” copy removed under this rule.


- Item 119 availability correction on 2026-09-28: prior buyer reneged. Item 119 sewing machine is no longer SOLD and is available now at the existing Gs. 345.000 price. Keep only the first 8 sewing-machine photos. The rolling bag remains a separate pending Item 168; owner will provide its price next. Item 118 remains hidden as the duplicate of Item 054.

- Owner-confirmed dimensions/accessories batch on 2026-09-28:
  - Item 122: 103 cm wide × 55 cm deep × 79 cm high.
  - Item 168 rolling bag: 48 cm wide × 30 cm deep; 43 cm high to top of bag; 51 cm high to top of closed handle; 95 cm high with handle fully extended. Price confirmed at Gs. 150.000 (USD 25 × Gs. 6.000 exactly). Draft listing created with its 15 bag photos; remains UNLISTED only because availability timing is still pending confirmation.
  - Item 054: 48 cm wide × 38 cm deep × 65 cm high. Source fallback updated; production/admin override must also be updated during live publish if it supersedes source.
  - Item 117: each curtain panel 107 cm wide × 157 cm high.
  - Item 161 curtain rod: 180 cm long and adjustable; includes mounting brackets.
  - Mounting brackets also added to companion curtain-rod Item 160, interpreting the owner's “all curtains include the mounting brackets” statement as applying to the curtain rods, not the fabric curtain sets.
  - Item 116: 100 cm wide × 37 cm deep × 85 cm high.
  - Item 113: 46 cm diameter.
  - Item 112: 59.5 cm wide × 45 cm high; includes accessories not pictured.
  - Item 110: fully open 111 cm wide × 59 cm high; slid/compressed closed width 60 cm.
  - Item 109: closed height 132 cm, width 45 cm; when open, top step height 70.5 cm.
- Recheck queue after next batched local refresh now includes Items 109, 110, 112, 113, 116, 117, 122, 160, 161, Item 054 dimensions, Item 119 availability/split, plus prior pending Item 106 replacement photo and Item 086 additional photos. Item 168 remains pending price and therefore is not yet published.

- Item 168 price confirmation on 2026-09-28: owner set the rolling bag at USD 25 using Gs. 6.000/USD. Exact result is Gs. 150.000, so no rounding was needed. Item 168 now matches Item 119 availability: AVAILABLE NOW / immediate pickup, with 15 bag photos, confirmed dimensions, and Gs. 150.000 price.

- Item 168 availability confirmation on 2026-09-28: owner instructed it to match Item 119. Item 119 is AVAILABLE NOW, so Item 168 is also AVAILABLE NOW (IMMEDIATE), no longer UNLISTED/needs-review for availability.

## Current merchandising launch-readiness snapshot — 2026-09-28
- Incomplete and intentionally not publishable yet: Item 056 TP-Link MC111CS V4.0 media converter. It has no attached photos in source, is UNLISTED/needs-review, still expects exactly 2 Volume 4 photos, and its old Gs. 120.000 draft price still requires final owner reconfirmation.
- Incomplete and intentionally not publishable yet: Item 163 dark-gray folding side tables. Two units at Gs. 70.000 each, later pickup, but no photos are attached; it remains UNLISTED/needs-review until owner supplies the photos.
- Item 106 is otherwise NOMINAL but still has the wrong third photo (IMG_8353.JPG). Replace only that third photo once the owner supplies the correct open-back photo; preserve IMG_7915.JPG and IMG_7917.JPG.
- Item 086 is currently NOMINAL and publishable with its existing photos/content. Owner expects approximately 2 additional photos later; those are additive follow-up, not a launch blocker.
- Item 119 sewing machine is AVAILABLE NOW at Gs. 345.000 with only its first 8 sewing-machine photos. It is not sold.
- Item 168 rolling bag is AVAILABLE NOW at Gs. 150.000 with 15 bag photos and confirmed dimensions.
- Intentional hidden records 096, 111, 118, 128, 132, and 137 remain hidden for duplicate/given-away reasons and are not launch blockers.
- Before production publish/closeout: perform the batched local refresh/recheck, finish required original-catalog production/admin reconciliation (including Item 054 live override data), merge/deploy, and run production regression.

- Item 106 replacement-photo identification on 2026-09-28: owner identified the correct replacement third photo as `IMG_8372` in Volume 2A. The asset is not yet present in the GitHub branch/tree as of this check, so do not replace `IMG_8353.JPG` until the actual `IMG_8372` file (with confirmed extension/path) appears. Once present, replace only the third Item 106 photo and preserve `IMG_7915.JPG` and `IMG_7917.JPG`.

- Item 056 photo update on 2026-09-28: owner supplied three Volume 2A filenames, `IMG_8128`, `PXL_20260913_152523154`, and `IMG_8127`, superseding the earlier expectation of exactly two photos. At the time of the GitHub check none of those assets were yet visible in the branch/tree, so Item 056 remains UNLISTED until the files land and the final price is reconfirmed.

- Item 086 additional-photo identification on 2026-09-28: owner supplied three Volume 2A filenames for the Oster blender: `IMG_8150`, `IMG_8154`, and `IMG_8152`. These are additive to the existing Item 086 photos and must not replace or remove `IMG_7855.JPG`, `PXL_20260927_183702612.jpg`, or `PXL_20260927_185617763.jpg`. At the time of the GitHub check, the three new assets were not yet visible in the branch/tree, so attach them once the actual files appear.

- Workflow discovery on 2026-09-28: adding image files to the owner's local `images/volume-2a` folder does not automatically sync those files to GitHub. The automatic deployment path is GitHub `main` -> Netlify, not local folder -> GitHub. Therefore newly supplied photo filenames may exist locally before they are visible to GitHub-based assistant checks. Future photo batches should be added/committed/pushed together in a single sensible Git sync, then product mappings/listings should be finalized against the confirmed repository filenames/extensions. This affects the currently pending photos for Items 056, 086, 106, and 163.

- Owner workflow clarification on 2026-09-28: for routine, predictable, known-safe terminal/Git workflows, provide the entire sequence at once with expected results. Do not make the owner return to chat to say “continue” after each successful command. Stop only when the next step genuinely depends on inspecting exact output, a conflict/divergence appears, or a destructive/uncertain operation requires confirmation.

- Owner terminal/Git formatting clarification on 2026-09-28: provide the whole safe sequence in one assistant reply, but put every command in its own separate code block so each can be copied with one click. Do not combine routine commands into one block unless the owner explicitly asks for a combined block. Include the expected result after each command. Do not require “continue” between expected successful steps.

- Photo batch integration completed after the 2026-09-28 local-to-GitHub sync:
  - Item 086 now has 6 photos total; existing cover `IMG_7855.JPG` and prior two PXL photos preserved, with additive `IMG_8150.JPG`, `IMG_8154.JPG`, and `IMG_8152.JPG`.
  - Item 106 wrong third photo `IMG_8353.JPG` replaced with owner-confirmed `IMG_8372.jpg`; original `IMG_7915.JPG` and `IMG_7917.JPG` preserved.
  - Item 163 now has its 3 owner-confirmed photos and is no longer UNLISTED/needs-review for missing photos; remains Gs. 70.000 each, quantity 2, delayed pickup.
  - Item 056 now has its 3 owner-confirmed photos attached: `IMG_8128.JPG`, `PXL_20260913_152523154.jpg`, and `IMG_8127.JPG`. Owner subsequently confirmed Gs. 120.000 as the final sale price, so Item 056 is publishable.
  - The image map now contains all 10 newly uploaded Volume 2A assets.

- Item 056 final confirmation on 2026-09-28: owner confirmed the sale price at Gs. 120.000. With its 3 Volume 2A photos already attached, Item 056 is now AVAILABLE/publishable and no longer UNLISTED or needs-review for price/photo readiness.

## 2026-09-28 — Original catalog source/live drift guard

- Trigger: final merchandising production review found Items 019, 020, 045, 047, 052, 054, and 057 still showing stale original-catalog production data even though their owner-approved merchandising changes were already recorded as pending.
- Root cause: original Items 001–057 have two authoring layers. The committed embedded base catalog is deployed from GitHub, while Netlify Blob public-field/image overrides remain higher runtime authority. In addition, several of these seven owner-approved facts had never been written into the committed base catalog, so the workstream had a source gap as well as a live/admin gap.
- Permanent fix in progress on branch `original-catalog-sync-guard-2026-09-28`:
  - correct the committed base catalog for the seven affected original items;
  - preserve Blob override precedence;
  - expose a source-versus-production drift check in the owner admin for Items 001–057, including the mismatched field names;
  - add an admin overview count for source/live drift;
  - establish a permanent two-phase closeout gate: deploy the committed original-catalog source change, then immediately reconcile production/admin data before moving to another workstream or closing; do not defer the live reconciliation to a later production spot check.
- Owner-confirmed intended facts for this correction:
  - Item 019: Gs. 120.000 each, quantity 2.
  - Item 020: Gs. 42.000.
  - Item 045: preserve the two matching chairs and absorb the Item 111 photo `/images/volume-2a/IMG_7926.JPG`.
  - Item 047: title `Repisas macizas`; Gs. 75.000 each; quantity 3; dimensions 100 × 3,7 × 29,3 cm; each shelf includes 3 rear/support metal brackets; black horizontal bar/hooks excluded; no `flotante/flotantes` wording.
  - Item 052: Gs. 42.000.
  - Item 054: Gs. 90.000; delayed pickup December 9–12, 2026; 48 × 38 × 65 cm; remains wrapped in its original protective plastic without calling it new.
  - Item 057: Gs. 60.000 each; quantity 2; delayed pickup December 9–12, 2026; the two units have their own wear and the photos show one unit.
- Runtime production reconciliation for these seven items is still required through the supported `/admin` workflow after this guard/source update is deployed. Do not close the merchandising workstream until that reconciliation and production regression are NOMINAL.

- Follow-up improvement on 2026-09-28: the owner admin now provides a supported one-click `Sincronizar producción con fuente` action for Items 001–057 whenever non-image public fields differ from the committed base catalog. The action updates only the mismatched authoring/public fields through the normal authenticated admin/Blob pathway, preserves internal fields, does not alter operational sold/held quantities, and does not automatically replace photos. This makes stale Blob reconciliation explicit and repeatable instead of requiring manual field-by-field re-entry.

## 2026-09-28 — Product merchandising / sale-readiness closed

- Final owner production verification completed.
- New merchandising items 056, 086, 106, 117, 119, 163, and 168 were confirmed NOMINAL on production.
- The original-catalog production review initially exposed stale source/live divergence for Items 019, 020, 025, 045, 047, 052, 054, and 057 across the committed-source / Blob-override architecture.
- Permanent prevention added:
  - owner admin now detects Items 001–057 whose committed base catalog differs from resolved production and shows `Fuente ≠ producción`;
  - owner admin includes a supported authenticated `Sincronizar producción con fuente` action for non-image public-field drift;
  - original-catalog work now follows a two-phase closeout gate: deploy source, immediately reconcile production/admin, require zero intended source/live drift before moving on or closing.
- Source deployment directly resolved Items 045, 047, 052, 054, and 057.
- Remaining stale production overrides for Items 019, 020, and 025 were reconciled through the supported admin source-sync action.
- Owner confirmed the admin `Fuente ≠ producción` count reached **0**.
- This confirms the resolved production catalog and committed base catalog now agree across the tracked public fields/images for Items 001–057.
- Product merchandising / sale-readiness workstream status: **COMPLETE AND CLOSED**.
- Any future product-to-product navigation work is a separate workstream and must not reopen this merchandising reconciliation unless new specific product-data evidence appears.

## 2026-09-29 — Volume 2 public-copy hygiene completed

- Owner/chat: Volume 2 public-copy hygiene, Items 058–158.
- Files changed: `netlify/functions/_shared/volume2-public.mjs` and `source/lib/volume2-batch.ts`; this coordination entry in `PROJECT_MASTER.md`.
- Result: Audited all 101 Volume 2 source records and all 95 listed products against the live public catalog. Six records were intentionally unlisted. The existing public transform already suppressed the known generic reviewer/photo boilerplate. Broadened its unverified-functionality filter so Item 153 no longer displays `Bomba no verificada`; removed Item 148's speculative candle exclusion and internal confirmation flag after the owner confirmed its only photo shows the holder without a candle. Internal verification notes on other products remain private. No other buyer-facing fields changed.
- Regression performed: JavaScript syntax and `git diff --check`; source/live public-field comparison before deployment; owner confirmation NOMINAL; after merge, live catalog comparison showed exactly two changed fields, the descriptions for Items 148 and 153. Live catalog remained 158 total products with 95 listed Volume 2 products. Item 090's confirmed burner defect remained visible, and no targeted reviewer/TODO phrases remained in listed Volume 2 public fields.
- Commit: Buyer-facing source merged via PR #4 as `3507e65bb4044d3543452e45089cad1fc5b09b8c`; this documentation entry is in the subsequent closeout checkpoint.
- Remaining follow-up: None for this workstream. Blob overrides retain runtime priority; the production comparison found no conflicting Volume 2 public-field overrides for the audited fields.
