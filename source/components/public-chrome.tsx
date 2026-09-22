'use client';

import { usePathname } from 'next/navigation';
import { SiteHeader } from './site-header';

export function PublicChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith('/admin')) return children;
  return <><SiteHeader />{children}<footer className="site-footer"><div><span className="brand-mark">VM</span><p><strong>Venta de Mudanza</strong><br />Venta particular de mudanza · Paraguay</p></div><div><a href="/#articulos">Artículos</a><a href="/#preguntas">Preguntas frecuentes</a><a href="/admin">Acceso vendedor</a></div><small>Sin delivery ni envíos · La dirección exacta nunca se publica.</small></footer></>;
}
