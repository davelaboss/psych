import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    itemNumber: integer('item_number'),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    tagsJson: text('tags_json').notNull(),
    description: text('description').notNull(),
    condition: text('condition').notNull(),
    conditionNotes: text('condition_notes').notNull(),
    knownDefects: text('known_defects').notNull(),
    imagesJson: text('images_json').notNull(),
    askingPricePYG: integer('asking_price_pyg').notNull(),
    originalPricePYG: integer('original_price_pyg'),
    saleMode: text('sale_mode').notNull(),
    pickupAvailableDate: text('pickup_available_date'),
    pickupWindowStart: text('pickup_window_start'),
    pickupWindowEnd: text('pickup_window_end'),
    depositPercent: integer('deposit_percent').notNull(),
    requiresVehicle: integer('requires_vehicle', { mode: 'boolean' }).notNull(),
    requiresLoadingHelp: integer('requires_loading_help', { mode: 'boolean' }).notNull(),
    logisticsNotesJson: text('logistics_notes_json').notNull(),
    includedAccessoriesJson: text('included_accessories_json').notNull().default('[]'),
    sellerConfirmedFieldsJson: text('seller_confirmed_fields_json').notNull().default('[]'),
    status: text('status').notNull(),
    featured: integer('featured', { mode: 'boolean' }).notNull(),
    dateListed: text('date_listed').notNull(),
    lastPriceChange: text('last_price_change'),
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull(),
    adminPriceFloorPYG: integer('admin_price_floor_pyg'),
    marketEstimatePYG: integer('market_estimate_pyg'),
    recommendedFastSalePricePYG: integer('recommended_fast_sale_price_pyg'),
    pricingConfidence: text('pricing_confidence'),
    pricingResearch: text('pricing_research'),
    internalNotes: text('internal_notes'),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
    holdToken: text('hold_token'),
    holdExpiresAt: integer('hold_expires_at'),
    quantityTotal: integer('quantity_total').notNull().default(1),
    quantityRemaining: integer('quantity_remaining').notNull().default(1),
    quantityHeld: integer('quantity_held').notNull().default(0),
    quantitySold: integer('quantity_sold').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_products_slug').on(table.slug),
    uniqueIndex('idx_products_item_number').on(table.itemNumber),
    index('idx_products_public_status').on(table.status, table.category),
    index('idx_products_hold_expiry').on(table.status, table.holdExpiresAt),
  ],
);

export const inventorySnapshots = sqliteTable(
  'inventory_snapshots',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    payloadJson: text('payload_json').notNull(),
    productCount: integer('product_count').notNull(),
    imageCount: integer('image_count').notNull(),
    createdByEmail: text('created_by_email').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_inventory_snapshots_label').on(table.label)],
);

