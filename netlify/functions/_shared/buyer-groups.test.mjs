import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBuyerGroupReassignmentAllowed,
  listBuyerGroups,
  reconcileBuyerGroupMerge,
  reconcileBuyerGroupSeparation,
} from './buyer-groups.mjs';

test('buyer group listing tolerates every malformed snapshot fixture', async () => {
  const snapshots = [
    undefined,
    null,
    {},
    { items: null },
    { items: {} },
    { items: 'scalar' },
    { items: 7 },
    { items: [] },
    { buyer: { name: 'Available identity', phone: '123' }, status: 'CONFIRMED', items: [null, 'bad', 7,
      { productId: 'valid', title: 'Valid item', quantity: 1 },
    ] },
  ];
  const rows = snapshots.map((snapshot, index) => ({
    buyer_group_id: 'group-1',
    display_name: 'Persisted buyer',
    display_phone: '123',
    group_created_at: '2026-10-06T10:00:00.000Z',
    assignment_mode: 'AUTO_NEW',
    auto_match_blocked: false,
    order_id: `ORDER-${index}`,
    committed_at: '2026-10-06T11:00:00.000Z',
    order_snapshot: snapshot,
    order_created_at: '2026-10-06T10:30:00.000Z',
  }));
  const groups = await listBuyerGroups({
    transaction: async () => {},
    query: async () => ({ rows }),
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].displayName, 'Persisted buyer');
  assert.equal(groups[0].orders.length, snapshots.length);
  assert.equal(groups[0].confirmedItems.length, 1);
  assert.equal(groups[0].orders.at(-1).buyer.name, 'Available identity');
});

const sourceGroupId = '11111111-1111-4111-8111-111111111111';
const targetGroupId = '22222222-2222-4222-8222-222222222222';
const sourceImmediateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceDelayedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const targetImmediateId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const openBatch = (fulfillmentBatchId, buyerGroupId, timingKey, overrides = {}) => ({
  fulfillment_batch_id: fulfillmentBatchId,
  buyer_group_id: buyerGroupId,
  timing_key: timingKey,
  status: 'OPEN',
  auto_attach: true,
  revision: 1,
  merged_into_batch_id: null,
  ...overrides,
});

