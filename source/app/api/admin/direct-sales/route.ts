import { NextResponse } from 'next/server';
import { getAuthorizedSeller } from '@/lib/admin-auth';
import { createDirectSale } from '@/lib/database';

export async function POST(request: Request) {
  try {
    const seller = await getAuthorizedSeller();
    if (!seller) return NextResponse.json({ error: 'Acceso exclusivo del propietario.' }, { status: 403 });
    const body = await request.json() as {
      items?: Array<{ productId: string; quantity: number }>;
      buyerName?: string;
      buyerWhatsapp?: string;
      amountReceived?: number;
      paymentMethod?: string;
    };
    const order = await createDirectSale({
      items: Array.isArray(body.items) ? body.items : [],
      buyerName: body.buyerName,
      buyerWhatsapp: body.buyerWhatsapp,
      amountReceived: Number(body.amountReceived),
      paymentMethod: String(body.paymentMethod ?? ''),
    }, { role: 'OWNER', email: seller.email });
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo registrar la venta directa.' }, { status: 400 });
  }
}
