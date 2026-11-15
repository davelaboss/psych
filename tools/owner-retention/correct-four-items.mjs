// Operator-only tool; no web endpoint. --plan is read-only, --apply needs separate approval.
import {database} from '../../netlify/functions/_shared/inventory-database.mjs';
import {readOwnerRetentionPlan,validateOwnerRetentionPlan,applyHistoricalOwnerRetention} from '../../netlify/functions/_shared/historical-owner-retention.mjs';
import {RETENTION_ORDER,RETENTION_BATCH,RETENTION_ITEMS} from '../../netlify/functions/_shared/owner-retention-core.mjs';

const args=process.argv.slice(2),value=name=>args.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
const apply=args.includes('--apply');
if(apply&&args.includes('--plan')){console.error('STOP: choose --plan or --apply, never both.');process.exit(2)}
if(apply&&(value('--confirm-order')!==RETENTION_ORDER||!value('--approval')||!/^[a-f0-9]{64}$/.test(value('--expected')||''))){
 console.error('STOP: execution requires separate owner approval, the exact plan fingerprint and --confirm-order='+RETENTION_ORDER);
 process.exit(2);
}
if(args.some(a=>!['--plan','--apply'].includes(a)&&!['--confirm-order=','--approval=','--expected='].some(p=>a.startsWith(p)))){
 console.error('Unknown argument. Default --plan is read-only.');process.exit(2);
}
let db;
try{
 db=database();
 if(apply){
  const result=await applyHistoricalOwnerRetention({expectedFingerprint:value('--expected'),approvalReference:value('--approval'),actor:'OWNER'});
  console.log(JSON.stringify({orderId:RETENTION_ORDER,batchId:RETENTION_BATCH,alreadyApplied:result.alreadyApplied,correction:result.correction},null,2));
 }else{
  const client=await db.pool.connect();
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const plan=await readOwnerRetentionPlan(client),validation=validateOwnerRetentionPlan(plan);
   await client.query('ROLLBACK');
   console.log(JSON.stringify({mode:'READ_ONLY_PLAN',orderId:RETENTION_ORDER,batchId:RETENTION_BATCH,items:RETENTION_ITEMS,
    capturedAt:plan.capturedAt,expectedFingerprint:plan.fingerprint,...validation,
    originalPaymentPYG:95000,originalAdjustmentPYG:95000,actualCashReceivedPYG:0,actualCashRefundedPYG:0,
    requiredNextDecision:'Separate owner approval of the exact fingerprint, code commit and execution procedure. No correction was executed.'},null,2));
  }finally{client.release()}
 }
}catch(error){console.error('STOP: '+error.message);process.exitCode=1}
finally{if(db)await db.pool.end()}
