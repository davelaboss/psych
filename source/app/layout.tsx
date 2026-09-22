import type { Metadata } from 'next';
import './globals.css';
import { CartProvider } from '@/components/cart-provider';
import { PublicChrome } from '@/components/public-chrome';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_ORIGIN ?? 'http://localhost:3000'),
  title: 'Venta de Mudanza | Venta particular en Paraguay',
  description: 'Venta particular de mudanza con artículos para retiro en Paraguay.',
  openGraph: {
    title: 'Venta de Mudanza',
    description: 'Venta particular en Paraguay · Retiro únicamente',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Venta de Mudanza · Venta particular en Paraguay' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Venta de Mudanza',
    description: 'Venta particular en Paraguay · Retiro únicamente',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-PY">
      <body><CartProvider><PublicChrome>{children}</PublicChrome></CartProvider></body>
    </html>
  );
}
