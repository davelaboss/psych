import { Storefront } from '@/components/storefront';
import { listPublicProducts } from '@/lib/database';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const products = await listPublicProducts();
  return <Storefront products={products} />;
}
