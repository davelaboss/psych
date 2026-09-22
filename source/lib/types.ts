export type InventoryStatus =
  | 'AVAILABLE'
  | 'TEMPORARY_HOLD'
  | 'PAYMENT_PENDING'
  | 'RESERVED'
  | 'SOLD'
  | 'PICKED_UP'
  | 'NEEDS_REVIEW'
  | 'UNLISTED';

export type SaleMode = 'IMMEDIATE' | 'DELAYED';

export type PublicProduct = {
  id: string;
  itemNumber: number | null;
  slug: string;
  title: string;
  category: string;
  tags: string[];
  description: string;
  condition: string;
  conditionNotes: string;
  knownDefects: string;
  images: string[];
  askingPricePYG: number;
  originalPricePYG: number | null;
  saleMode: SaleMode;
  pickupAvailableDate: string | null;
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  depositPercent: number;
  requiresVehicle: boolean;
  requiresLoadingHelp: boolean;
  logisticsNotes: string[];
  includedAccessories: string[];
  sellerConfirmedFields?: string[];
  status: InventoryStatus;
  featured: boolean;
  dateListed: string;
  lastPriceChange: string | null;
  isDemo: boolean;
  quantityTotal?: number;
  quantityRemaining?: number;
  quantityHeld?: number;
  quantitySold?: number;
};

export type InventoryAuditEntry = {
  id: string;
  productId: string;
  itemNumber: number | null;
  fieldName: string;
  previousValue: unknown;
  newValue: unknown;
  actorRole: 'OWNER' | 'REVIEWER';
  actorEmail: string;
  createdAt: number;
};

export type InventorySnapshotSummary = {
  id: string;
  label: string;
  productCount: number;
  imageCount: number;
  createdAt: number;
  createdByEmail: string;
};

export type AdminProduct = PublicProduct & {
  needsReview: boolean;
  adminPriceFloorPYG: number | null;
  marketEstimatePYG: number | null;
  recommendedFastSalePricePYG: number | null;
  pricingConfidence: string | null;
  pricingResearch: string | null;
  internalNotes: string | null;
  holdExpiresAt: number | null;
  batchId?: string | null;
  reviewFlag?: string | null;
  marketLowPYG?: number | null;
  marketHighPYG?: number | null;
  expectedPhotoCount?: number;
  uploadedPhotoCount?: number;
};

export type OrderItem = {
  id: string;
  productId: string;
  itemNumber: number | null;
  slug: string;
  title: string;
  image: string;
  pricePYG: number;
  dueNowPYG: number;
  balanceLaterPYG: number;
  saleMode: SaleMode;
  depositPercent: number;
  pickupAvailableDate: string | null;
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  itemStatus: InventoryStatus;
  quantity: number;
};

export type OrderPayment = {
  id: string;
  paymentType: 'INITIAL' | 'BALANCE';
  amountPYG: number;
  method: string;
  receivedAt: number;
  actorEmail: string;
};

export type OrderAuditEntry = {
  id: string;
  orderId: string;
  orderReference: string;
  eventType: string;
  details: Record<string, unknown>;
  actorRole: 'OWNER' | 'REVIEWER' | 'BUYER' | 'SYSTEM';
  actorEmail: string;
  createdAt: number;
};

export type OrderSummary = {
  id: string;
  reference: string;
  source: 'ONLINE' | 'DIRECT';
  status: string;
  buyerName: string | null;
  buyerWhatsapp: string | null;
  buyerEmail: string | null;
  totalValuePYG: number;
  dueNowPYG: number;
  balanceLaterPYG: number;
  originalBalancePYG: number;
  confirmedAmountPYG: number;
  balanceConfirmedAmountPYG: number;
  paymentMethod: string | null;
  balancePaymentMethod: string | null;
  holdExpiresAt: number | null;
  transferDeclaredAt: number | null;
  paymentConfirmedAt: number | null;
  balanceConfirmedAt: number | null;
  createdAt: number;
  items: OrderItem[];
  payments: OrderPayment[];
};

export function formatPYG(value: number): string {
  return `Gs. ${new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(value)}`;
}

export function dueNowForProduct(product: Pick<PublicProduct, 'askingPricePYG' | 'saleMode' | 'depositPercent'>): number {
  return product.saleMode === 'IMMEDIATE'
    ? product.askingPricePYG
    : Math.round((product.askingPricePYG * product.depositPercent) / 100);
}

export function dueNowForQuantity(product: Pick<PublicProduct, 'askingPricePYG' | 'saleMode' | 'depositPercent'>, quantity: number): number {
  return dueNowForProduct(product) * quantity;
}

export function statusLabel(status: InventoryStatus): string {
  return {
    AVAILABLE: 'Disponible',
    TEMPORARY_HOLD: 'En proceso de compra',
    PAYMENT_PENDING: 'Pago a confirmar',
    RESERVED: 'Reservado',
    SOLD: 'Vendido',
    PICKED_UP: 'Retirado',
    NEEDS_REVIEW: 'Requiere revisión',
    UNLISTED: 'No publicado',
  }[status];
}

export function publicStatusLabel(status: InventoryStatus): string {
  return status === 'SOLD' || status === 'PICKED_UP' ? 'Vendido' : statusLabel(status);
}

export function formatPickupDate(value: string | null): string {
  if (!value) return 'Retiro inmediato';
  return new Intl.DateTimeFormat('es-PY', {
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Asuncion',
  }).format(new Date(`${value}T12:00:00-03:00`));
}

export function formatItemNumber(value: number | null): string {
  return value == null ? 'Muestra' : `Item ${String(value).padStart(3, '0')}`;
}

export function itemTitle(product: Pick<PublicProduct, 'itemNumber' | 'title'>): string {
  return product.itemNumber == null ? product.title : `${formatItemNumber(product.itemNumber)} — ${product.title}`;
}

export function formatPickupWindow(start: string | null, end: string | null, fallback: string | null = null): string {
  if (!start || !end) return formatPickupDate(fallback);
  const startDate = new Date(`${start}T12:00:00-03:00`);
  const endDate = new Date(`${end}T12:00:00-03:00`);
  const startDay = new Intl.DateTimeFormat('es-PY', { day: 'numeric', timeZone: 'America/Asuncion' }).format(startDate);
  const endLabel = new Intl.DateTimeFormat('es-PY', { day: 'numeric', month: 'long', timeZone: 'America/Asuncion' }).format(endDate);
  return `${startDay}–${endLabel}`;
}
