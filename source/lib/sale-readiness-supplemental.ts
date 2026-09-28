import type { Volume2BatchItem } from './volume2-batch';

export const SALE_READINESS_SUPPLEMENTAL_BATCH_ID = 'sale-readiness-supplemental-2026-09';
export const SALE_READINESS_SUPPLEMENTAL_BATCH_NAME = 'Complementos de venta · septiembre 2026';

type SupplementalSpec = {
  itemNumber: number;
  title: string;
  category: string;
  photos: string[];
  asking: number;
  description: string;
  condition?: string;
  functionality?: string;
  included?: string[];
  excluded?: string;
  quantity?: number;
  structure?: string;
  measurements?: string;
  delayed?: boolean;
  vehicle?: boolean;
  help?: boolean;
  status?: Volume2BatchItem['status'];
  needsReview?: boolean;
  flag?: string;
};

function build(spec: SupplementalSpec): Volume2BatchItem {
  const delayed = Boolean(spec.delayed);
  const quantity = spec.quantity ?? 1;
  const marketLow = Math.max(5000, Math.round(spec.asking * 0.8 / 5000) * 5000);
  const marketHigh = Math.max(marketLow, Math.round(spec.asking * 1.35 / 5000) * 5000);

  return {
    id: `real-202609-supplemental-${String(spec.itemNumber).padStart(3, '0')}`,
    itemNumber: spec.itemNumber,
    title: spec.title,
    category: spec.category,
    description: [spec.description, spec.excluded || ''].filter(Boolean).join(' '),
    condition: spec.condition ?? 'Estado visual según fotografías',
    conditionNotes: '',
    functionality: spec.functionality ?? '',
    knownDefects: spec.flag ?? '',
    includedAccessories: spec.included ?? [],
    notIncludedVisible: spec.excluded ?? '',
    quantityStructure: spec.structure ?? (quantity > 1 ? `Precio por unidad; ${quantity} unidades disponibles.` : 'Una unidad.'),
    measurements: spec.measurements ?? '',
    photos: spec.photos,
    asking: spec.asking,
    marketLow,
    marketHigh,
    fast: Math.max(5000, Math.round(spec.asking * 0.85 / 5000) * 5000),
    floor: Math.max(5000, Math.round(spec.asking * 0.7 / 5000) * 5000),
    confidence: spec.needsReview ? 'Baja' : 'Media',
    saleMode: delayed ? 'DELAYED' : 'IMMEDIATE',
    pickupDate: delayed ? '2026-12-09' : null,
    pickupWindowStart: delayed ? '2026-12-09' : null,
    pickupWindowEnd: delayed ? '2026-12-12' : null,
    quantityTotal: quantity,
    requiresVehicle: Boolean(spec.vehicle),
    requiresLoadingHelp: Boolean(spec.help),
    flag: spec.flag ?? '',
    research: spec.needsReview ? 'Pendiente de cierre por el vendedor.' : 'Precio confirmado por el vendedor para la venta de mudanza.',
    status: spec.status ?? 'AVAILABLE',
    needsReview: Boolean(spec.needsReview),
  };
}

