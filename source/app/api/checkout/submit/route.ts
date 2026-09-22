import { NextResponse } from 'next/server';
import { BANK_TRANSFER_PLACEHOLDERS } from '@/lib/config';
import { getOrderForBuyer, submitBuyerDetails } from '@/lib/database';

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = String(body.name ?? '').trim();
    const whatsapp = String(body.whatsapp ?? '').trim();
    const pickupAcknowledged = body.pickupAcknowledged === true;
    const delayedPickupAcknowledged = body.delayedPickupAcknowledged === true;
    const depositTermsAcknowledged = body.depositTermsAcknowledged === true;
    if (!name || !whatsapp) throw new Error('Completá tu nombre y número de WhatsApp.');
    if (!pickupAcknowledged || !depositTermsAcknowledged) throw new Error('Confirmá las condiciones de retiro y reserva.');
    const existing = await getOrderForBuyer(String(body.orderId ?? ''), String(body.token ?? ''));
    if (!existing) throw new Error('Pedido no encontrado.');
    if (existing.items.some((item) => item.saleMode === 'DELAYED') && !delayedPickupAcknowledged) throw new Error('Confirmá que entendés las fechas de retiro posterior.');
    const order = await submitBuyerDetails({
      orderId: String(body.orderId ?? ''), token: String(body.token ?? ''), name, whatsapp,
      email: String(body.email ?? '').trim() || undefined, pickupAcknowledged,
      delayedPickupAcknowledged, depositTermsAcknowledged,
    });
    return NextResponse.json({ order, bank: BANK_TRANSFER_PLACEHOLDERS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo continuar.' }, { status: 400 });
  }
}
