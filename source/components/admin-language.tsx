'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AdminProduct } from '@/lib/types';
import { getEnglishHelper } from '@/lib/english-helpers';

export type AdminLanguage = 'en' | 'es';

const PAIRS: Array<[string, string]> = [
  ['PANEL DEL PROPIETARIO', 'OWNER PANEL'], ['REVISIÓN DE INVENTARIO', 'INVENTORY REVIEW'],
  ['Resumen', 'Overview'], ['Lote de fotos', 'Photo batch'], ['Pedidos', 'Orders'], ['Inventario', 'Inventory'],
  ['Precios', 'Pricing'], ['Backup e historial', 'Backup & history'], ['Acceso revisor', 'Reviewer access'],
  ['Ver sitio público ↗', 'View public site ↗'], ['Cerrar sesión', 'Sign out'], ['Cerrando…', 'Signing out…'],
  ['Hola,', 'Hello,'], ['Gestioná la venta y la revisión.', 'Manage the sale and review.'], ['Revisá los 53 artículos reales, uno por uno.', 'Review the 53 real Items, one at a time.'],
  ['Configuración de demostración.', 'Demo configuration.'],
  ['El banco, la cuenta y el número de WhatsApp todavía son campos de muestra. No los uses para operaciones reales.', 'The bank, account, and WhatsApp number are still sample fields. Do not use them for real transactions.'],
  ['Cargando el movimiento de la venta…', 'Loading sale activity…'], ['No se pudo cargar el panel.', 'The panel could not be loaded.'], ['Reintentar', 'Retry'],
  ['El servidor devolvió una respuesta no válida', 'The server returned an invalid response'],
  ['FASE 2 · LOTE PRIVADO', 'PHASE 2 · PRIVATE BATCH'], ['FASE 2 · REVISIÓN SECUENCIAL', 'PHASE 2 · SEQUENTIAL REVIEW'],
  ['Un artículo por vez', 'One item at a time'], ['Nada se publica sin aprobación individual. Aprobar guarda y avanza al siguiente Item.', 'Nothing is published without individual approval. Approve saves and advances to the next Item.'],
  ['Aplicar correcciones base', 'Apply base corrections'], ['Aplicando…', 'Applying…'], ['Cargar fotos', 'Upload photos'], ['Subiendo…', 'Uploading…'],
  ['Buscar Item, nombre o categoría…', 'Search Item, name, or category…'], ['Ir al Item:', 'Go to Item:'], ['Ir', 'Go'],
  ['aprobados', 'approved'], ['esperando revisión', 'awaiting review'], ['preguntas abiertas', 'open questions'], ['con fotos completas', 'with complete photos'],
  ['Revisión privada.', 'Private review.'], ['Las fotos originales se conservan; aprobar este artículo es la única acción que lo publica.', 'Original photos are preserved; approving this Item is the only action that publishes it.'],
  ['Público', 'Public'], ['Información pública', 'Public information'], ['¿Es esto exactamente lo que queremos que vea el comprador?', 'Is this exactly what we want the buyer to see?'],
  ['Vista previa como comprador', 'Buyer preview'], ['Ampliar foto', 'Enlarge photo'], ['Precio pedido', 'Asking price'],
  ['Categoría', 'Category'], ['Precio anterior visible', 'Previous public price'], ['Descripción pública', 'Public description (Spanish)'],
  ['Objetos visibles no incluidos', 'NOT included with sale (Spanish)'], ['Estado / condición', 'Condition (Spanish)'],
  ['Funcionamiento y observaciones públicas', 'Public condition notes (Spanish)'], ['Defectos conocidos públicos', 'Known public defects (Spanish)'],
  ['Incluye', 'Included with sale (Spanish)'], ['Modalidad de venta', 'Sale mode'], ['Retiro', 'Pickup'],
  ['Seña / reserva', 'Deposit / reservation'], ['Logística pública', 'Public pickup instructions (Spanish)'], ['Etiquetas públicas', 'Public tags (Spanish)'],
  ['Solo interno', 'Internal only'], ['Información interna / Admin', 'Internal / Admin information'],
  ['Precios de referencia, investigación, preguntas e historial', 'Reference pricing, research, questions, and history'],
  ['Mostrar / ocultar', 'Show / hide'], ['Estado interno', 'Internal status'], ['Requiere revisión', 'Needs review'],
  ['Rango de mercado Paraguay', 'Paraguay market range'], ['Estimación central', 'Central estimate'],
  ['Venta rápida recomendada', 'Fast-sale price'], ['Mínimo privado del vendedor', 'Private seller floor'],
  ['Confianza de precio / IA', 'Pricing confidence / AI'], ['Pregunta o incertidumbre pendiente', 'Open question or uncertainty'],
  ['Investigación y fuentes', 'Research notes and sources'], ['Notas internas', 'Internal notes'],
  ['Campos confirmados por el vendedor', 'Seller confirmed'], ['ID de base de datos', 'Database ID'], ['Slug / referencia', 'Slug / reference'],
  ['Lote', 'Batch'], ['Fotos cargadas / esperadas', 'Photos uploaded / expected'], ['Historial de cambios', 'Audit history'],
  ['Anterior', 'Previous'], ['← Anterior', '← Previous'], ['Editar', 'Edit'], ['Cerrar edición', 'Close editing'],
  ['Revisar después / Siguiente →', 'Review later / Next →'], ['Aprobar y continuar', 'Approve and continue'], ['Aprobando…', 'Approving…'], ['Ya aprobado', 'Already approved'],
  ['Información pública editable', 'Editable public information'], ['Nombre', 'Public title (Spanish)'],
  ['Descripción y exclusiones visibles', 'Public description and exclusions (Spanish)'], ['Precio pedido (Gs.)', 'Asking price (Gs.)'],
  ['Funcionamiento y observaciones', 'Public condition notes (Spanish)'], ['Defectos conocidos', 'Known public defects (Spanish)'],
  ['Accesorios incluidos, uno por línea', 'Included with sale (Spanish), one per line'], ['Etiquetas, una por línea', 'Public tags (Spanish), one per line'],
  ['Notas logísticas, una por línea', 'Public pickup instructions (Spanish), one per line'], ['Traer vehículo', 'Buyer must bring a vehicle'],
  ['Traer ayuda para cargar', 'Buyer must bring loading help'], ['Seña (%)', 'Deposit (%)'], ['Fecha de referencia', 'Reference pickup date'],
  ['Inicio de ventana', 'Pickup window start'], ['Fin de ventana', 'Pickup window end'], ['Editar nota interna', 'Edit internal note'],
  ['Guardar corrección', 'Save correction'], ['Guardando…', 'Saving…'], ['Sin observaciones adicionales', 'No additional notes'],
  ['Ninguno informado', 'None reported'], ['Ningún accesorio indicado', 'No accessories listed'], ['Sin indicaciones especiales', 'No special instructions'],
  ['Sin etiquetas', 'No tags'], ['Sí', 'Yes'], ['No', 'No'], ['Sin estimación central', 'No central estimate'], ['Sin recomendación', 'No recommendation'],
  ['Sin mínimo privado', 'No private floor'], ['Sin asignar', 'Unassigned'], ['Ninguna pregunta abierta', 'No open questions'],
  ['Sin investigación registrada', 'No research recorded'], ['Sin notas internas', 'No internal notes'], ['Ninguno marcado todavía', 'None marked yet'], ['Sin lote', 'No batch'],
  ['Disponibles', 'Available'], ['Reservados', 'Reserved'], ['Vendidos', 'Sold'], ['Retirados', 'Picked up'], ['A confirmar', 'To confirm'],
  ['Disponible', 'Available'], ['En proceso de compra', 'Purchase in progress'], ['Pago a confirmar', 'Payment to confirm'], ['Reservado', 'Reserved'], ['Vendido', 'Sold'], ['Retirado', 'Picked up'], ['No publicado', 'Unlisted'],
  ['Todos', 'All'], ['Pago pendiente', 'Payment pending'], ['Pago o seña confirmado', 'Payment or deposit confirmed'], ['Saldo confirmado', 'Balance confirmed'],
  ['No publicados', 'Unlisted'], ['Artículos', 'Items'], ['Los campos privados aparecen solo en este panel.', 'Private fields appear only in this panel.'],
  ['+ Agregar artículo', '+ Add Item'], ['Guardar cambios', 'Save changes'], ['Destacar en la tienda', 'Feature in storefront'],
  ['Modo de venta', 'Sale mode'], ['Disponible ahora', 'Available now'], ['Retiro posterior', 'Delayed pickup'], ['Fecha mínima de retiro', 'Earliest pickup date'],
  ['Precio mínimo privado (Gs.)', 'Private seller floor (Gs.)'], ['Estimación de mercado (Gs.)', 'Market estimate (Gs.)'], ['Precio venta rápida (Gs.)', 'Fast-sale price (Gs.)'],
  ['PLAN DE REDUCCIONES', 'PRICE REDUCTION PLAN'], ['Sugerencias, nunca cambios automáticos', 'Suggestions, never automatic changes'],
  ['Artículo', 'Item'], ['Mercado', 'Market'], ['Precio actual', 'Current price'], ['Venta rápida', 'Fast sale'], ['Mínimo privado', 'Private floor'], ['Pendiente', 'Pending'], ['Privado', 'Private'],
  ['BACKUP Y AUDITORÍA', 'BACKUP & AUDIT'], ['Historial', 'History'], ['Restaurar este snapshot', 'Restore this snapshot'], ['Restaurar inventario', 'Restore inventory'],
  ['EXCLUSIVO DEL PROPIETARIO', 'OWNER ONLY'], ['Acceso de revisor', 'Reviewer access'], ['Código seguro de un solo uso', 'Secure one-time code'],
  ['Generar código de acceso para revisor', 'Generate reviewer access code'], ['Generando…', 'Generating…'], ['Código de un solo uso', 'One-time code'],
  ['Sesiones de María', 'María’s sessions'], ['Sesión REVIEWER activa', 'Active REVIEWER session'], ['No hay sesión activa', 'No active session'],
  ['Revocar todas las sesiones', 'Revoke all sessions'], ['Revocando…', 'Revoking…'],
  ['ACCIÓN PRIORITARIA', 'PRIORITY ACTION'], ['Pagos por confirmar', 'Payments to confirm'], ['Ver todos', 'View all'], ['SEGUIMIENTO', 'TRACKING'], ['Estado de la venta', 'Sale status'],
  ['BANDEJA DE PEDIDOS', 'ORDER INBOX'], ['Reservas y ventas', 'Reservations and sales'], ['Activos', 'Active'], ['Comprador', 'Buyer'], ['Saldo al retirar', 'Balance due at pickup'],
  ['Confirmar pago recibido', 'Confirm payment received'], ['Marcar pago pendiente', 'Mark payment pending'], ['Confirmar saldo recibido', 'Confirm balance received'],
  ['Marcar como retirado', 'Mark as picked up'], ['Cancelar reserva y liberar', 'Cancel reservation and release'], ['Cancelar y liberar', 'Cancel and release'],
  ['REVISIÓN PRIVADA', 'PRIVATE REVIEW'], ['Acceso al inventario', 'Inventory access'],
  ['Código de acceso de un solo uso', 'One-time access code'], ['Ingresar como revisor', 'Sign in as reviewer'], ['Ingresando…', 'Signing in…'],
  ['Ingreso del propietario con ChatGPT', 'Owner sign-in with ChatGPT'], ['Volver a Venta próximamente', 'Return to storefront'],
  ['El inventario real, las fotos y el contenido del panel no están disponibles sin autorización.', 'Real inventory, photos, and panel content are unavailable without authorization.'],
];

