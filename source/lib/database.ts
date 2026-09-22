import { env } from 'cloudflare:workers';
import { PUBLIC_CONFIG } from './config';
import { SAMPLE_PRODUCTS } from './sample-products';
import { PHASE2_BATCH_ID, PHASE2_BATCH_ITEMS, PHASE2_BATCH_NAME } from './phase2-batch';
import { VOLUME2_BATCH_ID, VOLUME2_BATCH_ITEMS, VOLUME2_BATCH_NAME, type Volume2BatchItem } from './volume2-batch';
import type { AdminProduct, InventoryAuditEntry, InventorySnapshotSummary, InventoryStatus, OrderAuditEntry, OrderItem, OrderSummary, PublicProduct, SaleMode } from './types';
import type { AdminRole } from './admin-auth';
import { dueNowForProduct } from './types';
import { realStorefrontEnabled } from './launch';
import { productChangeHasDifference, semanticProductChangeValue, storedProductChangeValue } from './product-change-normalization';

type Row = Record<string, string | number | null>;
type Database = D1Database;

function database(): Database {
  const db = (env as unknown as { DB?: Database }).DB;
  if (!db) throw new Error('La base de datos del sitio no está disponible.');
  return db;
}

export async function ensureDatabase(): Promise<Database> {
  // D1 work is request-scoped in production. Never cache an in-flight D1
  // initialization promise at module scope: a canceled request can leave that
  // promise pending and stall every later request handled by the same isolate.
  // The production database is already provisioned, so normal requests should
  // only use the existing binding and must not run schema or inventory writes.
  const db = database();
  await ensureOrderWorkflowSchema(db);
  await ensureItem55DuplicateCleanup(db);
  await ensureItem57LightGrayFoldingTables(db);
  await ensureChairResearchCorrections(db);
  await ensureItem40MopCorrection(db);
  await ensureItem46MaterialCorrection(db);
  await ensureVolume2Batch(db);
  return db;
}