export const SALE_READINESS_SUPPLEMENTAL_ITEMS: Volume2BatchItem[] = [
  build({
    itemNumber: 56,
    title: 'Convertidor de medio de fibra óptica TP-Link MC111CS V4.0',
    category: 'Electrónica',
    photos: [],
    asking: 120000,
    description: 'Convertidor de medio de fibra óptica TP-Link modelo MC111CS V4.0.',
    status: 'UNLISTED',
    needsReview: true,
    flag: 'Restaurar como Item 056. El propietario ahora confirmó 3 fotos para Volume 2A: IMG_8128, PXL_20260913_152523154 e IMG_8127. Adjuntarlas cuando los archivos reales aparezcan en el repositorio. Reconfirmar precio final antes de publicar.',
  }),
  build({
    itemNumber: 159,
    title: 'Juego de cortinas grises, 2 paneles · retiro posterior',
    category: 'Hogar',
    photos: ['IMG_7792.JPG', 'IMG_7794.JPG', 'IMG_7797.JPG'],
    asking: 190000,
    description: 'Segundo juego idéntico de 2 paneles de cortina grises.',
    included: ['2 paneles de cortina', 'Cortinas de encaje blancas'],
    excluded: 'Barral no incluido.',
    measurements: 'Cada panel: 135 cm de ancho × 250 cm de alto.',
    delayed: true,
  }),
  build({
    itemNumber: 160,
    title: 'Barral de cortina · 1 unidad restante',
    category: 'Hogar',
    photos: [
      'PXL_20260926_181648766.jpg',
      'PXL_20260926_181708730.jpg',
      'PXL_20260926_181702455.jpg',
      'PXL_20260926_181738567.jpg',
      'PXL_20260926_181730465.jpg',
      'PXL_20260926_181719862.jpg',
    ],
    asking: 90000,
    description: 'Barral de cortina vendido por unidad. De las 2 unidades originales, una ya fue vendida y queda 1 disponible.',
    included: ['Soportes de montaje'],
    delayed: true,
  }),
  build({
    itemNumber: 161,
    title: 'Barral de cortina',
    category: 'Hogar',
    photos: ['PXL_20260904_155218020.jpg', 'PXL_20260904_155227444.jpg'],
    asking: 45000,
    description: 'Barral de cortina separado del juego de cortinas del Item 117. Es ajustable.',
    included: ['Soportes de montaje'],
    measurements: '180 cm de largo; ajustable.',
    delayed: true,
  }),
  build({
    itemNumber: 162,
    title: 'Google Chromecast 3.ª generación',
    category: 'Electrónica',
    photos: ['PXL_20260904_153749620.jpg'],
    asking: 60000,
    description: 'Google Chromecast de 3.ª generación.',
  }),
  build({
    itemNumber: 163,
    title: 'Mesa auxiliar plegable gris oscuro',
    category: 'Muebles',
    photos: [],
    asking: 70000,
    description: 'Mesa auxiliar plegable gris oscuro, vendida por unidad. Hay 2 unidades.',
    quantity: 2,
    delayed: true,
    vehicle: true,
    status: 'UNLISTED',
    needsReview: true,
    flag: 'Fotos pendientes. Publicar cuando se incorporen las fotos confirmadas por el vendedor.',
  }),
  build({
    itemNumber: 164,
    title: 'Escuadra combinada ajustable',
    category: 'Herramientas',
    photos: ['IMG_7847b.jpg'],
    asking: 30000,
    description: 'Escuadra combinada con regla graduada y cabezal ajustable. Herramienta de fabricación antigua pero funcional, útil para medición, marcado y comprobación de ángulos.',
  }),
  build({
    itemNumber: 165,
    title: 'Gancho transparente con ventosa · retiro posterior',
    category: 'Hogar',
    photos: ['IMG_7814~2.JPG'],
    asking: 12000,
    description: 'Gancho transparente con ventosa, vendido por unidad.',
    quantity: 3,
    structure: 'Precio por unidad; 3 unidades con retiro posterior.',
    measurements: 'Ventosa de aproximadamente 6 cm de diámetro; altura total aproximada 12 cm.',
    delayed: true,
  }),
  build({
    itemNumber: 166,
    title: 'Alicate pelacables',
    category: 'Herramientas',
    photos: ['IMG_7845~2b.jpg'],
    asking: 25000,
    description: 'Alicate pelacables de fabricación antigua, de origen estadounidense, para pelar y preparar conductores eléctricos.',
  }),
  build({
    itemNumber: 167,
    title: 'Sierra manual pequeña',
    category: 'Herramientas',
    photos: ['IMG_7845~2c.jpg'],
    asking: 10000,
    description: 'Sierra manual pequeña para cortes livianos y trabajos generales.',
  }),
  build({
    itemNumber: 168,
    title: 'Bolso rodante',
    category: 'Hogar',
    photos: [
      'PXL_20260904_210310279.jpg',
      'PXL_20260904_210319849.jpg',
      'PXL_20260904_210327829.jpg',
      'PXL_20260904_210340018.jpg',
      'PXL_20260904_210405823.jpg',
      'PXL_20260904_210414517.jpg',
      'PXL_20260904_210426648.jpg',
      'PXL_20260904_210437854.jpg',
      'PXL_20260904_210548036.jpg',
      'PXL_20260904_210557880.jpg',
      'PXL_20260904_210611395.jpg',
      'PXL_20260904_210621040.jpg',
      'PXL_20260904_210631335.jpg',
      'PXL_20260904_210708822.jpg',
      'PXL_20260904_210808221.jpg',
    ],
    asking: 150000,
    description: 'Bolso rodante.',
    measurements: '48 cm de ancho × 30 cm de profundidad. Altura: 43 cm hasta la parte superior del bolso; 51 cm hasta la parte superior del asa cerrada; 95 cm con el asa totalmente extendida.',
  }),
];

const itemNumbers = SALE_READINESS_SUPPLEMENTAL_ITEMS.map((item) => item.itemNumber);
if (new Set(itemNumbers).size !== itemNumbers.length) {
  throw new Error('Los Items suplementarios deben conservar números únicos.');
}
