// One separately approved historical case, not a general inventory/payment exception.
export const RETENTION_ORDER='VM-2026-514DA2AA';
export const RETENTION_BATCH='0d646d9f-80ae-4db5-acd6-bce66eca410a';
export const RETENTION_CORRECTION='owner-retention-VM-2026-514DA2AA-v1';
export const RETENTION_KIND='NO_CASH_OWNER_RETENTION';
export const RETENTION_ITEMS=Object.freeze([
 {productId:'real-20260828-43',itemNumber:43,quantity:1},
 {productId:'real-202610-volume4-411',itemNumber:411,quantity:1},
 {productId:'real-202610-volume4-432',itemNumber:432,quantity:1},
 {productId:'real-202610-volume4-466',itemNumber:466,quantity:1},
].map(Object.freeze));
export const RETENTION_SIBLING_ORDER='VM-2026-497D5F3F';
export const CLOSED_OWNER_RETENTION='CLOSED_OWNER_WITHDRAWAL';
export function isOwnerRetainedOrder(order){
 const marker=order?.ownerRetention;
 return order?.id===RETENTION_ORDER && marker?.kind===RETENTION_KIND && marker?.correctionId===RETENTION_CORRECTION;
}
export function ownerRetentionProduct(product,inventory){
 const retained=Number(inventory?.owner_retained_quantity||0);
 if(!retained)return product;
 const customerCommitted=Math.max(0,Number(inventory.committed_quantity)-retained);
 return {...product,quantityOwnerRetained:retained,
   quantitySold:Math.max(0,Number(product.quantitySold||0)-retained),
   status:customerCommitted===0&&Number(product.quantityRemaining)===0?'UNLISTED':product.status};
}