const esToEn = new Map(PAIRS);
const enToEs = new Map(PAIRS.map(([es, en]) => [en, es]));
const AdminLanguageContext = createContext<AdminLanguage>('es');

function translateExact(text: string, language: AdminLanguage): string {
  const trimmed = text.trim();
  const translated = language === 'en' ? esToEn.get(trimmed) : enToEs.get(trimmed);
  if (!translated) return text;
  return text.replace(trimmed, translated);
}

function translateRoot(root: HTMLElement, language: AdminLanguage) {
  const skip = '.buyer-preview, .public-fields dd, .internal-fields dd, .batch-title h4, input, textarea, [data-no-admin-translate]';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest(skip)) continue;
    const translated = translateExact(node.data, language);
    if (translated !== node.data) node.data = translated;
  }
  for (const element of root.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder]')) {
    if (element.closest(skip)) continue;
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const value = element.getAttribute(attr);
      if (value) { const translated = translateExact(value, language); if (translated !== value) element.setAttribute(attr, translated); }
    }
  }
}

export function AdminLanguageShell({ children, preferenceKey, defaultLanguage }: { children: React.ReactNode; preferenceKey: string; defaultLanguage: AdminLanguage }) {
  const storageKey = `venta-mudanza-admin-language:${preferenceKey}`;
  const [language, setLanguage] = useState<AdminLanguage>(defaultLanguage);
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'en' || stored === 'es') setLanguage(stored);
  }, [storageKey]);
  useEffect(() => {
    localStorage.setItem(storageKey, language);
    const root = document.querySelector<HTMLElement>('[data-admin-language-root]');
    if (!root) return;
    translateRoot(root, language);
    const observer = new MutationObserver(() => translateRoot(root, language));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [language, storageKey]);
  const value = useMemo(() => language, [language]);
  return <AdminLanguageContext.Provider value={value}><div data-admin-language-root data-admin-language={language}>
    <div className="admin-language-switcher" aria-label={language === 'en' ? 'Admin interface language' : 'Idioma de la interfaz administrativa'}>
      <span>{language === 'en' ? 'Admin language' : 'Idioma del panel'}</span>
      <div role="group" aria-label={language === 'en' ? 'Choose language' : 'Elegir idioma'}>
        <button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
        <button type="button" className={language === 'es' ? 'active' : ''} aria-pressed={language === 'es'} onClick={() => setLanguage('es')}>Español</button>
      </div>
    </div>{children}
  </div></AdminLanguageContext.Provider>;
}

