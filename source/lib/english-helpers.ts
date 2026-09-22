import { PHASE2_BATCH_ITEMS } from './phase2-batch';
import { VOLUME2_BATCH_ITEMS } from './volume2-batch';
import type { AdminProduct } from './types';

const PHRASES: Array<[RegExp, string]> = [
  [/Sin defectos funcionales conocidos informados por el vendedor\.?/gi, 'No known functional defects reported by the seller.'],
  [/Sin defectos conocidos informados por el vendedor\.?/gi, 'No known defects reported by the seller.'],
  [/Sin defectos visibles relevantes\.?/gi, 'No significant visible defects.'],
  [/Sin daños evidentes en la foto\.?/gi, 'No evident damage in the photo.'],
  [/No se observan roturas importantes\.?/gi, 'No significant tears or breakage are visible.'],
  [/No se observan roturas/gi, 'No tears are visible'],
  [/No se observan grietas evidentes\.?/gi, 'No evident cracks are visible.'],
  [/Medidas no disponibles\.?/gi, 'Measurements are unavailable.'],
  [/medidas a confirmar/gi, 'measurements need confirmation'],
  [/Estado de raíces no verificado\.?/gi, 'Root condition has not been verified.'],
  [/Buen estado visual/gi, 'Good visual condition'],
  [/Muy buen estado/gi, 'Very good condition'],
  [/Usado y parcialmente funcional/gi, 'Used and partially functional'],
  [/Usado y funcional/gi, 'Used and functional'],
  [/Usado/gi, 'Used'],
  [/Funciona muy bien/gi, 'Works very well'],
  [/funciona correctamente/gi, 'works correctly'],
  [/El vendedor confirma que/gi, 'The seller confirms that'],
  [/Presenta señales leves de uso/gi, 'Shows light signs of use'],
  [/señales normales de uso/gi, 'normal signs of use'],
  [/desgaste visible/gi, 'visible wear'],
  [/según la foto/gi, 'as shown in the photo'],
  [/no verificados/gi, 'not verified'],
  [/no verificado/gi, 'not verified'],
  [/a confirmar/gi, 'to be confirmed'],
  [/No incluye gas/gi, 'Gas is not included'],
  [/Se vende de forma individual/gi, 'Sold individually'],
  [/No se garantiza/gi, 'There is no guarantee of'],
  [/Incluye/gi, 'Includes'],
  [/con maceta/gi, 'with pot'],
  [/con regulador/gi, 'with regulator'],
  [/de madera/gi, 'wood'],
  [/de pared/gi, 'wall-mounted'],
  [/decorativo/gi, 'decorative'],
  [/decorativa/gi, 'decorative'],
  [/de oficina/gi, 'office'],
  [/con ruedas/gi, 'with wheels'],
  [/de vidrio/gi, 'glass'],
  [/de plástico/gi, 'plastic'],
  [/de fibras naturales/gi, 'natural-fiber'],
  [/en tono natural/gi, 'in a natural tone'],
  [/en la foto/gi, 'in the photo'],
  [/para cargar/gi, 'for loading'],
  [/Traer vehículo/gi, 'Bring a vehicle'],
  [/Traer ayuda para cargar/gi, 'Bring help for loading'],
];

const WORDS: Record<string, string> = {
  silla:'chair', sillón:'armchair', dispenser:'water dispenser', agua:'water', bolso:'bag', cuadro:'picture',
  estante:'shelf', plástico:'plastic', blanco:'white', ave:'bird', perchero:'coat rack', paraguas:'umbrella',
  cajonera:'drawer cabinet', madera:'wood', felpudo:'doormat', maceta:'pot', regadera:'watering can',
  florero:'vase', licuadora:'blender', transformador:'transformer', juego:'set', canastos:'baskets',
  arreglo:'arrangement', floral:'floral', garrafa:'gas cylinder', planta:'plant', reloj:'clock',
  mesa:'table', lámpara:'lamp', escritorio:'desk', parrilla:'grill', hacha:'axe', pala:'shovel',
  escalera:'ladder', ventilador:'fan', espejo:'mirror', colchón:'mattress', almohadón:'cushion',
  negro:'black', negra:'black', beige:'beige', turquesa:'turquoise', violeta:'purple', violetas:'purple',
  grande:'large', pequeño:'small', pequeña:'small', alto:'tall', alta:'tall', angosto:'narrow',
  redondo:'round', redonda:'round', artificial:'artificial', eléctrico:'electric', eléctrica:'electric',
  jardín:'garden', hogar:'home', cocina:'kitchen', decoración:'decor', muebles:'furniture',
};

function translate(text: string): string {
  let output = text || 'None stated.';
  for (const [pattern, replacement] of PHRASES) output = output.replace(pattern, replacement);
  output = output.replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, (word) => WORDS[word.toLocaleLowerCase('es')] ?? word);
  return output.replace(/\s+/g, ' ').trim();
}

function sourceText(product: Pick<AdminProduct, 'title'|'description'|'condition'|'conditionNotes'|'knownDefects'|'includedAccessories'|'logisticsNotes'|'requiresVehicle'|'requiresLoadingHelp'>) {
  return JSON.stringify([product.title, product.description, product.condition, product.conditionNotes, product.knownDefects, product.includedAccessories, product.logisticsNotes, product.requiresVehicle, product.requiresLoadingHelp]);
}

export function getEnglishHelper(product: AdminProduct) {
  const source = [...PHASE2_BATCH_ITEMS, ...VOLUME2_BATCH_ITEMS].find((item) => item.id === product.id);
  const baseline = source ? {
    title: source.title, description: source.description, condition: source.condition,
    conditionNotes: source.conditionNotes, knownDefects: source.knownDefects,
    includedAccessories: source.includedAccessories ?? [], logisticsNotes: [] as string[],
    requiresVehicle: Boolean(source.requiresVehicle), requiresLoadingHelp: Boolean(source.requiresLoadingHelp),
  } : product;
  const logistics = [baseline.requiresVehicle ? 'Bring a vehicle.' : '', baseline.requiresLoadingHelp ? 'Bring help for loading.' : '', ...baseline.logisticsNotes.map(translate)].filter(Boolean).join(' ') || 'Buyer arranges pickup; no special instructions stated.';
  const excluded = baseline.description.split(/(?<=[.!?])\s+/).filter((sentence) => /no (?:está|están|esta|estan)?\s*incluid|no incluye|se vende(?:n)? por separado/i.test(sentence)).map(translate).join(' ') || 'No excluded items are explicitly stated.';
  return {
    title: translate(baseline.title), description: translate(baseline.description), condition: translate(baseline.condition),
    conditionNotes: translate(baseline.conditionNotes), knownDefects: translate(baseline.knownDefects),
    includedItems: baseline.includedAccessories.length ? baseline.includedAccessories.map(translate).join(' · ') : 'No included accessories stated.',
    excludedItems: excluded, logistics,
    stale: Boolean(source && sourceText(product) !== sourceText(baseline as AdminProduct)),
  };
}
