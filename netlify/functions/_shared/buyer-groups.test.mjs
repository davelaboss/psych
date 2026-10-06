import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBuyerGroupReassignmentAllowed, listBuyerGroups } from './buyer-groups.mjs';

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

test('separate buyer reassignment is blocked when the order has fulfillment membership', async () => {
  const client = { query: async () => ({ rows: [{ exists: 1 }] }) };
  await assert.rejects(() => assertBuyerGroupReassignmentAllowed(client, {
    action: 'SEPARATE',
    orderId: 'ORDER-1',
    previousGroupId: 'group-1',
  }), error => error.status === 409 && error.code === 'FULFILLMENT_BUYER_REASSIGNMENT_BLOCKED');
});

test('merge buyer reassignment protects every order in the source buyer group', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{ exists: 1 }] };
    },
  };
  await assert.rejects(() => assertBuyerGroupReassignmentAllowed(client, {
    action: 'MERGE',
    orderId: 'ORDER-1',
    previousGroupId: 'group-1',
  }), error => error.status === 409 && error.code === 'FULFILLMENT_BUYER_REASSIGNMENT_BLOCKED');
  assert.match(queries[0].sql, /JOIN buyer_group_orders/);
  assert.deepEqual(queries[0].params, ['group-1']);
});

test('buyer reassignment remains available when no fulfillment membership exists', async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.doesNotReject(() => assertBuyerGroupReassignmentAllowed(client, {
    action: 'SEPARATE',
    orderId: 'ORDER-1',
    previousGroupId: 'group-1',
  }));
});
