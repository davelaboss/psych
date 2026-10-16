'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type CartContextValue = {
  ids: string[];
  quantities: Record<string, number>;
  add: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
  setQuantity: (id: string, quantity: number) => void;
  ready: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = 'mudanza-demo-cart';

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(stored)) {
        const clean = stored.filter((value): value is string => typeof value === 'string'); setIds(clean); setQuantities(Object.fromEntries(clean.map((id) => [id, 1])));
      } else if (stored && Array.isArray(stored.ids)) { setIds(stored.ids); setQuantities(stored.quantities ?? {}); }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids, quantities }));
  }, [ids, quantities, ready]);

  const value = useMemo<CartContextValue>(() => ({
    ids,
    quantities,
    add: (id) => { setIds((current) => current.includes(id) ? current : [...current, id]); setQuantities((current) => ({ ...current, [id]: current[id] ?? 1 })); },
    remove: (id) => { setIds((current) => current.filter((item) => item !== id)); setQuantities((current) => { const next = { ...current }; delete next[id]; return next; }); },
    clear: () => { setIds([]); setQuantities({}); },
    has: (id) => ids.includes(id),
    setQuantity: (id, quantity) => setQuantities((current) => ({ ...current, [id]: Math.max(1, Math.floor(quantity)) })),
    ready,
  }), [ids, quantities, ready]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart debe usarse dentro de CartProvider');
  return value;
}
