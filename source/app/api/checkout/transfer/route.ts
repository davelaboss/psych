import { NextResponse } from 'next/server';
import { declareTransfer } from '@/lib/database';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { orderId?: string; token?: string };
    const order = await declareTransfer(body.orderId ?? '', body.token ?? '');
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo confirmar.' }, { status: 400 });
  }
}