test('manual buyer merge reconciles compatible OPEN batches without mixing timing keys', async () => {
  const batches = new Map([
    [sourceImmediateId, openBatch(sourceImmediateId, sourceGroupId, 'IMMEDIATE')],
    [sourceDelayedId, openBatch(sourceDelayedId, sourceGroupId, 'DELAYED:2026-12-09:2026-12-12')],
    [targetImmediateId, openBatch(targetImmediateId, targetGroupId, 'IMMEDIATE')],
  ]);
  const items = [
    { order_id: 'ORDER-1', product_id: '381', fulfillment_batch_id: sourceImmediateId },
    { order_id: 'ORDER-1', product_id: '474', fulfillment_batch_id: sourceDelayedId },
    { order_id: 'ORDER-2', product_id: '449', fulfillment_batch_id: targetImmediateId },
  ];
  const events = [];
  const client = {
    async query(sql, params = []) {
      if (sql.includes('SELECT * FROM fulfillment_batches') && sql.includes('WHERE buyer_group_id=$1')) {
        return { rows: [...batches.values()].filter(batch => batch.buyer_group_id === params[0]) };
      }
      if (sql.includes('SELECT order_id,product_id,fulfillment_batch_id') &&
          sql.includes('WHERE fulfillment_batch_id=$1')) {
        return { rows: items.filter(item => item.fulfillment_batch_id === params[0]) };
      }
      if (sql.includes("SET fulfillment_batch_id=$2,assignment_mode='MANUAL_COMBINE'")) {
        for (const item of items) {
          if (item.fulfillment_batch_id === params[0]) item.fulfillment_batch_id = params[1];
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("SET assignment_mode='MANUAL_COMBINE'")) return { rows: [], rowCount: 1 };
      if (sql.includes('auto_attach=false,merged_into_batch_id=$3')) {
        const batch = batches.get(params[0]);
        Object.assign(batch, { buyer_group_id: params[1], auto_attach: false,
          merged_into_batch_id: params[2], revision: batch.revision + 1 });
        return { rows: [batch] };
      }
      if (/UPDATE fulfillment_batches SET\s+revision=revision\+1/.test(sql)) {
        const batch = batches.get(params[0]);
        batch.revision += 1;
        return { rows: [batch] };
      }
      if (sql.includes('buyer_group_id=$2,revision=revision+1')) {
        const batch = batches.get(params[0]);
        Object.assign(batch, { buyer_group_id: params[1], revision: batch.revision + 1 });
        return { rows: [batch] };
      }
      if (sql.includes('INSERT INTO fulfillment_batch_events')) {
        events.push({ type: params[0], items: JSON.parse(params[4]),
          revisions: JSON.parse(params[5]), context: JSON.parse(params[6]) });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const changed = await reconcileBuyerGroupMerge(client, {
    sourceGroupId,
    targetGroupId,
    sourceBatches: [batches.get(sourceImmediateId), batches.get(sourceDelayedId)],
  });

  assert.deepEqual(new Set(changed), new Set([sourceImmediateId, sourceDelayedId, targetImmediateId]));
  assert.equal(batches.get(sourceImmediateId).merged_into_batch_id, targetImmediateId);
  assert.equal(items.find(item => item.product_id === '381').fulfillment_batch_id, targetImmediateId);
  assert.equal(batches.get(sourceDelayedId).buyer_group_id, targetGroupId);
  assert.equal(batches.get(sourceDelayedId).timing_key, 'DELAYED:2026-12-09:2026-12-12');
  assert.equal(items.find(item => item.product_id === '474').fulfillment_batch_id, sourceDelayedId);
  const eligible = [...batches.values()].filter(batch => batch.buyer_group_id === targetGroupId &&
    batch.status === 'OPEN' && batch.auto_attach && !batch.merged_into_batch_id);
  assert.deepEqual(eligible.map(batch => batch.timing_key).sort(),
    ['DELAYED:2026-12-09:2026-12-12', 'IMMEDIATE']);
  assert.equal(new Set(eligible.map(batch => batch.timing_key)).size, eligible.length);
  assert.deepEqual(events.map(event => event.context.reason).sort(),
    ['BUYER_GROUP_MERGE', 'BUYER_GROUP_REHOME']);
  assert.deepEqual(events.map(event => event.type), ['COMBINE', 'COMBINE']);
  assert.equal(batches.get(sourceImmediateId).revision, 2);
  assert.equal(batches.get(sourceDelayedId).revision, 2);
  assert.equal(batches.get(targetImmediateId).revision, 2);
});

test('manual buyer separation moves only one order into new OPEN timing-specific batches', async () => {
  const batches = new Map([
    [sourceImmediateId, openBatch(sourceImmediateId, sourceGroupId, 'IMMEDIATE', { revision: 3 })],
    [sourceDelayedId, openBatch(sourceDelayedId, sourceGroupId,
      'DELAYED:2026-12-09:2026-12-12', { revision: 2 })],
  ]);
  const items = [
    { order_id: 'ORDER-1', product_id: '381', fulfillment_batch_id: sourceImmediateId },
    { order_id: 'ORDER-2', product_id: '449', fulfillment_batch_id: sourceImmediateId },
    { order_id: 'ORDER-1', product_id: '474', fulfillment_batch_id: sourceDelayedId },
  ];
  const events = [];
  const client = {
    async query(sql, params = []) {
      if (sql.includes('SELECT order_id,product_id,fulfillment_batch_id') && sql.includes('WHERE order_id=$1')) {
        return { rows: items.filter(item => item.order_id === params[0] && params[1].includes(item.fulfillment_batch_id)) };
      }
      if (sql.includes('INSERT INTO fulfillment_batches')) {
        batches.set(params[0], openBatch(params[0], params[1], params[2]));
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("assignment_mode='MANUAL_SEPARATE'")) {
        for (const item of items) {
          if (item.order_id === params[0] && params[2].includes(item.fulfillment_batch_id)) {
            item.fulfillment_batch_id = params[1];
          }
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('WHERE fulfillment_batch_id=ANY($1::uuid[])') && sql.includes('RETURNING')) {
        const rows = params[0].map(batchId => {
          const batch = batches.get(batchId);
          batch.revision += 1;
          return { fulfillment_batch_id: batchId, revision: batch.revision };
        });
        return { rows };
      }
      if (sql.includes('INSERT INTO fulfillment_batch_events')) {
        events.push({ items: JSON.parse(params[4]), revisions: JSON.parse(params[5]),
          context: JSON.parse(params[6]) });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const ids = [
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  ];
  await reconcileBuyerGroupSeparation(client, {
    orderId: 'ORDER-1',
    sourceGroupId,
    targetGroupId,
    sourceBatches: [batches.get(sourceImmediateId), batches.get(sourceDelayedId)],
    createId: () => ids.shift(),
  });

  const separatedItems = items.filter(item => item.order_id === 'ORDER-1');
  assert.ok(separatedItems.every(item => batches.get(item.fulfillment_batch_id).buyer_group_id === targetGroupId));
  assert.deepEqual(separatedItems.map(item => batches.get(item.fulfillment_batch_id).timing_key).sort(),
    ['DELAYED:2026-12-09:2026-12-12', 'IMMEDIATE']);
  assert.equal(items.find(item => item.order_id === 'ORDER-2').fulfillment_batch_id, sourceImmediateId);
  assert.equal(batches.get(sourceImmediateId).revision, 4);
  assert.equal(batches.get(sourceDelayedId).revision, 3);
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.context.reason === 'BUYER_GROUP_SEPARATE'));
  assert.ok(events.every(event => event.revisions.targetAfter === 1));
});

for (const status of ['PREPARED', 'DELIVERED', 'LEGACY_FROZEN']) {
  for (const action of ['MERGE', 'SEPARATE']) {
    test(`${status} fulfillment remains protected from buyer ${action.toLowerCase()}`, async () => {
      const client = { query: async () => ({ rows: [openBatch(sourceImmediateId, sourceGroupId,
        'IMMEDIATE', { status, auto_attach: false })] }) };
      await assert.rejects(() => assertBuyerGroupReassignmentAllowed(client, {
        action,
        orderId: 'ORDER-1',
        previousGroupId: sourceGroupId,
      }), error => error.status === 409 &&
        error.code === 'FULFILLMENT_BUYER_REASSIGNMENT_BLOCKED' &&
        /Solo las planillas abiertas/.test(error.message));
    });
  }
}

test('OPEN fulfillment remains eligible for transactional buyer regrouping', async () => {
  const rows = [openBatch(sourceImmediateId, sourceGroupId, 'IMMEDIATE')];
  const client = { query: async () => ({ rows }) };
  assert.deepEqual(await assertBuyerGroupReassignmentAllowed(client, {
    action: 'MERGE',
    orderId: 'ORDER-1',
    previousGroupId: sourceGroupId,
  }), rows);
});