export const inventoryAudit = sqliteTable(
  'inventory_audit',
  {
    id: text('id').primaryKey(),
    productId: text('product_id').notNull(),
    itemNumber: integer('item_number'),
    fieldName: text('field_name').notNull(),
    previousValueJson: text('previous_value_json'),
    newValueJson: text('new_value_json'),
    actorRole: text('actor_role').notNull(),
    actorEmail: text('actor_email').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_inventory_audit_product_created').on(table.productId, table.createdAt)],
);

export const inventoryMeta = sqliteTable('inventory_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const reviewerAccounts = sqliteTable('reviewer_accounts', {
  userId: text('user_id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull().default('REVIEWER'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  invitedByEmail: text('invited_by_email').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const reviewerInvites = sqliteTable(
  'reviewer_invites',
  {
    id: text('id').primaryKey(),
    codeHash: text('code_hash').notNull(),
    createdByEmail: text('created_by_email').notNull(),
    expiresAt: integer('expires_at').notNull(),
    redeemedAt: integer('redeemed_at'),
    redeemedByUserId: text('redeemed_by_user_id'),
    redeemedByEmail: text('redeemed_by_email'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_reviewer_invites_code_hash').on(table.codeHash),
    index('idx_reviewer_invites_active').on(table.expiresAt, table.redeemedAt, table.revokedAt),
  ],
);

export const reviewerAccessCodes = sqliteTable(
  'reviewer_access_codes',
  {
    id: text('id').primaryKey(),
    codeHash: text('code_hash').notNull(),
    createdByEmail: text('created_by_email').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
    consumedSessionId: text('consumed_session_id'),
    invalidatedAt: integer('invalidated_at'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_reviewer_access_codes_hash').on(table.codeHash),
    index('idx_reviewer_access_codes_active').on(table.expiresAt, table.consumedAt, table.invalidatedAt),
  ],
);

export const reviewerSessions = sqliteTable(
  'reviewer_sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    displayName: text('display_name').notNull().default('María'),
    createdFromCodeId: text('created_from_code_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (table) => [
    uniqueIndex('idx_reviewer_sessions_token_hash').on(table.tokenHash),
    index('idx_reviewer_sessions_active').on(table.expiresAt, table.revokedAt),
  ],
);

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    reference: text('reference').notNull(),
    holdToken: text('hold_token').notNull(),
    orderSource: text('order_source').notNull().default('ONLINE'),
    status: text('status').notNull(),
    buyerName: text('buyer_name'),
    buyerWhatsapp: text('buyer_whatsapp'),
    buyerEmail: text('buyer_email'),
    pickupAcknowledged: integer('pickup_acknowledged', { mode: 'boolean' }).notNull(),
    delayedPickupAcknowledged: integer('delayed_pickup_acknowledged', { mode: 'boolean' }).notNull(),
    depositTermsAcknowledged: integer('deposit_terms_acknowledged', { mode: 'boolean' }).notNull(),
    totalValuePYG: integer('total_value_pyg').notNull(),
    dueNowPYG: integer('due_now_pyg').notNull(),
    balanceLaterPYG: integer('balance_later_pyg').notNull(),
    balanceRemainingPYG: integer('balance_remaining_pyg').notNull().default(0),
    confirmedAmountPYG: integer('confirmed_amount_pyg').notNull().default(0),
    balanceConfirmedAmountPYG: integer('balance_confirmed_amount_pyg').notNull().default(0),
    paymentMethod: text('payment_method'),
    balancePaymentMethod: text('balance_payment_method'),
    holdExpiresAt: integer('hold_expires_at'),
    transferDeclaredAt: integer('transfer_declared_at'),
    paymentConfirmedAt: integer('payment_confirmed_at'),
    balanceConfirmedAt: integer('balance_confirmed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_orders_reference').on(table.reference),
    uniqueIndex('idx_orders_hold_token').on(table.holdToken),
    index('idx_orders_status_created').on(table.status, table.createdAt),
  ],
);

export const orderPayments = sqliteTable(
  'order_payments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull(),
    paymentType: text('payment_type').notNull(),
    amountPYG: integer('amount_pyg').notNull(),
    method: text('method').notNull(),
    receivedAt: integer('received_at').notNull(),
    actorRole: text('actor_role').notNull(),
    actorEmail: text('actor_email').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_order_payments_order_id').on(table.orderId)],
);

export const orderAudit = sqliteTable(
  'order_audit',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull(),
    orderReference: text('order_reference').notNull(),
    eventType: text('event_type').notNull(),
    detailsJson: text('details_json').notNull(),
    actorRole: text('actor_role').notNull(),
    actorEmail: text('actor_email').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_order_audit_order_created').on(table.orderId, table.createdAt)],
);

export const orderItems = sqliteTable(
  'order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull(),
    productId: text('product_id').notNull(),
    itemNumber: integer('item_number'),
    productSlug: text('product_slug').notNull(),
    titleSnapshot: text('title_snapshot').notNull(),
    imageSnapshot: text('image_snapshot').notNull(),
    pricePYG: integer('price_pyg').notNull(),
    dueNowPYG: integer('due_now_pyg').notNull(),
    balanceLaterPYG: integer('balance_later_pyg').notNull(),
    saleMode: text('sale_mode').notNull(),
    depositPercent: integer('deposit_percent').notNull(),
    pickupAvailableDate: text('pickup_available_date'),
    pickupWindowStart: text('pickup_window_start'),
    pickupWindowEnd: text('pickup_window_end'),
    itemStatus: text('item_status').notNull(),
    quantity: integer('quantity').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_order_items_order_id').on(table.orderId),
    index('idx_order_items_product_id').on(table.productId),
  ],
);
