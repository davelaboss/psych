import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { approvePhase2Products, preparePhase2Batch } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ error: 'Acceso no autorizado.' }, { status: 403 });
    const body = await request.json().catch(() => ({})) as { action?: string; productIds?: string[] };
    if (body.action === 'prepare') {
      if (session.role !== 'OWNER') return NextResponse.json({ error: 'Acción exclusiva del propietario.' }, { status: 403 });
      return NextResponse.json(await preparePhase2Batch({ role: 'OWNER', email: session.user.email }));
    }
    if (body.action === 'approve') {
      const approved = await approvePhase2Products(Array.isArray(body.productIds) ? body.productIds : [], { role: session.role, email: session.user.email });
      return NextResponse.json({ approved });
    }
    return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo actualizar el lote.' }, { status: 400 });
  }
}
