import { NextResponse } from 'next/server';
import { getAuthorizedOwner } from '@/lib/admin-auth';
import { listInventoryAudit, listOrderAudit, revertInventoryAudit } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!await getAuthorizedOwner()) return NextResponse.json({ error: 'Acceso exclusivo del propietario.' }, { status: 403 });
    const [entries, orderEntries] = await Promise.all([listInventoryAudit(), listOrderAudit()]);
    return NextResponse.json({ entries, orderEntries });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo cargar el historial.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const owner = await getAuthorizedOwner();
    if (!owner) return NextResponse.json({ error: 'Acceso exclusivo del propietario.' }, { status: 403 });
    const body = await request.json() as { action?: string; auditId?: string };
    if (body.action !== 'revert') return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
    return NextResponse.json({ product: await revertInventoryAudit(body.auditId ?? '', { role: 'OWNER', email: owner.email }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo revertir el cambio.' }, { status: 400 });
  }
}
