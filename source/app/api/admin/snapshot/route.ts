import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { dashboardStats, listAdminOrders, listAdminProducts } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ error: 'Acceso no autorizado.' }, { status: 403 });
    if (session.role === 'REVIEWER') {
      const products = await listAdminProducts();
      return NextResponse.json({
        stats: { needsReview: products.filter((product) => product.needsReview || product.status === 'NEEDS_REVIEW').length },
        orders: [], products, role: session.role,
      });
    }
    const [stats, orders, products] = await Promise.all([dashboardStats(), listAdminOrders(), listAdminProducts()]);
    return NextResponse.json({ stats, orders, products, role: session.role });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo cargar el panel.' }, { status: 500 });
  }
}
