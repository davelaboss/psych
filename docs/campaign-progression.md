# Regular campaign progression and deferral

Normal `prepare` / COPIAR PARA CHATGPT remains an idempotent retry of a compatible
pending batch. It never reshuffles an exported package, marks preparation as
publication, or resets coverage. Pending assignments reserve their products even
when price, stock or pickup mode temporarily makes them unsuitable for a handoff.
Legacy assignments stay visible for reconciliation and truthful late confirmation.

Sale Pulse GET now reports current priority eligibility (strictly over Gs. 50,000,
MARKETABLE and purchasable), pickup lane counts, confirmed coverage, eligible
pending/withdrawn/deferred counts, unassigned inventory and the next batch's lane
capacities. `PENDING_WITH_FRESH_INVENTORY` identifies a progression opportunity;
`PENDING_ONLY` identifies no fresh inventory, not a stale-batch diagnosis.
`confirmedPosted` covers the whole priority pass; `eligiblePosted` is its overlap
with today's eligible inventory. Superseded and deferred items never count as
POSTED. All counts describe a dated snapshot, not a reservation.

When fresh unassigned inventory exists, Admin offers PREPARAR SIGUIENTE LOTE.
The authenticated `advance` request supplies the campaign/cycle, latest batch ID,
expected ledger revision and an explicit reason. The server revalidates current
Sale Pulse and allocates up to five per seller: David DELAYED first then IMMEDIATE,
María IMMEDIATE only, descending current price and stable Item tie-breaks. It
excludes confirmed, withdrawn, deferred and all still-active pending product IDs.
An append-only advancement record links the new batch to its predecessor. Earlier
pending assignments remain in Admin and can be confirmed later; no automatic
deferral, expiry, rollover, repost or silent removal occurs.

Advancement requires an established cycle. Revision/ETag conflicts fail closed and
require a fresh review; repeated stale advancement requests cannot allocate a second
batch. Normal copy retries reuse the resulting batch. If fresh unassigned inventory
is exhausted, no new batch is created. Previously posted products require a separate
repeat-promotion decision; they are never made fresh by deleting or resetting history.

## Separately approved operator deferral

`deferCampaignAssignments` is an operator-only function, without an HTTP action or
automatic caller. A reviewed operation must contain exactly: `campaignId`, `cycleId`,
`expectedRevision`, `expectedEtag`, unique operation `id`, `batchId`, `person`, exact
`productIds` (one to five), `reason`, and `approvalReference`. Obtain a fresh read-only
ledger/baseline snapshot first. Review all targets and obtain separate Governance
approval before invoking the function with the production store. Never substitute
the normal preparation action for this approval. Test an operation against an
isolated store before applying it.

Deferral appends a timestamped GOVERNANCE_OPERATOR audit event, preserves every
assignment, baseline, previous event and POSTED timestamp, and excludes the products
for this priority pass. It is not publication and does not release them into fresh
selection. A future reactivation would need a separately reviewed implementation;
do not remove deferral events. The same operation is idempotent. A conflicting ID,
stale revision/ETag, already posted target, or unverifiable write is rejected.

Truthful earlier publications can still be recorded through authenticated `confirm`.
Optional `publishedAt` must be between batch preparation and the current time. For
a deferred assignment it must be explicitly supplied and no later than deferral.
This records a legitimate earlier event without erasing deferral evidence. Repeated
confirmations never change an existing timestamp. Superseded assignments retain
their existing prohibition on confirmation.

## Storage and release boundary

Advancement or deferral upgrades only the campaign ledger to schema 3; existing v1
and v2 remain readable. All writes retain conditional ETags and verified readback,
including newer concurrent confirmations and append-only events. The immutable
cycle anchor and historical completeness remain unchanged. Old readers reject v3;
after the first v3 write, rollback must use a v3-capable reader. Never downgrade or
restore an old ledger to roll back code.

No code here changes inventory, prices, holds, orders, payment terms, Marketplace
history, seller files, publishing locks or advertisements. Merge/deploy and any
production ledger operation require the corresponding Governance release approval.
The November 4 original package remains historical evidence; any replacement is a
separate reviewed artifact and must not be delivered over it automatically.
