import { CartPage } from '@/components/cart-page';
import { HistoryScrollRestoration } from '@/components/history-scroll-restoration';

export const metadata = { title: 'Carrito | Venta de Mudanza' };

export default function Page() {
  return <><HistoryScrollRestoration /><CartPage /></>;
}
