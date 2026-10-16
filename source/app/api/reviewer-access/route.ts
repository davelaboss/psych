import { NextResponse } from 'next/server';
import {
  exchangeReviewerCode,
  revokeCurrentReviewerSession,
  setReviewerSessionCookie,
} from '@/lib/reviewer-access';

export const dynamic = 'force-dynamic';

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Solicitud no autorizada.' }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({})) as { code?: string };
    const session = await exchangeReviewerCode(String(body.code ?? ''));
    await setReviewerSessionCookie(session.token, session.expiresAt);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo activar el acceso.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Solicitud no autorizada.' }, { status: 403 });
    await revokeCurrentReviewerSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo cerrar la sesión.' }, { status: 500 });
  }
}