async function ensureItem55DuplicateCleanup(db: Database): Promise<void> {
  const revision = 'item-55-duplicate-removed-2026-09-21-v1';
  const metaKey = 'item_55_duplicate_cleanup_revision';
  const applied = await db.prepare('SELECT value FROM inventory_meta WHERE key = ?').bind(metaKey).first<{ value: string }>();
  if (applied?.value === revision) return;

  const now = Date.now();
  const duplicate = await db.prepare('SELECT id, item_number FROM products WHERE id = ? OR item_number = 55')
    .bind('real-20260912-55').first<Row>();
  const item45 = await db.prepare('SELECT id, item_number, quantity_total, quantity_remaining FROM products WHERE id = ? OR item_number = 45')
    .bind('real-20260828-45').first<Row>();
  const statements: D1PreparedStatement[] = [];

  if (duplicate) {
    statements.push(
      db.prepare('DELETE FROM product_images WHERE product_id = ?').bind(String(duplicate.id)),
      db.prepare('DELETE FROM inventory_audit WHERE product_id = ?').bind(String(duplicate.id)),
      db.prepare('DELETE FROM products WHERE id = ?').bind(String(duplicate.id)),
    );
  }

  if (item45 && Number(item45.quantity_total ?? 1) < 2) {
    statements.push(
      db.prepare('UPDATE products SET quantity_total = 2, quantity_remaining = 2, updated_at = ? WHERE id = ?')
        .bind(now, String(item45.id)),
      db.prepare(`INSERT INTO inventory_audit
        (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
        VALUES (?, ?, 45, 'quantityTotal', ?, ?, 'OWNER', 'system:item-55-duplicate-cleanup', ?)`)
        .bind(crypto.randomUUID(), String(item45.id), JSON.stringify(Number(item45.quantity_total ?? 1)), JSON.stringify(2), now),
      db.prepare(`INSERT INTO inventory_audit
        (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
        VALUES (?, ?, 45, 'quantityRemaining', ?, ?, 'OWNER', 'system:item-55-duplicate-cleanup', ?)`)
        .bind(crypto.randomUUID(), String(item45.id), JSON.stringify(Number(item45.quantity_remaining ?? 1)), JSON.stringify(2), now),
    );
  }

  statements.push(db.prepare(`INSERT INTO inventory_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(metaKey, revision, now));
  await db.batch(statements);
}

async function initialize(db: Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      item_number INTEGER,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      description TEXT NOT NULL,
      condition TEXT NOT NULL,
      condition_notes TEXT NOT NULL,
      known_defects TEXT NOT NULL,
      images_json TEXT NOT NULL,
      asking_price_pyg INTEGER NOT NULL,
      original_price_pyg INTEGER,
      sale_mode TEXT NOT NULL,
      pickup_available_date TEXT,
      pickup_window_start TEXT,
      pickup_window_end TEXT,
      deposit_percent INTEGER NOT NULL,
      requires_vehicle INTEGER NOT NULL DEFAULT 0,
      requires_loading_help INTEGER NOT NULL DEFAULT 0,
      logistics_notes_json TEXT NOT NULL,
      included_accessories_json TEXT NOT NULL DEFAULT '[]',
      seller_confirmed_fields_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0,
      date_listed TEXT NOT NULL,
      last_price_change TEXT,
      needs_review INTEGER NOT NULL DEFAULT 0,
      admin_price_floor_pyg INTEGER,
      market_estimate_pyg INTEGER,
      recommended_fast_sale_price_pyg INTEGER,
      pricing_confidence TEXT,
      pricing_research TEXT,
      internal_notes TEXT,
      is_demo INTEGER NOT NULL DEFAULT 1,
      hold_token TEXT,
      hold_expires_at INTEGER,
      quantity_total INTEGER NOT NULL DEFAULT 1,
      quantity_remaining INTEGER NOT NULL DEFAULT 1,
      quantity_held INTEGER NOT NULL DEFAULT 0,
      quantity_sold INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      hold_token TEXT NOT NULL UNIQUE,
      order_source TEXT NOT NULL DEFAULT 'ONLINE',
      status TEXT NOT NULL,
      buyer_name TEXT,
      buyer_whatsapp TEXT,
      buyer_email TEXT,
      pickup_acknowledged INTEGER NOT NULL DEFAULT 0,
      delayed_pickup_acknowledged INTEGER NOT NULL DEFAULT 0,
      deposit_terms_acknowledged INTEGER NOT NULL DEFAULT 0,
      total_value_pyg INTEGER NOT NULL,
      due_now_pyg INTEGER NOT NULL,
      balance_later_pyg INTEGER NOT NULL,
      balance_remaining_pyg INTEGER NOT NULL DEFAULT 0,
      confirmed_amount_pyg INTEGER NOT NULL DEFAULT 0,
      balance_confirmed_amount_pyg INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT,
      balance_payment_method TEXT,
      hold_expires_at INTEGER,
      transfer_declared_at INTEGER,
      payment_confirmed_at INTEGER,
      balance_confirmed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      item_number INTEGER,
      product_slug TEXT NOT NULL,
      title_snapshot TEXT NOT NULL,
      image_snapshot TEXT NOT NULL,
      price_pyg INTEGER NOT NULL,
      due_now_pyg INTEGER NOT NULL,
      balance_later_pyg INTEGER NOT NULL,
      sale_mode TEXT NOT NULL,
      deposit_percent INTEGER NOT NULL,
      pickup_available_date TEXT,
      pickup_window_start TEXT,
      pickup_window_end TEXT,
      item_status TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS product_images (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      original_filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      privacy_status TEXT NOT NULL DEFAULT 'CLEARED',
      created_at INTEGER NOT NULL,
      UNIQUE(product_id, sort_order),
      FOREIGN KEY(product_id) REFERENCES products(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_snapshots (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      product_count INTEGER NOT NULL,
      image_count INTEGER NOT NULL,
      created_by_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_audit (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      item_number INTEGER,
      field_name TEXT NOT NULL,
      previous_value_json TEXT,
      new_value_json TEXT,
      actor_role TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      payment_type TEXT NOT NULL,
      amount_pyg INTEGER NOT NULL,
      method TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      actor_role TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_audit (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      order_reference TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_products_public_status ON products(status, category)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_products_hold_expiry ON products(status, hold_expires_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON order_payments(order_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_order_audit_order_created ON order_audit(order_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id, sort_order)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_inventory_audit_product_created ON inventory_audit(product_id, created_at DESC)'),
  ]);

  await ensureColumn(db, 'products', 'item_number', 'INTEGER');
  await ensureColumn(db, 'products', 'pickup_window_start', 'TEXT');
  await ensureColumn(db, 'products', 'pickup_window_end', 'TEXT');
  await ensureColumn(db, 'products', 'included_accessories_json', "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn(db, 'products', 'seller_confirmed_fields_json', "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn(db, 'products', 'quantity_total', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'products', 'quantity_remaining', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'products', 'quantity_held', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'products', 'quantity_sold', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'order_items', 'item_number', 'INTEGER');
  await ensureColumn(db, 'order_items', 'pickup_window_start', 'TEXT');
  await ensureColumn(db, 'order_items', 'pickup_window_end', 'TEXT');
  await ensureColumn(db, 'order_items', 'quantity', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'orders', 'order_source', "TEXT NOT NULL DEFAULT 'ONLINE'");
  await ensureColumn(db, 'orders', 'balance_remaining_pyg', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'orders', 'confirmed_amount_pyg', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'orders', 'balance_confirmed_amount_pyg', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'orders', 'payment_method', 'TEXT');
  await ensureColumn(db, 'orders', 'balance_payment_method', 'TEXT');
  await applySellerCorrections(db);
  await ensureItem55DuplicateCleanup(db);
  await ensureTpLinkMediaConverter(db);
  await ensureItem31QuantityCorrection(db);
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_item_number
    ON products(item_number) WHERE item_number IS NOT NULL`).run();

  const count = await db.prepare('SELECT COUNT(*) AS total FROM products').first<{ total: number }>();
  if (!count?.total) await seedProducts(db);
  await db.prepare('PRAGMA optimize').run();
}

async function ensureColumn(db: Database, table: 'products' | 'order_items' | 'orders', column: string, definition: string): Promise<void> {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (!info.results.some((row) => row.name === column)) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

async function ensureOrderWorkflowSchema(db: Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS order_payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      payment_type TEXT NOT NULL,
      amount_pyg INTEGER NOT NULL,
      method TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      actor_role TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_audit (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      order_reference TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON order_payments(order_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_order_audit_order_created ON order_audit(order_id, created_at DESC)'),
  ]);
  await ensureColumn(db, 'orders', 'order_source', "TEXT NOT NULL DEFAULT 'ONLINE'");
  await ensureColumn(db, 'orders', 'balance_remaining_pyg', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'orders', 'confirmed_amount_pyg', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'orders', 'balance_confirmed_amount_pyg', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'orders', 'payment_method', 'TEXT');
  await ensureColumn(db, 'orders', 'balance_payment_method', 'TEXT');
  await db.prepare(`UPDATE orders SET balance_remaining_pyg = balance_later_pyg
    WHERE balance_remaining_pyg = 0 AND balance_later_pyg > 0
      AND status IN ('TEMPORARY_HOLD', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED')`).run();
}

const PRODUCT_INSERT_SQL = `INSERT INTO products (
  id, item_number, slug, title, category, tags_json, description, condition, condition_notes, known_defects,
  images_json, asking_price_pyg, original_price_pyg, sale_mode, pickup_available_date, pickup_window_start,
  pickup_window_end, deposit_percent, requires_vehicle, requires_loading_help, logistics_notes_json,
  included_accessories_json, seller_confirmed_fields_json, status, featured,
  date_listed, last_price_change, needs_review, admin_price_floor_pyg, market_estimate_pyg,
  recommended_fast_sale_price_pyg, pricing_confidence, pricing_research, internal_notes, is_demo,
  hold_token, hold_expires_at, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function productInsert(db: Database, product: AdminProduct, now = Date.now()): D1PreparedStatement {
  return db.prepare(PRODUCT_INSERT_SQL).bind(
    product.id, product.itemNumber, product.slug, product.title, product.category, JSON.stringify(product.tags),
    product.description, product.condition, product.conditionNotes, product.knownDefects,
    JSON.stringify(product.images), product.askingPricePYG, product.originalPricePYG,
    product.saleMode, product.pickupAvailableDate, product.pickupWindowStart, product.pickupWindowEnd, product.depositPercent,
    product.requiresVehicle ? 1 : 0, product.requiresLoadingHelp ? 1 : 0,
    JSON.stringify(product.logisticsNotes), JSON.stringify(product.includedAccessories), JSON.stringify(product.sellerConfirmedFields ?? []), product.status, product.featured ? 1 : 0,
    product.dateListed, product.lastPriceChange, product.needsReview ? 1 : 0,
    product.adminPriceFloorPYG, product.marketEstimatePYG, product.recommendedFastSalePricePYG,
    product.pricingConfidence, product.pricingResearch, product.internalNotes,
    product.isDemo ? 1 : 0, null, null, now, now,
  );
}

async function seedProducts(db: Database): Promise<void> {
  await db.batch(SAMPLE_PRODUCTS.map((product) => productInsert(db, product)));
}

async function ensureTpLinkMediaConverter(db: Database): Promise<void> {
  const id = 'real-20260913-tplink-mc111cs';
  if (await db.prepare('SELECT 1 AS present FROM products WHERE id = ?').bind(id).first()) return;
  const maxItem = await db.prepare('SELECT MAX(item_number) AS max_item FROM products').first<{ max_item: number | null }>();
  const itemNumber = Math.max(0, Number(maxItem?.max_item ?? 0)) + 1;
  const product: AdminProduct = {
    id,
    itemNumber,
    slug: 'convertidor-medio-fibra-optica-tp-link-mc111cs-v4',
    title: 'Convertidor de medio de fibra óptica TP-Link MC111CS V4',
    category: 'Computación y redes',
    tags: ['TP-Link', 'fibra óptica', 'redes', 'Ethernet', 'convertidor de medio'],
    description: 'Convertidor de medio TP-Link MC111CS V4 para conectar fibra óptica monomodo con una red Ethernet 10/100 Mbps. Tecnología WDM sobre un solo hilo, alcance de hasta 20 km, transmisión a 1550 nm y recepción a 1310 nm mediante conector SC. Compatible con el TP-Link MC112CS y otros equipos compatibles. Precio conversable.',
    condition: 'Como nuevo, con muy poco uso',
    conditionNotes: 'Impecable estado estético y funcionamiento confirmado por el vendedor.',
    knownDefects: 'Sin defectos conocidos.',
    images: ['/photo-pending.svg'],
    askingPricePYG: 120000,
    originalPricePYG: null,
    saleMode: 'IMMEDIATE',
    pickupAvailableDate: null,
    pickupWindowStart: null,
    pickupWindowEnd: null,
    depositPercent: 100,
    requiresVehicle: false,
    requiresLoadingHelp: false,
    logisticsNotes: [],
    includedAccessories: ['Caja original con etiquetas de fábrica'],
    sellerConfirmedFields: ['title', 'category', 'description', 'condition', 'conditionNotes', 'knownDefects', 'askingPricePYG', 'includedAccessories', 'saleMode'],
    status: 'NEEDS_REVIEW',
    featured: false,
    dateListed: '2026-09-13',
    lastPriceChange: null,
    isDemo: false,
    needsReview: true,
    adminPriceFloorPYG: null,
    marketEstimatePYG: null,
    recommendedFastSalePricePYG: null,
    pricingConfidence: 'Precio del vendedor',
    pricingResearch: 'Sin investigación de mercado; precio pedido proporcionado por el vendedor.',
    internalNotes: 'SELLER_CONFIRMED: datos de alta manual. PHOTO NEEDED. Mantener sin publicar hasta cargar y revisar una foto real.',
    holdExpiresAt: null,
    quantityTotal: 1,
    quantityRemaining: 1,
    quantityHeld: 0,
    quantitySold: 0,
  };
  await productInsert(db, product).run();
}

async function ensureItem31QuantityCorrection(db: Database): Promise<void> {
  const revision = 'item-31-two-plants-2026-09-13';
  const metaKey = 'item_31_quantity_revision';
  const applied = await db.prepare('SELECT value FROM inventory_meta WHERE key = ?').bind(metaKey).first<{ value: string }>();
  if (applied?.value === revision) return;
  const row = await db.prepare('SELECT * FROM products WHERE item_number = 31').first<Row>();
  if (!row) return;
  const now = Date.now();
  const description = 'Tradescantia morada con maceta, vendida por unidad. Hay 2 plantas disponibles y cada foto muestra una de las dos unidades. El precio corresponde a una planta con su maceta. La mesa no está incluida.';
  const includedAccessories = ['1 planta Tradescantia morada', '1 maceta'];
  const confirmedFields = new Set(jsonArray(row.seller_confirmed_fields_json));
  ['description', 'includedAccessories', 'quantityTotal', 'quantityRemaining'].forEach((field) => confirmedFields.add(field));
  await db.batch([
    db.prepare(`UPDATE products SET description = ?, included_accessories_json = ?, quantity_total = 2,
      quantity_remaining = 2, seller_confirmed_fields_json = ?, internal_notes = COALESCE(internal_notes, '') ||
      ' | SELLER_CONFIRMED: 2 unidades; cada foto corresponde a una planta distinta; precio por unidad.', updated_at = ?
      WHERE item_number = 31`).bind(description, JSON.stringify(includedAccessories), JSON.stringify([...confirmedFields].sort()), now),
    db.prepare(`INSERT INTO inventory_audit
      (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
      VALUES (?, ?, 31, 'description', ?, ?, 'OWNER', 'system:item-31-correction', ?)`).bind(
        crypto.randomUUID(), String(row.id), JSON.stringify(String(row.description)), JSON.stringify(description), now,
      ),
    db.prepare(`INSERT INTO inventory_audit
      (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
      VALUES (?, ?, 31, 'quantityTotal', ?, ?, 'OWNER', 'system:item-31-correction', ?)`).bind(
        crypto.randomUUID(), String(row.id), JSON.stringify(Number(row.quantity_total ?? 1)), JSON.stringify(2), now,
      ),
    db.prepare(`INSERT INTO inventory_meta (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(metaKey, revision, now),
  ]);
}

async function ensureItem57LightGrayFoldingTables(db: Database): Promise<void> {
  const present = await db.prepare('SELECT quantity_total, quantity_remaining FROM products WHERE item_number = 57').first<Row>();
  if (present) {
    if (Number(present.quantity_total ?? 1) !== 2 || Number(present.quantity_remaining ?? 1) !== 2) {
      await db.prepare(`UPDATE products SET quantity_total = 2, quantity_remaining = 2, quantity_held = 0,
        quantity_sold = 0, updated_at = ? WHERE item_number = 57`).bind(Date.now()).run();
    }
    return;
  }

  const now = Date.now();
  const product: AdminProduct = {
    id: 'real-20260918-light-gray-folding-tables',
    itemNumber: 57,
    slug: 'mesa-auxiliar-plegable-gris-claro',
    title: 'Mesa auxiliar plegable gris claro',
    category: 'Muebles',
    tags: ['muebles', 'venta de mudanza'],
    description: 'Mesa auxiliar plegable gris claro, vendida por unidad. Hay 2 unidades intercambiables disponibles.',
    condition: 'Buen estado visual',
    conditionNotes: 'Tres vistas del mismo artículo. Se observan desgastes y desprendimientos de pintura en varias esquinas de la superficie.',
    knownDefects: 'Se observan daños y desprendimientos en las esquinas de la superficie. Medidas y firmeza del mecanismo a confirmar.',
    images: [
      '/inventory/item-057/light-gray-folding-table-front.jpg',
      '/inventory/item-057/light-gray-folding-table-side.jpg',
      '/inventory/item-057/light-gray-folding-table-folded.jpg',
    ],
    askingPricePYG: 220000,
    originalPricePYG: null,
    saleMode: 'IMMEDIATE',
    pickupAvailableDate: null,
    pickupWindowStart: null,
    pickupWindowEnd: null,
    depositPercent: 100,
    requiresVehicle: true,
    requiresLoadingHelp: false,
    logisticsNotes: ['Requiere vehículo adecuado.'],
    includedAccessories: [],
    sellerConfirmedFields: [],
    status: 'NEEDS_REVIEW',
    featured: false,
    dateListed: '2026-09-18',
    lastPriceChange: null,
    needsReview: true,
    adminPriceFloorPYG: 150000,
    marketEstimatePYG: 245000,
    recommendedFastSalePricePYG: 185000,
    pricingConfidence: 'Media',
    pricingResearch: 'Estimación provisional basada en el artículo similar Item 044; requiere revisión.',
    internalNotes: 'NEEDS_REVIEW | Registro separado de Item 044; versión gris claro. | PRECIO POR UNIDAD | PRICE REVIEW NEEDED',
    isDemo: false,
    holdExpiresAt: null,
    quantityTotal: 2,
    quantityRemaining: 2,
    quantityHeld: 0,
    quantitySold: 0,
  };
  await productInsert(db, product, now).run();
}

async function ensureChairResearchCorrections(db: Database): Promise<void> {
  const revision = 'chair-research-correction-2026-09-21';
  const metaKey = 'chair_research_correction_revision';
  const applied = await db.prepare('SELECT value FROM inventory_meta WHERE key = ?').bind(metaKey).first<{ value: string }>();
  if (applied?.value === revision) return;
  const replacement = 'Investigación específica pendiente para este sillón tapizado. La referencia anterior de estantes y bibliotecas no corresponde a este artículo.';
  const rows = await db.prepare(`SELECT id, item_number, pricing_research FROM products
    WHERE item_number IN (11, 45, 55) AND is_demo = 0`).all<Row>();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const row of rows.results) {
    const previous = String(row.pricing_research ?? '');
    if (!previous.toLowerCase().includes('estantes y bibliotecas')) continue;
    statements.push(
      db.prepare(`UPDATE products SET pricing_research = ?, updated_at = ? WHERE id = ?
        AND pricing_research LIKE '%estantes y bibliotecas%'`).bind(replacement, now, row.id),
      db.prepare(`INSERT INTO inventory_audit
        (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
        VALUES (?, ?, ?, 'pricingResearch', ?, ?, 'OWNER', 'system:chair-research-correction', ?)`).bind(
        crypto.randomUUID(), row.id, row.item_number, JSON.stringify(previous), JSON.stringify(replacement), now,
      ),
    );
  }
  statements.push(db.prepare(`INSERT INTO inventory_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(metaKey, revision, now));
  await db.batch(statements);
}

async function ensureItem40MopCorrection(db: Database): Promise<void> {
  const revision = 'item-40-complete-mop-2026-09-21';
  const metaKey = 'item_40_mop_revision';
  const applied = await db.prepare('SELECT value FROM inventory_meta WHERE key = ?').bind(metaKey).first<{ value: string }>();
  if (applied?.value === revision) return;

  const row = await db.prepare('SELECT * FROM products WHERE item_number = 40 AND is_demo = 0').first<Row>();
  if (!row) return;

  const title = 'Mopa completa';
  const slug = 'mopa-completa';
  const description = 'Mopa completa con mango metálico y cabezal para limpiar pisos. Se vende completa, tal como aparece en la foto.';
  const condition = 'Usada';
  const conditionNotes = 'El mango y el cabezal están presentes. Se observan señales normales de uso.';
  const knownDefects = 'No se han informado defectos funcionales específicos; se vende en el estado mostrado en la foto.';
  const tags = ['hogar', 'limpieza', 'mopa', 'venta de mudanza'];
  const includedAccessories = ['Mango metálico', 'Cabezal de mopa'];
  const research = 'Fortis, Mopa Línea Bella nueva Gs. 30.900; precio reducido por tratarse de un artículo usado en venta particular. https://www.fortis.com.py/categoria/casa-and-jardin/accesorios-de-limpieza';
  const confirmedFields = new Set(jsonArray(row.seller_confirmed_fields_json));
  ['title', 'description', 'condition', 'conditionNotes', 'knownDefects', 'askingPricePYG', 'adminPriceFloorPYG',
    'marketEstimatePYG', 'recommendedFastSalePricePYG', 'pricingResearch', 'tags', 'includedAccessories']
    .forEach((field) => confirmedFields.add(field));
  const nextValues = {
    title, slug, description, condition, conditionNotes, knownDefects, tags,
    includedAccessories, askingPricePYG: 20000, adminPriceFloorPYG: 15000,
    marketEstimatePYG: 30000, recommendedFastSalePricePYG: 18000,
    pricingConfidence: 'Media', pricingResearch: research,
  };
  const previousValues = {
    title: row.title, slug: row.slug, description: row.description, condition: row.condition,
    conditionNotes: row.condition_notes, knownDefects: row.known_defects, tags: jsonArray(row.tags_json),
    includedAccessories: jsonArray(row.included_accessories_json), askingPricePYG: Number(row.asking_price_pyg),
    adminPriceFloorPYG: row.admin_price_floor_pyg == null ? null : Number(row.admin_price_floor_pyg),
    marketEstimatePYG: row.market_estimate_pyg == null ? null : Number(row.market_estimate_pyg),
    recommendedFastSalePricePYG: row.recommended_fast_sale_price_pyg == null ? null : Number(row.recommended_fast_sale_price_pyg),
    pricingConfidence: row.pricing_confidence, pricingResearch: row.pricing_research,
  };
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE products SET title = ?, slug = ?, category = 'Hogar', tags_json = ?, description = ?, condition = ?,
      condition_notes = ?, known_defects = ?, included_accessories_json = ?, asking_price_pyg = ?, admin_price_floor_pyg = ?,
      market_estimate_pyg = ?, recommended_fast_sale_price_pyg = ?, pricing_confidence = ?, pricing_research = ?,
      seller_confirmed_fields_json = ?, internal_notes = COALESCE(internal_notes, '') || ' | COMPLETE MOP CONFIRMED; PRICE REVIEWED', updated_at = ?
      WHERE item_number = 40`).bind(
      title, slug, JSON.stringify(tags), description, condition, conditionNotes, knownDefects,
      JSON.stringify(includedAccessories), 20000, 15000, 30000, 18000, 'Media', research,
      JSON.stringify([...confirmedFields].sort()), now,
    ),
    db.prepare(`INSERT INTO inventory_audit
      (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
      VALUES (?, ?, 40, 'item-40-mop-correction', ?, ?, 'OWNER', 'system:item-40-mop-correction', ?)`).bind(
      crypto.randomUUID(), String(row.id), JSON.stringify(previousValues), JSON.stringify(nextValues), now,
    ),
    db.prepare(`INSERT INTO inventory_meta (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(metaKey, revision, now),
  ]);
}

async function ensureItem46MaterialCorrection(db: Database): Promise<void> {
  const revision = 'item-46-plastic-rattan-material-2026-09-21-v1';
  const metaKey = 'item_46_material_correction_revision';
  const applied = await db.prepare('SELECT value FROM inventory_meta WHERE key = ?').bind(metaKey).first<{ value: string }>();
  if (applied?.value === revision) return;

  const row = await db.prepare('SELECT * FROM products WHERE item_number = 46 AND is_demo = 0').first<Row>();
  if (!row) return;

  const title = 'Juego de gabinetes plásticos con textura tipo ratán';
  const description = 'Par de gabinetes plásticos color marrón oscuro, con puertas de diseño tejido tipo ratán. Se vende únicamente el par completo.\nMedidas confirmadas: 31 cm ancho, 82 cm alto, 30 cm profundo.';
  const conditionNotes = 'Dos vistas muestran el frente y el interior. La estructura y las puertas parecen ser de plástico moldeado; las puertas tienen una textura decorativa tipo ratán.';
  const includedAccessories = ['2 gabinetes plásticos con puertas de textura tipo ratán'];
  const internalNotes = String(row.internal_notes ?? '') + ' | MATERIAL REVIEW 2026-09-21: las fotos indican plástico moldeado con textura tipo ratán; no describirlos como ratán natural. | PRICE REVIEW PENDING: precio pedido actual Gs. 360.000 total por el par; no modificar hasta aprobación del propietario.';
  const confirmedFields = new Set(jsonArray(row.seller_confirmed_fields_json));
  ['title', 'description', 'conditionNotes', 'includedAccessories', 'internalNotes']
    .forEach((field) => confirmedFields.add(field));

  const now = Date.now();
  const changes: Array<[string, unknown, unknown]> = [
    ['title', row.title, title],
    ['description', row.description, description],
    ['conditionNotes', row.condition_notes, conditionNotes],
    ['includedAccessories', jsonArray(row.included_accessories_json), includedAccessories],
    ['internalNotes', row.internal_notes, internalNotes],
  ];
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE products SET title = ?, description = ?, condition_notes = ?,
      included_accessories_json = ?, internal_notes = ?, seller_confirmed_fields_json = ?, updated_at = ?
      WHERE id = ?`).bind(
      title, description, conditionNotes, JSON.stringify(includedAccessories), internalNotes,
      JSON.stringify([...confirmedFields].sort()), now, String(row.id),
    ),
  ];
  for (const [fieldName, previousValue, newValue] of changes) {
    statements.push(db.prepare(`INSERT INTO inventory_audit
      (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
      VALUES (?, ?, 46, ?, ?, ?, 'OWNER', 'system:item-46-material-correction', ?)`)
      .bind(crypto.randomUUID(), String(row.id), fieldName, JSON.stringify(previousValue), JSON.stringify(newValue), now));
  }
  statements.push(db.prepare(`INSERT INTO inventory_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(metaKey, revision, now));
  await db.batch(statements);
}

async function applySellerCorrections(db: Database): Promise<void> {
  const revision = 'seller-confirmed-2026-09-12';
  const done = await db.prepare('SELECT value FROM inventory_meta WHERE key = ?').bind('seller_correction_revision').first<{ value: string }>();
  if (done?.value === revision) return;
  const now = Date.now();

  // Ensure the photographed inventory exists without approving or publishing missing records.
  for (const item of PHASE2_BATCH_ITEMS) {
    const exists = await db.prepare('SELECT 1 AS present FROM products WHERE id = ?').bind(item.id).first();
    if (!exists) await productInsert(db, phase2Product(item), now).run();
  }

  await db.prepare(`UPDATE products SET pickup_available_date = '2026-12-09', pickup_window_start = '2026-12-09',
    pickup_window_end = '2026-12-12', updated_at = ? WHERE sale_mode = 'DELAYED' AND is_demo = 0`).bind(now).run();
  await db.prepare(`UPDATE order_items SET pickup_available_date = '2026-12-09', pickup_window_start = '2026-12-09',
    pickup_window_end = '2026-12-12' WHERE sale_mode = 'DELAYED'`).run();

  const updates: Array<[number, string]> = [
    [3, `category = 'Accesorios personales'`],
    [4, `internal_notes = COALESCE(internal_notes, '') || ' | MEASUREMENTS NEEDED'`],
    [5, `known_defects = 'Medidas confirmadas: 44 cm de ancho, 72 cm de alto y 22 cm de profundidad.', seller_confirmed_fields_json = '["knownDefects"]'`],
    [6, `asking_price_pyg = 30000, seller_confirmed_fields_json = '["askingPricePYG"]'`],
    [7, `internal_notes = COALESCE(internal_notes, '') || ' | MEASUREMENTS NEEDED'`],
    [8, `internal_notes = COALESCE(internal_notes, '') || ' | MEASUREMENTS NEEDED'`],
    [10, `known_defects = 'La parte superior está agrietada/dañada. El daño se conserva visible y no se minimiza.', internal_notes = COALESCE(internal_notes, '') || ' | MEASUREMENTS NEEDED | CLOSE-UP PHOTO NEEDED: área agrietada/dañada'`],
    [16, `title = 'Maceta de barro y barras de bambú decorativo', slug = 'maceta-de-barro-y-barras-de-bambu-decorativo'`],
    [17, `condition = 'Muy buen estado', condition_notes = 'Funciona muy bien, está en muy buen estado y tuvo poco uso.', internal_notes = COALESCE(internal_notes, '') || ' | PRICE REVIEW NEEDED'`],
    [19, `title = 'Canasto tejido', slug = 'canasto-tejido', description = 'Canasto tejido vendido por unidad. Hay 2 unidades intercambiables disponibles.', quantity_total = 2, quantity_remaining = 2, asking_price_pyg = asking_price_pyg, internal_notes = COALESCE(internal_notes, '') || ' | MEASUREMENTS NEEDED | PRECIO POR UNIDAD'`],
    [20, `title = 'Florero azul', slug = 'florero-azul', description = 'Florero azul vendido sin las flores decorativas. Las flores que aparecen en la foto no están incluidas.', internal_notes = COALESCE(internal_notes, '') || ' | MEASUREMENTS NEEDED'`],
    [21, `description = 'Florero vendido solo, sin otros objetos visibles.', internal_notes = COALESCE(internal_notes, '') || ' | MEASUREMENTS NEEDED'`],
    [24, `description = 'Incluye planta y maceta.', included_accessories_json = '["Planta","Maceta"]'`],
    [28, `description = 'Incluye únicamente la planta y la maceta. La mesa que aparece en la foto no está incluida.', included_accessories_json = '["Planta","Maceta"]'`],
    [30, `title = 'Maceta jardinera rectangular', slug = 'maceta-jardinera-rectangular'`],
    [31, `description = 'Incluye la planta y la maceta. La mesa y el conjunto separado de planta, maceta y soporte visible contra la pared no están incluidos.', included_accessories_json = '["Planta","Maceta"]'`],
    [32, `internal_notes = COALESCE(internal_notes, '') || ' | MAIN PHOTO: natural crop may remove pruning shears; preserve original'`],
    [33, `description = 'Incluye las plantas, sus macetas y la mesa visible.', included_accessories_json = '["Plantas","Macetas","Mesa"]'`],
    [34, `condition_notes = 'La parrilla funciona.', known_defects = 'La placa metálica interior que sostiene el carbón, debajo de la rejilla de cocción, tiene una sección considerable quemada y perforada por el uso. Conviene reforzarla o repararla; la parrilla sigue siendo funcional.', internal_notes = COALESCE(internal_notes, '') || ' | CLOSE-UP PHOTO NEEDED: área quemada/perforada | PRICE REVIEW NEEDED'`],
    [35, `description = 'Planta de jade grande con maceta de barro.', included_accessories_json = '["Planta","Maceta de barro"]'`],
    [39, `internal_notes = COALESCE(internal_notes, '') || ' | PRICE RESEARCH / REPRICING NEEDED'`],
    [40, `title = 'Mopa completa', slug = 'mopa-completa', category = 'Hogar', tags_json = '["hogar","limpieza","mopa","venta de mudanza"]', description = 'Mopa completa con mango metálico y cabezal para limpiar pisos. Se vende completa, tal como aparece en la foto.', condition = 'Usada', condition_notes = 'El mango y el cabezal están presentes. Se observan señales normales de uso.', known_defects = 'No se han informado defectos funcionales específicos; se vende en el estado mostrado en la foto.', included_accessories_json = '["Mango metálico","Cabezal de mopa"]', asking_price_pyg = 20000, admin_price_floor_pyg = 15000, market_estimate_pyg = 30000, recommended_fast_sale_price_pyg = 18000, pricing_confidence = 'Media', pricing_research = 'Fortis, Mopa Línea Bella nueva Gs. 30.900; precio reducido por tratarse de un artículo usado en venta particular. https://www.fortis.com.py/categoria/casa-and-jardin/accesorios-de-limpieza'`],
    [41, `internal_notes = COALESCE(internal_notes, '') || ' | PRICE RESEARCH / REVIEW NEEDED'`],
    [42, `description = 'Basurero exterior con tapa, capacidad de 30 litros. No tiene ruedas.', known_defects = 'Cierre de tapa a confirmar. El vendedor confirma que no tiene ruedas.', seller_confirmed_fields_json = '["description","knownDefects"]'`],
    [44, `description = 'Mesa auxiliar plegable gris oscuro, vendida por unidad. Hay 2 unidades intercambiables disponibles.', quantity_total = 2, quantity_remaining = 2, images_json = '["/api/media/real-20260828-44/0"]', internal_notes = COALESCE(internal_notes, '') || ' | PRECIO POR UNIDAD | PRICE REVIEW NEEDED'`],
    [45, `description = 'Sillón individual vendido por separado. La tela no está rota y no hay daño estructural. Está estructuralmente muy bien y en muy buen estado general; presenta solamente una leve decoloración en la zona de contacto del apoyabrazos. Otro sillón similar está disponible por separado.', images_json = '["/api/media/real-20260828-45/0"]', internal_notes = COALESCE(internal_notes, '') || ' | BETTER CONDITION PHOTO NEEDED: decoloración'`],
    [46, `title = 'Juego de gabinetes de ratán', slug = 'juego-de-gabinetes-de-ratan', description = 'Par de gabinetes de ratán color marrón. Se vende únicamente el par completo.', asking_price_pyg = 360000, included_accessories_json = '["2 gabinetes de ratán"]', internal_notes = COALESCE(internal_notes, '') || ' | NEW PHOTO NEEDED | MEASUREMENTS NEEDED | Gs. 360.000 TOTAL POR EL PAR'`],
    [47, `description = 'Repisas vendidas individualmente, con 3 unidades intercambiables disponibles.', quantity_total = 3, quantity_remaining = 3, internal_notes = COALESCE(internal_notes, '') || ' | MEASUREMENTS NEEDED | PRECIO POR UNIDAD'`],
    [48, `condition = 'Usado, funcional y en estado decente', condition_notes = 'Funciona y tiene buena calidad de sonido. Todos los enchufes y conexiones funcionan. El control de volumen es sensible, puede crepitar levemente y requerir un pequeño ajuste para dejar el nivel correcto.', known_defects = 'La batería interna ya no funciona. El equipo debe usarse conectado.', included_accessories_json = '["2 micrófonos inalámbricos","Soportes para micrófonos inalámbricos","Trípode firme de altura regulable","Cable de alimentación"]', internal_notes = COALESCE(internal_notes, '') || ' | PRICE REVIEW NEEDED; no usar automáticamente Gs. 850.000'`],
    [49, `description = 'Rack metálico para ollas y sartenes. Incluye exactamente 6 ganchos en forma de S. Las ollas y sartenes visibles no están incluidas.', included_accessories_json = '["6 ganchos en forma de S"]'`],
    [50, `title = 'Estantería de madera', slug = 'estanteria-de-madera', internal_notes = COALESCE(internal_notes, '') || ' | MEASUREMENTS NEEDED'`],
    [53, `status = 'UNLISTED', needs_review = 0, featured = 0, internal_notes = COALESCE(internal_notes, '') || ' | RETIRED: mesa incluida con Item 033; conservar ID e historial'`],
  ];
  for (const [itemNumber, setSql] of updates) {
    await db.prepare(`UPDATE products SET ${setSql}, updated_at = ? WHERE item_number = ?`).bind(now, itemNumber).run();
    await db.prepare(`INSERT INTO inventory_audit (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
      SELECT ?, id, item_number, 'seller_correction_batch', NULL, ?, 'OWNER', 'system@seller-confirmed', ? FROM products WHERE item_number = ?`)
      .bind(crypto.randomUUID(), JSON.stringify(revision), now, itemNumber).run();
  }

  const item44 = await db.prepare('SELECT * FROM products WHERE item_number = 44').first<Row>();
  if (item44 && !await db.prepare('SELECT 1 AS present FROM products WHERE item_number = 54').first()) {
    const p = mapAdminProduct(item44);
    await productInsert(db, { ...p, id: 'real-20260912-54', itemNumber: 54, slug: 'mesa-auxiliar-plegable-blanca-marmolada',
      title: 'Mesa auxiliar plegable blanca marmolada', description: 'Versión blanca o clara marmolada. Registro separado de la versión gris oscuro.',
      images: ['/api/media/real-20260912-54/0', '/api/media/real-20260912-54/1'], status: 'NEEDS_REVIEW', needsReview: true,
      quantityTotal: 1, quantityRemaining: 1, quantityHeld: 0, quantitySold: 0,
      internalNotes: 'NEEDS_REVIEW | PRICE RESEARCH / REVIEW NEEDED | Fotos separadas desde Item 044 según secuencia existente.' }, now).run();
    await db.prepare(`UPDATE product_images SET product_id = ?, sort_order = sort_order - 1 WHERE product_id = ? AND sort_order IN (1,2)`)
      .bind('real-20260912-54', 'real-20260828-44').run();
  }
  await db.prepare(`INSERT INTO inventory_meta (key, value, updated_at) VALUES ('seller_correction_revision', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(revision, now).run();
}

function jsonArray(value: string | number | null): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapPublicProduct(row: Row): PublicProduct {
  return {
    id: String(row.id), itemNumber: row.item_number == null ? null : Number(row.item_number),
    slug: String(row.slug), title: String(row.title), category: String(row.category),
    tags: jsonArray(row.tags_json), description: String(row.description), condition: String(row.condition),
    conditionNotes: String(row.condition_notes), knownDefects: String(row.known_defects ?? ''),
    images: jsonArray(row.images_json), askingPricePYG: Number(row.asking_price_pyg),
    originalPricePYG: row.original_price_pyg == null ? null : Number(row.original_price_pyg),
    saleMode: String(row.sale_mode) as SaleMode,
    pickupAvailableDate: row.pickup_available_date == null ? null : String(row.pickup_available_date),
    pickupWindowStart: row.pickup_window_start == null ? null : String(row.pickup_window_start),
    pickupWindowEnd: row.pickup_window_end == null ? null : String(row.pickup_window_end),
    depositPercent: Number(row.deposit_percent), requiresVehicle: Boolean(row.requires_vehicle),
    requiresLoadingHelp: Boolean(row.requires_loading_help), logisticsNotes: jsonArray(row.logistics_notes_json),
    includedAccessories: jsonArray(row.included_accessories_json),
    sellerConfirmedFields: jsonArray(row.seller_confirmed_fields_json),
    status: String(row.status) as InventoryStatus, featured: Boolean(row.featured),
    dateListed: String(row.date_listed), lastPriceChange: row.last_price_change == null ? null : String(row.last_price_change),
    isDemo: Boolean(row.is_demo),
    quantityTotal: Number(row.quantity_total ?? 1), quantityRemaining: Math.max(0, Number(row.quantity_remaining ?? 1) - Number(row.quantity_held ?? 0)),
    quantityHeld: Number(row.quantity_held ?? 0), quantitySold: Number(row.quantity_sold ?? 0),
  };
}

function mapAdminProduct(row: Row): AdminProduct {
  const phase2Item = PHASE2_BATCH_ITEMS.find((item) => item.id === String(row.id));
  const volume2Item = VOLUME2_BATCH_ITEMS.find((item) => item.id === String(row.id));
  const batchItem = phase2Item ?? volume2Item;
  return {
    ...mapPublicProduct(row), needsReview: Boolean(row.needs_review),
    quantityRemaining: Number(row.quantity_remaining ?? 1),
    adminPriceFloorPYG: row.admin_price_floor_pyg == null ? null : Number(row.admin_price_floor_pyg),
    marketEstimatePYG: row.market_estimate_pyg == null ? null : Number(row.market_estimate_pyg),
    recommendedFastSalePricePYG: row.recommended_fast_sale_price_pyg == null ? null : Number(row.recommended_fast_sale_price_pyg),
    pricingConfidence: row.pricing_confidence == null ? null : String(row.pricing_confidence),
    pricingResearch: row.pricing_research == null ? null : String(row.pricing_research),
    internalNotes: row.internal_notes == null ? null : String(row.internal_notes),
    holdExpiresAt: row.hold_expires_at == null ? null : Number(row.hold_expires_at),
    batchId: phase2Item ? PHASE2_BATCH_ID : volume2Item ? VOLUME2_BATCH_ID : null,
    reviewFlag: batchItem?.flag ?? null,
    marketLowPYG: batchItem?.marketLow ?? null,
    marketHighPYG: batchItem?.marketHigh ?? null,
    expectedPhotoCount: batchItem?.photos.length ?? 0,
    uploadedPhotoCount: Number(row.uploaded_photo_count ?? 0),
  };
}

export async function releaseExpiredHolds(): Promise<void> {
  const db = await ensureDatabase();
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE products SET quantity_held = MAX(0, quantity_held - COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = products.id AND o.status = 'TEMPORARY_HOLD' AND o.hold_expires_at IS NOT NULL AND o.hold_expires_at <= ?), 0)), updated_at = ? WHERE id IN (SELECT oi.product_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'TEMPORARY_HOLD' AND o.hold_expires_at IS NOT NULL AND o.hold_expires_at <= ?)`)
      .bind(now, now, now),
    db.prepare(`UPDATE order_items SET item_status = 'AVAILABLE'
      WHERE order_id IN (SELECT id FROM orders WHERE status = 'TEMPORARY_HOLD' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?)`)
      .bind(now),
    db.prepare(`UPDATE products SET status = 'AVAILABLE', hold_token = NULL, hold_expires_at = NULL, updated_at = ?
      WHERE status = 'TEMPORARY_HOLD' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?`).bind(now, now),
    db.prepare(`UPDATE orders SET status = 'EXPIRED', updated_at = ?
      WHERE status = 'TEMPORARY_HOLD' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?`).bind(now, now),
  ]);
}

const PUBLIC_SELECT = `id, item_number, slug, title, category, tags_json, description, condition, condition_notes,
  known_defects, images_json, asking_price_pyg, original_price_pyg, sale_mode, pickup_available_date,
  pickup_window_start, pickup_window_end, deposit_percent, requires_vehicle, requires_loading_help,
  logistics_notes_json, included_accessories_json, seller_confirmed_fields_json, status, featured,
  date_listed, last_price_change, is_demo, quantity_total, quantity_remaining, quantity_held, quantity_sold`;

export async function listPublicProducts(): Promise<PublicProduct[]> {
  await releaseExpiredHolds();
  const db = await ensureDatabase();
  const realVisibility = realStorefrontEnabled() ? 'AND is_demo = 0' : 'AND is_demo = 1';
  const result = await db.prepare(`SELECT ${PUBLIC_SELECT} FROM products
    WHERE status NOT IN ('NEEDS_REVIEW', 'UNLISTED') ${realVisibility} ORDER BY featured DESC, date_listed DESC`).all<Row>();
  return result.results.map(mapPublicProduct);
}

export async function getPublicProductBySlug(slug: string): Promise<PublicProduct | null> {
  await releaseExpiredHolds();
  const db = await ensureDatabase();
  const realVisibility = realStorefrontEnabled() ? 'AND is_demo = 0' : 'AND is_demo = 1';
  const row = await db.prepare(`SELECT ${PUBLIC_SELECT} FROM products
    WHERE slug = ? AND status NOT IN ('NEEDS_REVIEW', 'UNLISTED') ${realVisibility}`).bind(slug).first<Row>();
  return row ? mapPublicProduct(row) : null;
}

export async function getPublicProductsByIds(ids: string[]): Promise<PublicProduct[]> {
  const unique = [...new Set(ids)].slice(0, 20);
  if (!unique.length) return [];
  await releaseExpiredHolds();
  const db = await ensureDatabase();
  const products: PublicProduct[] = [];
  const realVisibility = realStorefrontEnabled() ? 'AND is_demo = 0' : 'AND is_demo = 1';
  for (const id of unique) {
    const row = await db.prepare(`SELECT ${PUBLIC_SELECT} FROM products WHERE id = ? AND status NOT IN ('NEEDS_REVIEW', 'UNLISTED') ${realVisibility}`).bind(id).first<Row>();
    if (row) products.push(mapPublicProduct(row));
  }
  return products;
}

async function referenceNumber(db: Database): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const reference = `MUD-${1000 + Math.floor(Math.random() * 9000)}`;
    const exists = await db.prepare('SELECT 1 AS present FROM orders WHERE reference = ?').bind(reference).first();
    if (!exists) return reference;
  }
  return `MUD-${String(Date.now()).slice(-6)}`;
}

export async function createInventoryHold(requestedItems: Array<{ productId: string; quantity: number }>): Promise<{ order: OrderSummary; token: string }> {
  const requested = [...new Map(requestedItems.slice(0, 20).map((item) => [item.productId, { productId: item.productId, quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)) }])).values()];
  if (!requested.length) throw new Error('El carrito está vacío.');
  await releaseExpiredHolds();
  const db = await ensureDatabase();
  const token = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + PUBLIC_CONFIG.holdMinutes * 60_000;
  const products: Array<{ product: PublicProduct; quantity: number }> = [];

  try {
    for (const requestedItem of requested) {
      const id = requestedItem.productId;
      const row = await db.prepare(`SELECT ${PUBLIC_SELECT} FROM products WHERE id = ?`).bind(id).first<Row>();
      if (!row) throw new Error('Uno de los artículos ya no existe.');
      const product = mapPublicProduct(row);
      if (!product.isDemo && !realStorefrontEnabled()) throw new Error(`${product.title} todavía no está disponible en la tienda pública.`);
      if (requestedItem.quantity > (product.quantityRemaining ?? 1) - (product.quantityHeld ?? 0)) throw new Error(`${product.title} no tiene esa cantidad disponible.`);
      const held = await db.prepare(`UPDATE products SET quantity_held = quantity_held + ?, status = CASE WHEN quantity_total = 1 THEN 'TEMPORARY_HOLD' ELSE status END, hold_token = CASE WHEN quantity_total = 1 THEN ? ELSE hold_token END, hold_expires_at = CASE WHEN quantity_total = 1 THEN ? ELSE hold_expires_at END, updated_at = ?
        WHERE id = ? AND status = 'AVAILABLE' AND quantity_remaining - quantity_held >= ?`).bind(requestedItem.quantity, token, expiresAt, now, id, requestedItem.quantity).run();
      if (!held.meta.changes) throw new Error(`${product.title} ya no está disponible. Actualizá el carrito e intentá de nuevo.`);
      products.push({ product, quantity: requestedItem.quantity });
    }

    const reference = await referenceNumber(db);
    const totals = products.reduce((sum, entry) => {
      const dueNow = dueNowForProduct(entry.product) * entry.quantity;
      sum.total += entry.product.askingPricePYG * entry.quantity;
      sum.due += dueNow;
      sum.balance += (entry.product.askingPricePYG * entry.quantity) - dueNow;
      return sum;
    }, { total: 0, due: 0, balance: 0 });

    const statements: D1PreparedStatement[] = [
      db.prepare(`INSERT INTO orders (
        id, reference, hold_token, order_source, status, pickup_acknowledged, delayed_pickup_acknowledged,
        deposit_terms_acknowledged, total_value_pyg, due_now_pyg, balance_later_pyg, balance_remaining_pyg,
        confirmed_amount_pyg, balance_confirmed_amount_pyg, hold_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'ONLINE', 'TEMPORARY_HOLD', 0, 0, 0, ?, ?, ?, ?, 0, 0, ?, ?, ?)`)
        .bind(orderId, reference, token, totals.total, totals.due, totals.balance, totals.balance, expiresAt, now, now),
      db.prepare(`INSERT INTO order_audit
        (id, order_id, order_reference, event_type, details_json, actor_role, actor_email, created_at)
        VALUES (?, ?, ?, 'ORDER_CREATED', ?, 'BUYER', 'checkout', ?)`).bind(
          crypto.randomUUID(), orderId, reference, JSON.stringify({ source: 'ONLINE', totalValuePYG: totals.total, dueNowPYG: totals.due, balancePYG: totals.balance, itemCount: products.reduce((sum, entry) => sum + entry.quantity, 0) }), now,
        ),
    ];
    for (const { product, quantity } of products) {
      const dueNow = dueNowForProduct(product) * quantity;
      statements.push(db.prepare(`INSERT INTO order_items (
        id, order_id, product_id, item_number, product_slug, title_snapshot, image_snapshot, price_pyg,
        due_now_pyg, balance_later_pyg, sale_mode, deposit_percent, pickup_available_date,
        pickup_window_start, pickup_window_end, item_status, quantity, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TEMPORARY_HOLD', ?, ?)`)
        .bind(crypto.randomUUID(), orderId, product.id, product.itemNumber, product.slug, product.title, product.images[0] ?? '',
          product.askingPricePYG, dueNow, (product.askingPricePYG * quantity) - dueNow, product.saleMode,
          product.depositPercent, product.pickupAvailableDate, product.pickupWindowStart, product.pickupWindowEnd, quantity, now));
    }
    await db.batch(statements);
    return { order: (await getOrderForBuyer(orderId, token))!, token };
  } catch (error) {
    for (const { product, quantity } of products) await db.prepare(`UPDATE products SET quantity_held = MAX(0, quantity_held - ?), status = CASE WHEN quantity_total = 1 THEN 'AVAILABLE' ELSE status END, hold_token = NULL, hold_expires_at = NULL, updated_at = ? WHERE id = ?`).bind(quantity, Date.now(), product.id).run();
    throw error;
  }
}

function mapOrder(row: Row, itemRows: Row[], paymentRows: Row[] = []): OrderSummary {
  const items: OrderItem[] = itemRows.map((item) => ({
    id: String(item.id), productId: String(item.product_id), itemNumber: item.item_number == null ? null : Number(item.item_number),
    slug: String(item.product_slug),
    title: String(item.title_snapshot), image: String(item.image_snapshot), pricePYG: Number(item.price_pyg),
    dueNowPYG: Number(item.due_now_pyg), balanceLaterPYG: Number(item.balance_later_pyg),
    saleMode: String(item.sale_mode) as SaleMode, depositPercent: Number(item.deposit_percent),
    pickupAvailableDate: item.pickup_available_date == null ? null : String(item.pickup_available_date),
    pickupWindowStart: item.pickup_window_start == null ? null : String(item.pickup_window_start),
    pickupWindowEnd: item.pickup_window_end == null ? null : String(item.pickup_window_end),
    itemStatus: String(item.item_status) as InventoryStatus,
    quantity: Number(item.quantity ?? 1),
  }));
  return {
    id: String(row.id), reference: String(row.reference), source: String(row.order_source ?? 'ONLINE') as 'ONLINE' | 'DIRECT', status: String(row.status),
    buyerName: row.buyer_name == null ? null : String(row.buyer_name),
    buyerWhatsapp: row.buyer_whatsapp == null ? null : String(row.buyer_whatsapp),
    buyerEmail: row.buyer_email == null ? null : String(row.buyer_email),
    totalValuePYG: Number(row.total_value_pyg), dueNowPYG: Number(row.due_now_pyg),
    balanceLaterPYG: row.balance_remaining_pyg == null ? Number(row.balance_later_pyg) : Number(row.balance_remaining_pyg),
    originalBalancePYG: Number(row.balance_later_pyg),
    confirmedAmountPYG: Number(row.confirmed_amount_pyg ?? 0),
    balanceConfirmedAmountPYG: Number(row.balance_confirmed_amount_pyg ?? 0),
    paymentMethod: row.payment_method == null ? null : String(row.payment_method),
    balancePaymentMethod: row.balance_payment_method == null ? null : String(row.balance_payment_method),
    holdExpiresAt: row.hold_expires_at == null ? null : Number(row.hold_expires_at),
    transferDeclaredAt: row.transfer_declared_at == null ? null : Number(row.transfer_declared_at),
    paymentConfirmedAt: row.payment_confirmed_at == null ? null : Number(row.payment_confirmed_at),
    balanceConfirmedAt: row.balance_confirmed_at == null ? null : Number(row.balance_confirmed_at),
    createdAt: Number(row.created_at), items,
    payments: paymentRows.map((payment) => ({
      id: String(payment.id), paymentType: String(payment.payment_type) as 'INITIAL' | 'BALANCE',
      amountPYG: Number(payment.amount_pyg), method: String(payment.method),
      receivedAt: Number(payment.received_at), actorEmail: String(payment.actor_email),
    })),
  };
}

export async function getOrderForBuyer(orderId: string, token: string): Promise<OrderSummary | null> {
  await releaseExpiredHolds();
  const db = await ensureDatabase();
  const row = await db.prepare('SELECT * FROM orders WHERE id = ? AND hold_token = ?').bind(orderId, token).first<Row>();
  if (!row) return null;
  const items = await db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at').bind(orderId).all<Row>();
  const payments = await db.prepare('SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at').bind(orderId).all<Row>();
  return mapOrder(row, items.results, payments.results);
}

export async function submitBuyerDetails(input: {
  orderId: string; token: string; name: string; whatsapp: string; email?: string;
  pickupAcknowledged: boolean; delayedPickupAcknowledged: boolean; depositTermsAcknowledged: boolean;
}): Promise<OrderSummary> {
  const db = await ensureDatabase();
  const now = Date.now();
  const updated = await db.prepare(`UPDATE orders SET buyer_name = ?, buyer_whatsapp = ?, buyer_email = ?,
      pickup_acknowledged = ?, delayed_pickup_acknowledged = ?, deposit_terms_acknowledged = ?,
      status = 'PAYMENT_PENDING', hold_expires_at = NULL, updated_at = ?
    WHERE id = ? AND hold_token = ? AND status = 'TEMPORARY_HOLD' AND hold_expires_at > ?`)
    .bind(input.name, input.whatsapp, input.email || null, input.pickupAcknowledged ? 1 : 0,
      input.delayedPickupAcknowledged ? 1 : 0, input.depositTermsAcknowledged ? 1 : 0,
      now, input.orderId, input.token, now).run();
  if (!updated.meta.changes) throw new Error('La retención venció o el pedido ya fue actualizado. Volvé al carrito.');
  const itemRows = await db.prepare('SELECT product_id FROM order_items WHERE order_id = ?').bind(input.orderId).all<Row>();
  await db.batch([
    ...itemRows.results.map((item) => db.prepare(`UPDATE products SET status = CASE WHEN quantity_total = 1 THEN 'PAYMENT_PENDING' ELSE status END,
      hold_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'TEMPORARY_HOLD'`).bind(now, item.product_id)),
    db.prepare(`UPDATE order_items SET item_status = 'PAYMENT_PENDING' WHERE order_id = ?`).bind(input.orderId),
  ]);
  return (await getOrderForBuyer(input.orderId, input.token))!;
}

export async function declareTransfer(orderId: string, token: string): Promise<OrderSummary> {
  const db = await ensureDatabase();
  const now = Date.now();
  const updated = await db.prepare(`UPDATE orders SET status = 'PAYMENT_PENDING', transfer_declared_at = ?, hold_expires_at = NULL, updated_at = ?
    WHERE id = ? AND hold_token = ? AND buyer_name IS NOT NULL
      AND (status = 'PAYMENT_PENDING' OR (status = 'TEMPORARY_HOLD' AND hold_expires_at > ?))`)
    .bind(now, now, orderId, token, now).run();
  if (!updated.meta.changes) throw new Error('La retención venció o faltan datos del comprador. Volvé al carrito.');
  await db.batch([
    db.prepare(`UPDATE products SET status = 'PAYMENT_PENDING', hold_expires_at = NULL, updated_at = ?
      WHERE hold_token = ? AND status = 'TEMPORARY_HOLD'`).bind(now, token),
    db.prepare(`UPDATE order_items SET item_status = 'PAYMENT_PENDING' WHERE order_id = ?`).bind(orderId),
  ]);
  for (const item of (await db.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all<Row>()).results) {
    await db.prepare(`UPDATE products SET status = CASE WHEN quantity_total = 1 THEN 'PAYMENT_PENDING' ELSE status END, hold_expires_at = CASE WHEN quantity_total = 1 THEN NULL ELSE hold_expires_at END, updated_at = ? WHERE id = ?`).bind(now, item.product_id).run();
  }
  return (await getOrderForBuyer(orderId, token))!;
}

export async function listAdminProducts(): Promise<AdminProduct[]> {
  await releaseExpiredHolds();
  const db = await ensureDatabase();
  const result = await db.prepare(`SELECT products.*,
      (SELECT COUNT(*) FROM product_images WHERE product_images.product_id = products.id) AS uploaded_photo_count
    FROM products ORDER BY needs_review DESC, date_listed DESC`).all<Row>();
  return result.results.map(mapAdminProduct);
}

function phase2Product(item: (typeof PHASE2_BATCH_ITEMS)[number]): AdminProduct {
  return {
    id: item.id,
    itemNumber: item.itemNumber,
    slug: slugify(item.title),
    title: item.title,
    category: item.category,
    tags: [item.category.toLowerCase(), 'venta de mudanza'],
    description: item.description,
    condition: item.condition,
    conditionNotes: item.conditionNotes,
    knownDefects: item.knownDefects,
    images: item.photos.map((_, index) => `/api/media/${item.id}/${index}`),
    askingPricePYG: item.asking,
    originalPricePYG: null,
    saleMode: item.saleMode,
    pickupAvailableDate: item.pickupDate,
    pickupWindowStart: item.pickupWindowStart,
    pickupWindowEnd: item.pickupWindowEnd,
    depositPercent: item.saleMode === 'DELAYED' ? 25 : 100,
    requiresVehicle: Boolean(item.requiresVehicle),
    requiresLoadingHelp: Boolean(item.requiresLoadingHelp),
    logisticsNotes: [item.requiresVehicle ? 'Requiere vehículo adecuado.' : '', item.requiresLoadingHelp ? 'El comprador debe traer ayuda para cargar.' : ''].filter(Boolean),
    includedAccessories: item.includedAccessories ?? [],
    sellerConfirmedFields: item.sellerConfirmedFields ?? [],
    status: 'NEEDS_REVIEW',
    featured: false,
    dateListed: '2026-08-29',
    lastPriceChange: null,
    isDemo: false,
    needsReview: true,
    adminPriceFloorPYG: item.floor,
    marketEstimatePYG: Math.round((item.marketLow + item.marketHigh) / 2),
    recommendedFastSalePricePYG: item.fast,
    pricingConfidence: item.confidence,
    pricingResearch: item.research,
    internalNotes: item.flag ? `DECISIÓN DEL VENDEDOR: ${item.flag}` : item.sellerConfirmedFields?.length
      ? `SELLER_CONFIRMED: ${item.sellerConfirmedFields.join(', ')}. Lote privado ${PHASE2_BATCH_ID}.`
      : `Lote privado ${PHASE2_BATCH_ID}. Foto revisada: sin contenido privado visible.`,
    holdExpiresAt: null,
  };
}

function volume2Product(item: Volume2BatchItem): AdminProduct {
  return {
    id: item.id,
    itemNumber: item.itemNumber,
    slug: `${slugify(item.title)}-item-${String(item.itemNumber).padStart(3, '0')}`,
    title: item.title,
    category: item.category,
    tags: [item.category.toLowerCase(), 'venta de mudanza', 'volumen 2'],
    description: item.description,
    condition: item.condition,
    conditionNotes: item.conditionNotes,
    knownDefects: item.knownDefects,
    images: item.photos.map((_, index) => `/api/media/${item.id}/${index}`),
    askingPricePYG: item.asking,
    originalPricePYG: null,
    saleMode: item.saleMode,
    pickupAvailableDate: item.pickupDate,
    pickupWindowStart: item.pickupWindowStart,
    pickupWindowEnd: item.pickupWindowEnd,
    depositPercent: item.saleMode === 'DELAYED' ? 25 : 100,
    requiresVehicle: item.requiresVehicle,
    requiresLoadingHelp: item.requiresLoadingHelp,
    logisticsNotes: [item.requiresVehicle ? 'Requiere vehículo adecuado.' : '', item.requiresLoadingHelp ? 'El comprador debe traer ayuda para cargar.' : ''].filter(Boolean),
    includedAccessories: item.includedAccessories,
    sellerConfirmedFields: [],
    status: 'NEEDS_REVIEW',
    featured: false,
    dateListed: '2026-09-21',
    lastPriceChange: null,
    isDemo: false,
    needsReview: true,
    adminPriceFloorPYG: item.floor,
    marketEstimatePYG: Math.round((item.marketLow + item.marketHigh) / 2),
    recommendedFastSalePricePYG: item.fast,
    pricingConfidence: item.confidence,
    pricingResearch: item.research,
    internalNotes: `VOLUME 2 | PENDING REVIEW | ${item.quantityStructure} | MEDIDAS: ${item.measurements} | NO INCLUIDO: ${item.notIncludedVisible} | REVISAR: ${item.flag}`,
    holdExpiresAt: null,
    quantityTotal: item.quantityTotal,
    quantityRemaining: item.quantityTotal,
    quantityHeld: 0,
    quantitySold: 0,
  };
}

async function ensureVolume2Batch(db: Database): Promise<void> {
  const revision = 'volume2-seed-2026-09-21-v1';
  const metaKey = 'volume2_seed_revision';
  const applied = await db.prepare('SELECT value FROM inventory_meta WHERE key = ?').bind(metaKey).first<{ value: string }>();
  if (applied?.value === revision) return;
  const now = Date.now();
  await db.prepare(`INSERT INTO inventory_batches (id, name, status, created_at, updated_at)
    VALUES (?, ?, 'NEEDS_REVIEW', ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`)
    .bind(VOLUME2_BATCH_ID, VOLUME2_BATCH_NAME, now, now).run();

  const existingRows = await db.prepare(`SELECT id, item_number FROM products
    WHERE item_number BETWEEN 58 AND 158 OR id LIKE 'real-202609-volume2-%'`).all<Row>();
  const existingById = new Map(existingRows.results.map((row) => [String(row.id), Number(row.item_number)]));
  const existingByItemNumber = new Map(existingRows.results.map((row) => [Number(row.item_number), String(row.id)]));
  const statements: D1PreparedStatement[] = [];

  for (const item of VOLUME2_BATCH_ITEMS) {
    const idAtItemNumber = existingByItemNumber.get(item.itemNumber);
    if (idAtItemNumber && idAtItemNumber !== item.id) {
      throw new Error(`El Item ${item.itemNumber} ya pertenece a otro registro; se detuvo el alta para no renumerar ni reutilizar IDs.`);
    }
    const itemNumberAtId = existingById.get(item.id);
    if (itemNumberAtId !== undefined && itemNumberAtId !== item.itemNumber) {
      throw new Error(`El registro ${item.id} ya usa el Item ${itemNumberAtId}; se detuvo el alta para no renumerar IDs.`);
    }
    if (itemNumberAtId !== undefined) continue;

    statements.push(productInsert(db, volume2Product(item), now));
    if (item.quantityTotal > 1) {
      statements.push(db.prepare('UPDATE products SET quantity_total = ?, quantity_remaining = ? WHERE id = ?')
        .bind(item.quantityTotal, item.quantityTotal, item.id));
    }
  }

  for (let index = 0; index < statements.length; index += 40) {
    await db.batch(statements.slice(index, index + 40));
  }
  await db.prepare(`INSERT INTO inventory_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(metaKey, revision, now).run();
}

export async function preparePhase2Batch(actor: ChangeActor): Promise<{ created: number; updated: number; total: number }> {
  const db = await ensureDatabase();
  const now = Date.now();
  const correctionRevision = 'seller-corrections-2026-08-30';
  const applied = await db.prepare('SELECT value FROM inventory_meta WHERE key = ?').bind('phase2_seller_revision').first<{ value: string }>();
  if (applied?.value === correctionRevision) return { created: 0, updated: 0, total: PHASE2_BATCH_ITEMS.length };
  await db.prepare(`INSERT INTO inventory_batches (id, name, status, created_at, updated_at)
    VALUES (?, ?, 'NEEDS_REVIEW', ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`)
    .bind(PHASE2_BATCH_ID, PHASE2_BATCH_NAME, now, now).run();
  let created = 0;
  let updated = 0;
  for (const item of PHASE2_BATCH_ITEMS) {
    const product = phase2Product(item);
    const exists = await db.prepare('SELECT * FROM products WHERE id = ?').bind(item.id).first<Row>();
    if (!exists) {
      await productInsert(db, product, now).run();
      created += 1;
      continue;
    }
    await db.prepare(`UPDATE products SET
      item_number = ?, slug = ?, title = ?, category = ?, tags_json = ?, description = ?, condition = ?,
      condition_notes = ?, known_defects = ?, images_json = ?, asking_price_pyg = ?, original_price_pyg = ?,
      sale_mode = ?, pickup_available_date = ?, pickup_window_start = ?, pickup_window_end = ?,
      deposit_percent = ?, requires_vehicle = ?, requires_loading_help = ?, logistics_notes_json = ?,
      included_accessories_json = ?, seller_confirmed_fields_json = ?, admin_price_floor_pyg = ?, market_estimate_pyg = ?,
      recommended_fast_sale_price_pyg = ?, pricing_confidence = ?, pricing_research = ?, internal_notes = ?,
      updated_at = ? WHERE id = ?`)
      .bind(product.itemNumber, product.slug, product.title, product.category, JSON.stringify(product.tags),
        product.description, product.condition, product.conditionNotes, product.knownDefects,
        JSON.stringify(product.images), product.askingPricePYG, product.originalPricePYG, product.saleMode,
        product.pickupAvailableDate, product.pickupWindowStart, product.pickupWindowEnd, product.depositPercent,
        product.requiresVehicle ? 1 : 0, product.requiresLoadingHelp ? 1 : 0,
        JSON.stringify(product.logisticsNotes), JSON.stringify(product.includedAccessories), JSON.stringify(product.sellerConfirmedFields ?? []), product.adminPriceFloorPYG,
        product.marketEstimatePYG, product.recommendedFastSalePricePYG, product.pricingConfidence,
        product.pricingResearch, product.internalNotes, now, product.id).run();
    const fieldsToAudit = [
      'title', 'category', 'description', 'condition', 'conditionNotes', 'knownDefects', 'askingPricePYG',
      'originalPricePYG', 'saleMode', 'pickupAvailableDate', 'pickupWindowStart', 'pickupWindowEnd',
      'depositPercent', 'requiresVehicle', 'requiresLoadingHelp', 'includedAccessories', 'adminPriceFloorPYG',
      'marketEstimatePYG', 'recommendedFastSalePricePYG', 'pricingConfidence', 'pricingResearch', 'internalNotes',
    ];
    for (const fieldName of fieldsToAudit) {
      const column = EDITABLE_COLUMNS[fieldName];
      if (!column) continue;
      const previousValue = auditValue(exists, fieldName, column);
      const productRecord = product as unknown as Record<string, unknown>;
      const newValue = productRecord[fieldName];
      if (JSON.stringify(previousValue) === JSON.stringify(newValue)) continue;
      await db.prepare(`INSERT INTO inventory_audit
        (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), product.id, product.itemNumber, fieldName, JSON.stringify(previousValue), JSON.stringify(newValue), actor.role, actor.email, now).run();
    }
    updated += 1;
  }
  await db.prepare(`UPDATE product_images SET product_id = ?, sort_order = 0
    WHERE product_id = ? AND original_filename = 'IMG_7685.JPG'`)
    .bind('real-20260828-52', 'real-20260828-09').run();
  await db.prepare('UPDATE products SET needs_review = 0 WHERE is_demo = 1').run();
  await db.prepare(`INSERT INTO inventory_meta (key, value, updated_at) VALUES ('phase2_seller_revision', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(correctionRevision, now).run();
  return { created, updated, total: PHASE2_BATCH_ITEMS.length };
}

export function resolveBatchPhoto(filename: string): { productId: string; sortOrder: number; expectedFilename: string; batchId: string } | null {
  const normalized = filename.toLowerCase();
  for (const [batchId, items] of [[PHASE2_BATCH_ID, PHASE2_BATCH_ITEMS], [VOLUME2_BATCH_ID, VOLUME2_BATCH_ITEMS]] as const) {
    for (const item of items) {
      const sortOrder = item.photos.findIndex((photo) => photo.toLowerCase() === normalized);
      if (sortOrder >= 0) return { productId: item.id, sortOrder, expectedFilename: item.photos[sortOrder], batchId };
    }
  }
  return null;
}

export const resolvePhase2Photo = resolveBatchPhoto;

export async function saveBatchProductImage(input: {
  productId: string; sortOrder: number; filename: string; contentType: string; objectKey: string;
}): Promise<void> {
  const db = await ensureDatabase();
  const item = [...PHASE2_BATCH_ITEMS, ...VOLUME2_BATCH_ITEMS].find((candidate) => candidate.id === input.productId);
  if (!item || item.photos[input.sortOrder] !== input.filename) throw new Error('La foto no pertenece a este lote.');
  await db.prepare(`INSERT INTO product_images (
      id, product_id, object_key, original_filename, content_type, sort_order, privacy_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'CLEARED', ?)
    ON CONFLICT(product_id, sort_order) DO UPDATE SET
      object_key = excluded.object_key,
      original_filename = excluded.original_filename,
      content_type = excluded.content_type,
      privacy_status = 'CLEARED'`)
    .bind(`${input.productId}-${input.sortOrder}`, input.productId, input.objectKey, input.filename,
      input.contentType, input.sortOrder, Date.now()).run();
}

export const savePhase2ProductImage = saveBatchProductImage;

export async function getProductImageRecord(productId: string, sortOrder: number): Promise<{
  objectKey: string; contentType: string; status: InventoryStatus; isDemo: boolean;
} | null> {
  const db = await ensureDatabase();
  const row = await db.prepare(`SELECT pi.object_key, pi.content_type, p.status, p.is_demo
    FROM product_images pi JOIN products p ON p.id = pi.product_id
    WHERE pi.product_id = ? AND pi.sort_order = ? AND pi.privacy_status = 'CLEARED'`)
    .bind(productId, sortOrder).first<Row>();
  return row ? { objectKey: String(row.object_key), contentType: String(row.content_type), status: String(row.status) as InventoryStatus, isDemo: Boolean(row.is_demo) } : null;
}

export async function replaceProductImageReference(input: {
  productId: string; sortOrder: number; filename: string; contentType: string; objectKey: string;
}, actor: ChangeActor): Promise<{ imageUrl: string }> {
  const db = await ensureDatabase();
  const product = await db.prepare('SELECT item_number, images_json FROM products WHERE id = ?')
    .bind(input.productId).first<Row>();
  if (!product) throw new Error('Artículo no encontrado.');
  const current = await db.prepare(`SELECT object_key, original_filename FROM product_images
    WHERE product_id = ? AND sort_order = ? AND privacy_status = 'CLEARED'`)
    .bind(input.productId, input.sortOrder).first<Row>();
  const images = jsonArray(product.images_json);
  if (input.sortOrder < 0 || input.sortOrder >= images.length) throw new Error('La posición de la foto no es válida.');
  const now = Date.now();
  const imageUrl = `/api/media/${input.productId}/${input.sortOrder}?v=${now}`;
  const previousUrl = images[input.sortOrder];
  images[input.sortOrder] = imageUrl;
  const imageStatement = current
    ? db.prepare(`UPDATE product_images SET object_key = ?, original_filename = ?, content_type = ?, privacy_status = 'CLEARED'
      WHERE product_id = ? AND sort_order = ?`)
      .bind(input.objectKey, input.filename, input.contentType, input.productId, input.sortOrder)
    : db.prepare(`INSERT INTO product_images
      (id, product_id, object_key, original_filename, content_type, sort_order, privacy_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'CLEARED', ?)`)
      .bind(crypto.randomUUID(), input.productId, input.objectKey, input.filename, input.contentType, input.sortOrder, now);
  await db.batch([
    imageStatement,
    db.prepare('UPDATE products SET images_json = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(images), now, input.productId),
    db.prepare(`INSERT INTO inventory_audit
      (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        crypto.randomUUID(), input.productId, product.item_number, `photo[${input.sortOrder}]`,
        JSON.stringify({ url: previousUrl, filename: current?.original_filename ?? null }),
        JSON.stringify({ url: imageUrl, filename: input.filename }), actor.role, actor.email, now,
      ),
  ]);
  return { imageUrl };
}

