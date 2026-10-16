import { NextResponse } from 'next/server';
import { getAuthorizedSeller } from '@/lib/admin-auth';
import { adminOrderAction } from '@/lib/database';

export async function POST(request: Request) {
  try {
    const seller = await getAuthorizedSeller();
    if (!seller) return NextResponse.json({ error: 'Acceso no autorizado.' }, { status: 403 });
    const body = await request.json() as { orderId?: string; action?: string; amountReceived?: unknown; paymentMethod?: unknown };
    const order = await adminOrderAction(body.orderId ?? '', body.action ?? '', {
      amountReceived: body.amountReceived, paymentMethod: body.paymentMethod,
    }, { role: 'OWNER', email: seller.email });
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo actualizar el pedido.' }, { status: 400 });
  }
}