export function useAdminLanguage() { return useContext(AdminLanguageContext); }

export function EnglishHelper({ product }: { product: AdminProduct }) {
  const language = useAdminLanguage();
  const [open, setOpen] = useState(false);
  if (language !== 'en') return null;
  const helper = getEnglishHelper(product);
  return <div className="english-helper" data-no-admin-translate>
    <button type="button" onClick={() => setOpen(!open)}>{open ? 'Hide English Translation' : 'View English Translation'}</button>
    {open ? <div role="note"><strong>Private English helper</strong>{helper.stale ? <p className="translation-stale"><strong>STALE:</strong> The Spanish listing changed after this helper was generated. Refresh it during the next Site update before relying on it.</p> : null}<dl><div><dt>Title</dt><dd>{helper.title}</dd></div><div><dt>Public description</dt><dd>{helper.description}</dd></div><div><dt>Condition</dt><dd>{helper.condition}</dd></div><div><dt>Condition details</dt><dd>{helper.conditionNotes}</dd></div><div><dt>Known defects</dt><dd>{helper.knownDefects}</dd></div><div><dt>Included items</dt><dd>{helper.includedItems}</dd></div><div><dt>Excluded items</dt><dd>{helper.excludedItems}</dd></div><div><dt>Pickup / logistics</dt><dd>{helper.logistics}</dd></div></dl><small>Read-only admin aid. Spanish remains authoritative. This text is never shown in Buyer Preview or published to buyers.</small></div> : null}
  </div>;
}