export async function addProductSecondaryImage(input: {
  productId: string; filename: string; contentType: string; objectKey: string;
}, actor: ChangeActor): Promise<{ imageUrl: string; sortOrder: number }> {
  const db = await ensureDatabase();
  const product = await db.prepare('SELECT item_number, images_json FROM products WHERE id = ?')
    .bind(input.productId).first<Row>();
  if (!product) throw new Error('Artículo no encontrado.');
  const images = jsonArray(product.images_json);
  if (images.length >= 12) throw new Error('Este artículo alcanzó el máximo de 12 fotos.');
  const hasPlaceholder = images.length === 1 && images[0] === '/photo-pending.svg';
  const sortOrder = hasPlaceholder ? 0 : images.length;
  const now = Date.now();
  const imageUrl = `/api/media/${input.productId}/${sortOrder}?v=${now}`;
  if (hasPlaceholder) images.splice(0, images.length, imageUrl); else images.push(imageUrl);
  await db.batch([
    db.prepare(`INSERT INTO product_images
      (id, product_id, object_key, original_filename, content_type, sort_order, privacy_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'CLEARED', ?)`)
      .bind(crypto.randomUUID(), input.productId, input.objectKey, input.filename, input.contentType, sortOrder, now),
    db.prepare('UPDATE products SET images_json = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(images), now, input.productId),
    db.prepare(`INSERT INTO inventory_audit
      (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        crypto.randomUUID(), input.productId, product.item_number, `photo[${sortOrder}]`, JSON.stringify(null),
        JSON.stringify({ url: imageUrl, filename: input.filename }), actor.role, actor.email, now,
      ),
  ]);
  return { imageUrl, sortOrder };
}

export async function approvePhase2Products(productIds: string[], actor: ChangeActor): Promise<number> {
  const ids = [...new Set(productIds)];
  if (ids.length !== 1) throw new Error('Aprobá un solo artículo por vez desde la revisión secuencial.');
  const db = await ensureDatabase();
  let approved = 0;
  const now = Date.now();
  for (const id of ids) {
    const item = [...PHASE2_BATCH_ITEMS, ...VOLUME2_BATCH_ITEMS].find((candidate) => candidate.id === id);
    const product = await db.prepare('SELECT item_number, status, needs_review FROM products WHERE id = ?').bind(id).first<Row>();
    if (!product) throw new Error('Artículo no encontrado.');
    if (String(product.status) !== 'NEEDS_REVIEW' && !Boolean(product.needs_review)) throw new Error('Este artículo ya no está pendiente de revisión.');
    const images = await db.prepare('SELECT COUNT(*) AS total FROM product_images WHERE product_id = ?').bind(id).first<{ total: number }>();
    if (item && Number(images?.total ?? 0) < item.photos.length) throw new Error(`Faltan fotos de “${item.title}”.`);
    const result = await db.prepare(`UPDATE products SET status = 'AVAILABLE', needs_review = 0, updated_at = ?
      WHERE id = ? AND (status = 'NEEDS_REVIEW' OR needs_review = 1)`).bind(now, id).run();
    approved += Number(result.meta.changes ?? 0);
    if (result.meta.changes) {
      await db.batch([
        db.prepare(`INSERT INTO inventory_audit (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
          VALUES (?, ?, ?, 'status', ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), id, product.item_number, JSON.stringify(product.status), JSON.stringify('AVAILABLE'), actor.role, actor.email, now),
        db.prepare(`INSERT INTO inventory_audit (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
          VALUES (?, ?, ?, 'needsReview', ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), id, product.item_number, JSON.stringify(Boolean(product.needs_review)), JSON.stringify(false), actor.role, actor.email, now),
      ]);
    }
  }
  const liveReal = await db.prepare(`SELECT COUNT(*) AS total FROM products WHERE is_demo = 0 AND status = 'AVAILABLE'`).first<{ total: number }>();
  if (realStorefrontEnabled() && Number(liveReal?.total ?? 0) >= 3) {
    await db.prepare(`UPDATE products SET status = 'UNLISTED', updated_at = ? WHERE is_demo = 1 AND status = 'AVAILABLE'`).bind(now).run();
  }
  const approvedItem = [...PHASE2_BATCH_ITEMS, ...VOLUME2_BATCH_ITEMS].find((candidate) => candidate.id === ids[0]);
  const batchId = VOLUME2_BATCH_ITEMS.some((candidate) => candidate.id === approvedItem?.id) ? VOLUME2_BATCH_ID : PHASE2_BATCH_ID;
  const batchIds = batchId === VOLUME2_BATCH_ID ? VOLUME2_BATCH_ITEMS.map((item) => item.id) : PHASE2_BATCH_ITEMS.map((item) => item.id);
  const placeholders = batchIds.map(() => '?').join(',');
  const pending = await db.prepare(`SELECT COUNT(*) AS total FROM products WHERE id IN (${placeholders}) AND status = 'NEEDS_REVIEW'`)
    .bind(...batchIds).first<{ total: number }>();
  await db.prepare('UPDATE inventory_batches SET status = ?, updated_at = ? WHERE id = ?')
    .bind(Number(pending?.total ?? 0) === 0 ? 'APPROVED' : 'PARTIALLY_APPROVED', now, batchId).run();
  return approved;
}

export async function listAdminOrders(): Promise<OrderSummary[]> {
  await releaseExpiredHolds();
  const db = await ensureDatabase();
  const rows = await db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all<Row>();
  const orders: OrderSummary[] = [];
  for (const row of rows.results) {
    const items = await db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at').bind(row.id).all<Row>();
    const payments = await db.prepare('SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at').bind(row.id).all<Row>();
    orders.push(mapOrder(row, items.results, payments.results));
  }
  return orders;
}

export async function dashboardStats(): Promise<Record<string, number>> {
  await releaseExpiredHolds();
  const db = await ensureDatabase();
  const product = await db.prepare(`SELECT
      SUM(MAX(0, quantity_remaining - quantity_held)) AS available,
      SUM(quantity_sold) AS sold,
      SUM(CASE WHEN needs_review = 1 THEN 1 ELSE 0 END) AS needs_review,
      SUM(CASE WHEN status = 'AVAILABLE' AND date_listed < date('now', '-30 days') THEN 1 ELSE 0 END) AS long_listed,
      SUM(CASE WHEN status = 'AVAILABLE' THEN asking_price_pyg * MAX(0, quantity_remaining - quantity_held) ELSE 0 END) AS available_value
    FROM products`).first<Row>();
  const itemStats = await db.prepare(`SELECT
      SUM(CASE WHEN item_status = 'RESERVED' THEN quantity ELSE 0 END) AS reserved,
      SUM(CASE WHEN item_status = 'PICKED_UP' THEN quantity ELSE 0 END) AS picked_up
    FROM order_items`).first<Row>();
  const money = await db.prepare(`SELECT
      SUM(CASE WHEN status NOT IN ('CANCELLED', 'EXPIRED') THEN confirmed_amount_pyg + balance_confirmed_amount_pyg ELSE 0 END) AS confirmed_received,
      SUM(CASE WHEN status NOT IN ('CANCELLED', 'EXPIRED') AND balance_later_pyg > 0 THEN confirmed_amount_pyg ELSE 0 END) AS deposits_received,
      SUM(CASE WHEN status IN ('PAYMENT_CONFIRMED', 'BALANCE_CONFIRMED', 'PICKED_UP') THEN balance_remaining_pyg ELSE 0 END) AS balances_due,
      SUM(CASE WHEN status IN ('PAYMENT_CONFIRMED', 'BALANCE_CONFIRMED', 'PICKED_UP') THEN total_value_pyg ELSE 0 END) AS committed_value,
      SUM(CASE WHEN status = 'PAYMENT_PENDING' THEN 1 ELSE 0 END) AS orders_awaiting_payment
    FROM orders`).first<Row>();
  return {
    available: Number(product?.available ?? 0), reserved: Number(itemStats?.reserved ?? 0), sold: Number(product?.sold ?? 0),
    pickedUp: Number(itemStats?.picked_up ?? 0), awaitingPayment: Number(money?.orders_awaiting_payment ?? 0),
    availableValue: Number(product?.available_value ?? 0), needsReview: Number(product?.needs_review ?? 0),
    longListed: Number(product?.long_listed ?? 0), confirmedReceived: Number(money?.confirmed_received ?? 0),
    depositsReceived: Number(money?.deposits_received ?? 0), balancesDue: Number(money?.balances_due ?? 0),
    pendingBalances: Number(money?.balances_due ?? 0), committedSalesValue: Number(money?.committed_value ?? 0),
    ordersAwaitingPayment: Number(money?.orders_awaiting_payment ?? 0),
  };
}

const EDITABLE_COLUMNS: Record<string, string> = {
  title: 'title', category: 'category', tags: 'tags_json', description: 'description', condition: 'condition',
  conditionNotes: 'condition_notes', knownDefects: 'known_defects', askingPricePYG: 'asking_price_pyg',
  originalPricePYG: 'original_price_pyg', saleMode: 'sale_mode', pickupAvailableDate: 'pickup_available_date',
  pickupWindowStart: 'pickup_window_start', pickupWindowEnd: 'pickup_window_end',
  logisticsNotes: 'logistics_notes_json', includedAccessories: 'included_accessories_json',
  depositPercent: 'deposit_percent', requiresVehicle: 'requires_vehicle', requiresLoadingHelp: 'requires_loading_help',
  status: 'status', featured: 'featured', needsReview: 'needs_review', adminPriceFloorPYG: 'admin_price_floor_pyg',
  marketEstimatePYG: 'market_estimate_pyg', recommendedFastSalePricePYG: 'recommended_fast_sale_price_pyg',
  pricingConfidence: 'pricing_confidence', pricingResearch: 'pricing_research', internalNotes: 'internal_notes',
};

type ChangeActor = { role: AdminRole; email: string };

function auditValue(row: Row, key: string, column: string): unknown {
  const value = row[column];
  if (['tags', 'logisticsNotes', 'includedAccessories'].includes(key)) return jsonArray(value);
  if (['requiresVehicle', 'requiresLoadingHelp', 'featured', 'needsReview'].includes(key)) return Boolean(value);
  return value;
}

export async function updateAdminProduct(id: string, changes: Record<string, unknown>, actor: ChangeActor): Promise<AdminProduct> {
  const db = await ensureDatabase();
  const before = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Row>();
  if (!before) throw new Error('Artículo no encontrado.');
  const sets: string[] = [];
  const values: unknown[] = [];
  const auditStatements: D1PreparedStatement[] = [];
  const confirmedFields = new Set(jsonArray(before.seller_confirmed_fields_json));
  const now = Date.now();
  for (const [key, value] of Object.entries(changes)) {
    const column = EDITABLE_COLUMNS[key];
    if (!column) continue;
    const previous = auditValue(before, key, column);
    const semanticNext = semanticProductChangeValue(key, value);
    if (!productChangeHasDifference(key, previous, value)) continue;
    sets.push(`${column} = ?`);
    values.push(storedProductChangeValue(key, value));
    confirmedFields.add(key);
    auditStatements.push(db.prepare(`INSERT INTO inventory_audit
      (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), id, before.item_number, key, JSON.stringify(previous), JSON.stringify(semanticNext), actor.role, actor.email, now));
  }
  if (!sets.length) throw new Error('No hay cambios válidos.');
  sets.push('seller_confirmed_fields_json = ?', 'updated_at = ?');
  values.push(JSON.stringify([...confirmedFields].sort()), now, id);
  await db.batch([db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...values), ...auditStatements]);
  const row = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Row>();
  if (!row) throw new Error('Artículo no encontrado.');
  return mapAdminProduct(row);
}

export async function listInventoryAudit(limit = 100): Promise<InventoryAuditEntry[]> {
  const db = await ensureDatabase();
  const result = await db.prepare('SELECT * FROM inventory_audit ORDER BY created_at DESC LIMIT ?').bind(Math.min(Math.max(limit, 1), 500)).all<Row>();
  return result.results.map((row) => ({
    id: String(row.id), productId: String(row.product_id), itemNumber: row.item_number == null ? null : Number(row.item_number),
    fieldName: String(row.field_name), previousValue: JSON.parse(String(row.previous_value_json ?? 'null')),
    newValue: JSON.parse(String(row.new_value_json ?? 'null')), actorRole: String(row.actor_role) as AdminRole,
    actorEmail: String(row.actor_email), createdAt: Number(row.created_at),
  }));
}

export async function listOrderAudit(limit = 100): Promise<OrderAuditEntry[]> {
  const db = await ensureDatabase();
  const result = await db.prepare('SELECT * FROM order_audit ORDER BY created_at DESC LIMIT ?').bind(Math.min(Math.max(limit, 1), 500)).all<Row>();
  return result.results.map((row) => ({
    id: String(row.id), orderId: String(row.order_id), orderReference: String(row.order_reference),
    eventType: String(row.event_type), details: JSON.parse(String(row.details_json ?? '{}')) as Record<string, unknown>,
    actorRole: String(row.actor_role) as AdminRole, actorEmail: String(row.actor_email), createdAt: Number(row.created_at),
  }));
}

export async function listProductInventoryAudit(productId: string, limit = 25): Promise<InventoryAuditEntry[]> {
  const db = await ensureDatabase();
  const result = await db.prepare(`SELECT * FROM inventory_audit
    WHERE product_id = ? AND field_name != '__snapshot_restore__'
    ORDER BY created_at DESC LIMIT ?`)
    .bind(productId, Math.min(Math.max(limit, 1), 100)).all<Row>();
  return result.results.map((row) => ({
    id: String(row.id), productId: String(row.product_id), itemNumber: row.item_number == null ? null : Number(row.item_number),
    fieldName: String(row.field_name), previousValue: JSON.parse(String(row.previous_value_json ?? 'null')),
    newValue: JSON.parse(String(row.new_value_json ?? 'null')), actorRole: String(row.actor_role) as AdminRole,
    actorEmail: String(row.actor_email), createdAt: Number(row.created_at),
  }));
}

export async function revertInventoryAudit(auditId: string, actor: ChangeActor): Promise<AdminProduct> {
  const db = await ensureDatabase();
  const audit = await db.prepare('SELECT * FROM inventory_audit WHERE id = ?').bind(auditId).first<Row>();
  if (!audit) throw new Error('Cambio no encontrado.');
  const fieldName = String(audit.field_name);
  if (!EDITABLE_COLUMNS[fieldName]) throw new Error('Este cambio no admite reversión individual.');
  const previousValue = JSON.parse(String(audit.previous_value_json ?? 'null'));
  return updateAdminProduct(String(audit.product_id), { [fieldName]: previousValue }, actor);
}

const SNAPSHOT_LABEL = 'PRE-WIFE-REVIEW — 2026-08-30';
const SNAPSHOT_PRODUCT_COLUMNS = [
  'id', 'item_number', 'slug', 'title', 'category', 'tags_json', 'description', 'condition', 'condition_notes', 'known_defects',
  'images_json', 'asking_price_pyg', 'original_price_pyg', 'sale_mode', 'pickup_available_date', 'pickup_window_start',
  'pickup_window_end', 'deposit_percent', 'requires_vehicle', 'requires_loading_help', 'logistics_notes_json',
  'included_accessories_json', 'seller_confirmed_fields_json', 'status', 'featured', 'date_listed', 'last_price_change',
  'needs_review', 'admin_price_floor_pyg', 'market_estimate_pyg', 'recommended_fast_sale_price_pyg', 'pricing_confidence',
  'pricing_research', 'internal_notes', 'is_demo', 'hold_token', 'hold_expires_at', 'created_at', 'updated_at',
] as const;
const SNAPSHOT_IMAGE_COLUMNS = ['id', 'product_id', 'object_key', 'original_filename', 'content_type', 'sort_order', 'privacy_status', 'created_at'] as const;

export async function createPreWifeReviewSnapshot(ownerEmail: string): Promise<InventorySnapshotSummary> {
  const db = await ensureDatabase();
  const existing = await db.prepare('SELECT * FROM inventory_snapshots WHERE label = ?').bind(SNAPSHOT_LABEL).first<Row>();
  if (existing) return mapSnapshotSummary(existing);
  const products = await db.prepare('SELECT * FROM products WHERE is_demo = 0 ORDER BY item_number').all<Row>();
  if (products.results.length !== 53) throw new Error(`Se esperaban 53 artículos reales y se encontraron ${products.results.length}.`);
  const images = await db.prepare(`SELECT product_images.* FROM product_images
    JOIN products ON products.id = product_images.product_id WHERE products.is_demo = 0
    ORDER BY products.item_number, product_images.sort_order`).all<Row>();
  const payload = { schemaVersion: 1, label: SNAPSHOT_LABEL, products: products.results, productImages: images.results };
  const now = Date.now();
  const id = 'snapshot-pre-wife-review-2026-08-30';
  await db.prepare(`INSERT INTO inventory_snapshots
    (id, label, payload_json, product_count, image_count, created_by_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, SNAPSHOT_LABEL, JSON.stringify(payload), products.results.length, images.results.length, ownerEmail, now).run();
  return { id, label: SNAPSHOT_LABEL, productCount: products.results.length, imageCount: images.results.length, createdAt: now, createdByEmail: ownerEmail };
}

function mapSnapshotSummary(row: Row): InventorySnapshotSummary {
  return { id: String(row.id), label: String(row.label), productCount: Number(row.product_count), imageCount: Number(row.image_count), createdAt: Number(row.created_at), createdByEmail: String(row.created_by_email) };
}

export async function listInventorySnapshots(): Promise<InventorySnapshotSummary[]> {
  const db = await ensureDatabase();
  const result = await db.prepare('SELECT id, label, product_count, image_count, created_by_email, created_at FROM inventory_snapshots ORDER BY created_at DESC').all<Row>();
  return result.results.map(mapSnapshotSummary);
}

export async function restoreInventorySnapshot(snapshotId: string, confirmation: string, actor: ChangeActor): Promise<InventorySnapshotSummary> {
  if (confirmation !== SNAPSHOT_LABEL) throw new Error(`Escribí exactamente “${SNAPSHOT_LABEL}” para confirmar.`);
  const db = await ensureDatabase();
  const row = await db.prepare('SELECT * FROM inventory_snapshots WHERE id = ?').bind(snapshotId).first<Row>();
  if (!row) throw new Error('Snapshot no encontrado.');
  const payload = JSON.parse(String(row.payload_json)) as { products: Row[]; productImages: Row[] };
  const statements: D1PreparedStatement[] = [];
  const productUpdates = SNAPSHOT_PRODUCT_COLUMNS.filter((column) => column !== 'id');
  for (const product of payload.products) {
    statements.push(db.prepare(`INSERT INTO products (${SNAPSHOT_PRODUCT_COLUMNS.join(', ')}) VALUES (${SNAPSHOT_PRODUCT_COLUMNS.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${productUpdates.map((column) => `${column} = excluded.${column}`).join(', ')}`)
      .bind(...SNAPSHOT_PRODUCT_COLUMNS.map((column) => product[column] ?? null)));
    statements.push(db.prepare(`INSERT INTO inventory_audit
      (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
      VALUES (?, ?, ?, '__snapshot_restore__', ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), product.id, product.item_number, JSON.stringify('current state'), JSON.stringify(String(row.label)), actor.role, actor.email, Date.now()));
  }
  for (const image of payload.productImages) {
    const updates = SNAPSHOT_IMAGE_COLUMNS.filter((column) => column !== 'id');
    statements.push(db.prepare(`INSERT INTO product_images (${SNAPSHOT_IMAGE_COLUMNS.join(', ')}) VALUES (${SNAPSHOT_IMAGE_COLUMNS.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${updates.map((column) => `${column} = excluded.${column}`).join(', ')}`)
      .bind(...SNAPSHOT_IMAGE_COLUMNS.map((column) => image[column] ?? null)));
  }
  await db.batch(statements);
  return mapSnapshotSummary(row);
}

function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
}

export async function addAdminProduct(input: Record<string, unknown>): Promise<AdminProduct> {
  const db = await ensureDatabase();
  const title = String(input.title ?? '').trim();
  if (!title) throw new Error('El nombre del artículo es obligatorio.');
  const maxItem = await db.prepare('SELECT MAX(item_number) AS max_item FROM products').first<{ max_item: number | null }>();
  const nextItemNumber = Math.max(0, Number(maxItem?.max_item ?? 0)) + 1;
  if (nextItemNumber > 999) throw new Error('Se alcanzó el límite visible de Item IDs.');
  const id = `real-${crypto.randomUUID()}`;
  const baseSlug = slugify(title) || 'articulo';
  const product: AdminProduct = {
    id, itemNumber: nextItemNumber, slug: `${baseSlug}-${id.slice(-6)}`, title, category: String(input.category || 'Varios'),
    tags: [], description: String(input.description || 'Descripción pendiente.'), condition: String(input.condition || 'A revisar'),
    conditionNotes: String(input.conditionNotes || ''), knownDefects: String(input.knownDefects || 'A confirmar.'),
    images: [String(input.image || 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1000&h=760&q=82')],
    askingPricePYG: Number(input.askingPricePYG || 0), originalPricePYG: null,
    saleMode: input.saleMode === 'DELAYED' ? 'DELAYED' : 'IMMEDIATE',
    pickupAvailableDate: input.saleMode === 'DELAYED' ? '2026-11-27' : null,
    pickupWindowStart: input.saleMode === 'DELAYED' ? '2026-11-27' : null, pickupWindowEnd: input.saleMode === 'DELAYED' ? '2026-11-29' : null,
    depositPercent: input.saleMode === 'DELAYED' ? Number(input.depositPercent || 25) : 100,
    requiresVehicle: Boolean(input.requiresVehicle), requiresLoadingHelp: Boolean(input.requiresLoadingHelp),
    logisticsNotes: [], includedAccessories: [], sellerConfirmedFields: ['title', 'category', 'description', 'condition', 'askingPricePYG', 'saleMode'], status: 'NEEDS_REVIEW',
    featured: false, dateListed: new Date().toISOString().slice(0, 10), lastPriceChange: null, isDemo: false,
    needsReview: true, adminPriceFloorPYG: input.adminPriceFloorPYG ? Number(input.adminPriceFloorPYG) : null,
    marketEstimatePYG: null, recommendedFastSalePricePYG: null, pricingConfidence: 'Pendiente',
    pricingResearch: 'Sin investigación todavía.', internalNotes: String(input.internalNotes || 'SELLER_CONFIRMED: alta manual por el propietario.'), holdExpiresAt: null,
  };
  await db.batch([productInsert(db, product), db.prepare('PRAGMA optimize')]);
  return product;
}

type OrderActor = { role: AdminRole; email: string };
type PaymentInput = { amountReceived?: unknown; paymentMethod?: unknown };

function paymentAmount(value: unknown): number {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Ingresá un importe recibido válido.');
  return amount;
}

function paymentMethod(value: unknown): string {
  const method = String(value ?? '').trim();
  if (!method) throw new Error('Seleccioná el medio de pago.');
  return method.slice(0, 40);
}

function orderAuditStatement(db: Database, order: Row, eventType: string, details: Record<string, unknown>, actor: OrderActor, now: number): D1PreparedStatement {
  return db.prepare(`INSERT INTO order_audit
    (id, order_id, order_reference, event_type, details_json, actor_role, actor_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), order.id, order.reference, eventType, JSON.stringify(details), actor.role, actor.email, now,
  );
}

function productStatusAuditStatement(db: Database, product: Row, previous: string, next: string, actor: OrderActor, now: number): D1PreparedStatement {
  return db.prepare(`INSERT INTO inventory_audit
    (id, product_id, item_number, field_name, previous_value_json, new_value_json, actor_role, actor_email, created_at)
    VALUES (?, ?, ?, 'order_status', ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), product.id, product.item_number, JSON.stringify(previous), JSON.stringify(next), actor.role, actor.email, now,
  );
}

export async function adminOrderAction(orderId: string, action: string, input: PaymentInput = {}, actor: OrderActor = { role: 'OWNER', email: 'owner' }): Promise<OrderSummary> {
  const db = await ensureDatabase();
  const row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<Row>();
  if (!row) throw new Error('Pedido no encontrado.');
  const itemsResult = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all<Row>();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const status = String(row.status);
  const balanceLater = Number(row.balance_remaining_pyg ?? row.balance_later_pyg ?? 0);

  if (action === 'confirm_payment') {
    if (status !== 'PAYMENT_PENDING') throw new Error('Este pedido ya no está pendiente de verificación.');
    const expected = Math.max(0, Number(row.due_now_pyg) - Number(row.confirmed_amount_pyg ?? 0));
    const amount = paymentAmount(input.amountReceived);
    const method = paymentMethod(input.paymentMethod);
    if (amount > expected) throw new Error(`El importe no puede superar el pendiente de ${expected.toLocaleString('es-PY')} Gs.`);
    const confirmed = Number(row.confirmed_amount_pyg ?? 0) + amount;
    statements.push(db.prepare(`INSERT INTO order_payments
      (id, order_id, payment_type, amount_pyg, method, received_at, actor_role, actor_email, created_at)
      VALUES (?, ?, 'INITIAL', ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), orderId, amount, method, now, actor.role, actor.email, now));
    if (confirmed < Number(row.due_now_pyg)) {
      statements.push(db.prepare(`UPDATE orders SET confirmed_amount_pyg = ?, payment_method = ?, updated_at = ? WHERE id = ?`).bind(confirmed, method, now, orderId));
      statements.push(orderAuditStatement(db, row, 'PAYMENT_PARTIAL', { paymentType: 'INITIAL', amountPYG: amount, confirmedAmountPYG: confirmed, pendingPYG: Number(row.due_now_pyg) - confirmed, method }, actor, now));
    } else {
      for (const item of itemsResult.results) {
        const next = item.sale_mode === 'DELAYED' ? 'RESERVED' : 'SOLD';
        const quantity = Number(item.quantity ?? 1);
        const product = await db.prepare('SELECT id, item_number, status FROM products WHERE id = ?').bind(item.product_id).first<Row>();
        if (!product) throw new Error('Uno de los artículos del pedido ya no existe.');
        statements.push(db.prepare(`UPDATE products SET quantity_held = MAX(0, quantity_held - ?),
          quantity_remaining = MAX(0, quantity_remaining - ?),
          quantity_sold = quantity_sold + CASE WHEN ? = 'SOLD' THEN ? ELSE 0 END,
          status = CASE WHEN quantity_remaining - ? <= 0 THEN ? ELSE 'AVAILABLE' END,
          hold_token = NULL, hold_expires_at = NULL, updated_at = ? WHERE id = ?`)
          .bind(quantity, quantity, next, quantity, quantity, next, now, item.product_id));
        statements.push(db.prepare('UPDATE order_items SET item_status = ? WHERE id = ?').bind(next, item.id));
        statements.push(productStatusAuditStatement(db, product, String(product.status), next, actor, now));
      }
      statements.push(db.prepare(`UPDATE orders SET status = 'PAYMENT_CONFIRMED', confirmed_amount_pyg = ?, payment_method = ?, payment_confirmed_at = ?, updated_at = ? WHERE id = ?`).bind(confirmed, method, now, now, orderId));
      statements.push(orderAuditStatement(db, row, 'PAYMENT_CONFIRMED', { paymentType: 'INITIAL', amountPYG: amount, confirmedAmountPYG: confirmed, method, itemStatuses: itemsResult.results.map((item) => ({ itemId: item.id, status: item.sale_mode === 'DELAYED' ? 'RESERVED' : 'SOLD' })) }, actor, now));
    }
  } else if (action === 'confirm_balance') {
    if (status !== 'PAYMENT_CONFIRMED' || balanceLater <= 0) throw new Error('Este pedido no tiene un saldo pendiente confirmable.');
    const amount = paymentAmount(input.amountReceived);
    const method = paymentMethod(input.paymentMethod);
    if (amount > balanceLater) throw new Error(`El importe no puede superar el saldo pendiente de ${balanceLater.toLocaleString('es-PY')} Gs.`);
    const remaining = balanceLater - amount;
    statements.push(db.prepare(`INSERT INTO order_payments
      (id, order_id, payment_type, amount_pyg, method, received_at, actor_role, actor_email, created_at)
      VALUES (?, ?, 'BALANCE', ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), orderId, amount, method, now, actor.role, actor.email, now));
    if (remaining === 0) {
      for (const item of itemsResult.results) {
        if (String(item.item_status) !== 'RESERVED') continue;
        const quantity = Number(item.quantity ?? 1);
        const product = await db.prepare('SELECT id, item_number, status FROM products WHERE id = ?').bind(item.product_id).first<Row>();
        if (!product) throw new Error('Uno de los artículos del pedido ya no existe.');
        statements.push(db.prepare(`UPDATE products SET quantity_sold = quantity_sold + ?,
          status = CASE WHEN quantity_remaining <= 0 THEN 'SOLD' ELSE 'AVAILABLE' END, updated_at = ? WHERE id = ?`).bind(quantity, now, item.product_id));
        statements.push(db.prepare(`UPDATE order_items SET item_status = 'SOLD' WHERE id = ?`).bind(item.id));
        statements.push(productStatusAuditStatement(db, product, 'RESERVED', 'SOLD', actor, now));
      }
    }
    statements.push(db.prepare(`UPDATE orders SET status = ?, balance_remaining_pyg = ?, balance_confirmed_amount_pyg = balance_confirmed_amount_pyg + ?, balance_payment_method = ?, balance_confirmed_at = CASE WHEN ? = 0 THEN ? ELSE balance_confirmed_at END, updated_at = ? WHERE id = ?`)
      .bind(remaining === 0 ? 'BALANCE_CONFIRMED' : 'PAYMENT_CONFIRMED', remaining, amount, method, remaining, now, now, orderId));
    statements.push(orderAuditStatement(db, row, remaining === 0 ? 'BALANCE_CONFIRMED' : 'BALANCE_PARTIAL', { paymentType: 'BALANCE', amountPYG: amount, remainingPYG: remaining, method }, actor, now));
  } else if (action === 'release') {
    if (!['TEMPORARY_HOLD', 'PAYMENT_PENDING'].includes(status) && !(status === 'PAYMENT_CONFIRMED' && balanceLater > 0)) {
      throw new Error('Este pedido ya no se puede liberar.');
    }
    for (const item of itemsResult.results) {
      const quantity = Number(item.quantity ?? 1);
      const soldQuantity = String(item.item_status) === 'SOLD' ? quantity : 0;
      const product = await db.prepare('SELECT id, item_number, status FROM products WHERE id = ?').bind(item.product_id).first<Row>();
      if (!product) continue;
      statements.push(db.prepare(`UPDATE products SET quantity_held = CASE WHEN ? IN ('TEMPORARY_HOLD','PAYMENT_PENDING') THEN MAX(0, quantity_held - ?) ELSE quantity_held END,
        quantity_remaining = CASE WHEN ? IN ('PAYMENT_CONFIRMED','BALANCE_CONFIRMED') THEN quantity_remaining + ? ELSE quantity_remaining END,
        quantity_sold = MAX(0, quantity_sold - ?), status = 'AVAILABLE', hold_token = NULL, hold_expires_at = NULL, updated_at = ? WHERE id = ?`)
        .bind(status, quantity, status, quantity, soldQuantity, now, item.product_id));
      statements.push(db.prepare(`UPDATE order_items SET item_status = 'AVAILABLE' WHERE id = ?`).bind(item.id));
      statements.push(productStatusAuditStatement(db, product, String(product.status), 'AVAILABLE', actor, now));
    }
    statements.push(db.prepare(`UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).bind(now, orderId));
    statements.push(orderAuditStatement(db, row, 'ORDER_CANCELLED', { previousStatus: status }, actor, now));
  } else if (action === 'picked_up') {
    if (!(status === 'BALANCE_CONFIRMED' || (status === 'PAYMENT_CONFIRMED' && balanceLater === 0))) {
      throw new Error('Confirmá primero todo el dinero correspondiente.');
    }
    for (const item of itemsResult.results) {
      statements.push(db.prepare(`UPDATE products SET status = 'PICKED_UP', updated_at = ? WHERE id = ? AND status = 'SOLD'`).bind(now, item.product_id));
      statements.push(db.prepare(`UPDATE order_items SET item_status = 'PICKED_UP' WHERE id = ? AND item_status = 'SOLD'`).bind(item.id));
    }
    statements.push(db.prepare(`UPDATE orders SET status = 'PICKED_UP', updated_at = ? WHERE id = ?`).bind(now, orderId));
    statements.push(orderAuditStatement(db, row, 'PICKED_UP', {}, actor, now));
  } else if (action === 'mark_payment_pending') {
    if (status !== 'TEMPORARY_HOLD') throw new Error('Este pedido ya no está en retención temporal.');
    statements.push(db.prepare(`UPDATE orders SET status = 'PAYMENT_PENDING', hold_expires_at = NULL, updated_at = ? WHERE id = ?`).bind(now, orderId));
    for (const item of itemsResult.results) {
      statements.push(db.prepare(`UPDATE products SET status = CASE WHEN quantity_total = 1 THEN 'PAYMENT_PENDING' ELSE status END, hold_expires_at = CASE WHEN quantity_total = 1 THEN NULL ELSE hold_expires_at END, updated_at = ? WHERE id = ?`).bind(now, item.product_id));
      statements.push(db.prepare(`UPDATE order_items SET item_status = 'PAYMENT_PENDING' WHERE id = ?`).bind(item.id));
    }
    statements.push(orderAuditStatement(db, row, 'PAYMENT_PENDING', {}, actor, now));
  } else {
    throw new Error('Acción no válida.');
  }
  await db.batch(statements);
  const updated = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<Row>();
  const updatedItems = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all<Row>();
  const updatedPayments = await db.prepare('SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at').bind(orderId).all<Row>();
  return mapOrder(updated!, updatedItems.results, updatedPayments.results);
}

export async function createDirectSale(input: {
  items: Array<{ productId: string; quantity: number }>;
  buyerName?: string;
  buyerWhatsapp?: string;
  amountReceived: number;
  paymentMethod: string;
}, actor: OrderActor): Promise<OrderSummary> {
  const requested = [...new Map(input.items.map((item) => [item.productId, {
    productId: item.productId,
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
  }])).values()];
  if (!requested.length) throw new Error('Seleccioná al menos un artículo.');
  const amount = paymentAmount(input.amountReceived);
  const method = paymentMethod(input.paymentMethod);
  const db = await ensureDatabase();
  const now = Date.now();
  const entries: Array<{ row: Row; product: PublicProduct; quantity: number }> = [];
  for (const requestedItem of requested) {
    const row = await db.prepare(`SELECT ${PUBLIC_SELECT} FROM products WHERE id = ?`).bind(requestedItem.productId).first<Row>();
    if (!row) throw new Error('Uno de los artículos no existe.');
    const available = Number(row.quantity_remaining ?? 1) - Number(row.quantity_held ?? 0);
    if (available < requestedItem.quantity || ['SOLD', 'RESERVED', 'PICKED_UP', 'PAYMENT_PENDING', 'TEMPORARY_HOLD'].includes(String(row.status))) {
      throw new Error(`${String(row.title)} ya no está disponible para una venta directa.`);
    }
    entries.push({ row, product: mapPublicProduct(row), quantity: requestedItem.quantity });
  }
  const totals = entries.reduce((sum, entry) => {
    const due = dueNowForProduct(entry.product) * entry.quantity;
    sum.total += entry.product.askingPricePYG * entry.quantity;
    sum.due += due;
    sum.balance += entry.product.askingPricePYG * entry.quantity - due;
    return sum;
  }, { total: 0, due: 0, balance: 0 });
  if (amount !== totals.due) throw new Error(`Para estos artículos, el importe inicial esperado es ${totals.due.toLocaleString('es-PY')} Gs.`);

  const orderId = crypto.randomUUID();
  const holdToken = `direct-${crypto.randomUUID()}`;
  const reference = `DIR-${String(Date.now()).slice(-6)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO orders (
      id, reference, hold_token, order_source, status, buyer_name, buyer_whatsapp,
      pickup_acknowledged, delayed_pickup_acknowledged, deposit_terms_acknowledged,
      total_value_pyg, due_now_pyg, balance_later_pyg, balance_remaining_pyg,
      confirmed_amount_pyg, balance_confirmed_amount_pyg, payment_method,
      payment_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'DIRECT', 'PAYMENT_CONFIRMED', ?, ?, 1, 1, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
      .bind(orderId, reference, holdToken, String(input.buyerName ?? '').trim() || null, String(input.buyerWhatsapp ?? '').trim() || null,
        totals.total, totals.due, totals.balance, totals.balance, amount, method, now, now, now),
    db.prepare(`INSERT INTO order_payments
      (id, order_id, payment_type, amount_pyg, method, received_at, actor_role, actor_email, created_at)
      VALUES (?, ?, 'INITIAL', ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), orderId, amount, method, now, actor.role, actor.email, now),
  ];
  for (const entry of entries) {
    const next = entry.product.saleMode === 'DELAYED' ? 'RESERVED' : 'SOLD';
    const due = dueNowForProduct(entry.product) * entry.quantity;
    statements.push(db.prepare(`INSERT INTO order_items (
      id, order_id, product_id, item_number, product_slug, title_snapshot, image_snapshot, price_pyg,
      due_now_pyg, balance_later_pyg, sale_mode, deposit_percent, pickup_available_date,
      pickup_window_start, pickup_window_end, item_status, quantity, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), orderId, entry.product.id, entry.product.itemNumber, entry.product.slug, entry.product.title,
        entry.product.images[0] ?? '', entry.product.askingPricePYG, due,
        entry.product.askingPricePYG * entry.quantity - due, entry.product.saleMode, entry.product.depositPercent,
        entry.product.pickupAvailableDate, entry.product.pickupWindowStart, entry.product.pickupWindowEnd, next, entry.quantity, now));
    statements.push(db.prepare(`UPDATE products SET quantity_remaining = MAX(0, quantity_remaining - ?),
      quantity_sold = quantity_sold + CASE WHEN ? = 'SOLD' THEN ? ELSE 0 END,
      status = CASE WHEN quantity_remaining - ? <= 0 THEN ? ELSE 'AVAILABLE' END, updated_at = ? WHERE id = ?`)
      .bind(entry.quantity, next, entry.quantity, entry.quantity, next, now, entry.product.id));
    statements.push(productStatusAuditStatement(db, entry.row, String(entry.row.status), next, actor, now));
  }
  statements.push(orderAuditStatement(db, { id: orderId, reference }, 'DIRECT_SALE_CREATED', {
    amountPYG: amount, method, totalValuePYG: totals.total, balancePYG: totals.balance,
    itemCount: entries.reduce((sum, entry) => sum + entry.quantity, 0),
  }, actor, now));
  await db.batch(statements);
  const created = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<Row>();
  const items = await db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at').bind(orderId).all<Row>();
  const payments = await db.prepare('SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at').bind(orderId).all<Row>();
  return mapOrder(created!, items.results, payments.results);
}
