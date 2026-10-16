import { NextResponse } from 'next/server';
import { getAuthorizedOwner } from '@/lib/admin-auth';
import { createPreWifeReviewSnapshot, listInventorySnapshots, restoreInventorySnapshot } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!await getAuthorizedOwner()) return NextResponse.json({ error: 'Acceso exclusivo del propietario.' }, { status: 403 });
    return NextResponse.json({ snapshots: await listInventorySnapshots() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudieron cargar los snapshots.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const owner = await getAuthorizedOwner();
    if (!owner) return NextResponse.json({ error: 'Acceso exclusivo del propietario.' }, { status: 403 });
    const body = await request.json().catch(() => ({})) as { action?: string; snapshotId?: string; confirmation?: string };
    if (body.action === 'create_pre_wife_review') return NextResponse.json({ snapshot: await createPreWifeReviewSnapshot(owner.email) });
    if (body.action === 'restore') return NextResponse.json({ snapshot: await restoreInventorySnapshot(body.snapshotId ?? '', body.confirmation ?? '', { role: 'OWNER', email: owner.email }) });
    return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo administrar el snapshot.' }, { status: 400 });
  }
}
