import { NextResponse } from 'next/server';
import { getAuthorizedOwner } from '@/lib/admin-auth';
import {
  createReviewerAccessCode,
  getReviewerAccessStatus,
  revokeAllReviewerSessions,
} from '@/lib/reviewer-access';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!await getAuthorizedOwner()) return NextResponse.json({ error: 'Acceso exclusivo del propietario.' }, { status: 403 });
    return NextResponse.json({ status: await getReviewerAccessStatus() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo cargar el acceso de revisor.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const owner = await getAuthorizedOwner();
    if (!owner) return NextResponse.json({ error: 'Acceso exclusivo del propietario.' }, { status: 403 });
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Solicitud no autorizada.' }, { status: 403 });
    const body = await request.json().catch(() => ({})) as { action?: string };
    if (body.action === 'generate_code') {
      return NextResponse.json({ accessCode: await createReviewerAccessCode(owner.email) });
    }
    if (body.action === 'revoke_sessions') {
      const revokedCount = await revokeAllReviewerSessions();
      return NextResponse.json({ ok: true, revokedCount });
    }
    return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo administrar el acceso.' }, { status: 400 });
  }
}
