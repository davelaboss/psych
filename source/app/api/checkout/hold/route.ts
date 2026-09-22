import { NextResponse } from 'next/server';
import { createInventoryHold } from '@/lib/database';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { items?: Array<{ productId: string; quantity: number }> };
    const result = await createInventoryHold(Array.isArray(body.items) ? body.items : []);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo iniciar la compra.' }, { status: 409 });
  }
}
