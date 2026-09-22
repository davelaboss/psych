import { NextResponse } from 'next/server';
import { getAdminSession, getAuthorizedOwner } from '@/lib/admin-auth';
import { addAdminProduct, updateAdminProduct } from '@/lib/database';

export async function POST(request: Request) {
  try {
    if (!await getAuthorizedOwner()) return NextResponse.json({ error: 'Acceso exclusivo del propietario.' }, { status: 403 });
    const product = await addAdminProduct(await request.json() as Record<string, unknown>);
    return NextResponse.json({ product });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo crear el artículo.' }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ error: 'Acceso no autorizado.' }, { status: 403 });
    const body = await request.json() as { id?: string; changes?: Record<string, unknown> };
    const changes = body.changes ?? {};
    if (session.role === 'REVIEWER') {
      const reviewerFields = new Set([
        'title', 'category', 'description', 'condition', 'conditionNotes', 'knownDefects', 'askingPricePYG',
        'saleMode', 'pickupAvailableDate', 'pickupWindowStart', 'pickupWindowEnd', 'depositPercent',
        'tags', 'logisticsNotes', 'includedAccessories', 'requiresVehicle', 'requiresLoadingHelp', 'internalNotes',
      ]);
      if (Object.keys(changes).some((field) => !reviewerFields.has(field))) {
        return NextResponse.json({ error: 'Ese campo es exclusivo del propietario.' }, { status: 403 });
      }
    }
    const product = await updateAdminProduct(body.id ?? '', changes, { role: session.role, email: session.user.email });
    return NextResponse.json({ product });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo actualizar.' }, { status: 400 });
  }
}
