import { NextRequest, NextResponse } from 'next/server';
import { getOrderForBuyer } from '@/lib/database';
import { BANK_TRANSFER_PLACEHOLDERS } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id') ?? '';
    const token = request.nextUrl.searchParams.get('token') ?? '';
    const order = await getOrderForBuyer(id, token);
    if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    return NextResponse.json({ order, bank: order.buyerName ? BANK_TRANSFER_PLACEHOLDERS : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo cargar el pedido.' }, { status: 500 });
  }
}
