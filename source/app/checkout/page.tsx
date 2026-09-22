import { CheckoutPage } from '@/components/checkout-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout por transferencia | Venta de Mudanza' };

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string; token?: string }> }) {
  const params = await searchParams;
  return <CheckoutPage orderId={params.id ?? ''} token={params.token ?? ''} />;
}
