import type { SaleMode } from './types';

export const VOLUME2_BATCH_ID = 'volume2-2026-09';
export const VOLUME2_BATCH_NAME = 'Volumen 2 · venta de mudanza · septiembre 2026';

export type Volume2BatchItem = {
  id: string;
  itemNumber: number;
  title: string;
  category: string;
  description: string;
  condition: string;
  conditionNotes: string;
  functionality: string;
  knownDefects: string;
  includedAccessories: string[];
  notIncludedVisible: string;
  quantityStructure: string;
  measurements: string;
  photos: string[];
  asking: number;
  marketLow: number;
  marketHigh: number;
  fast: number;
  floor: number;
  confidence: 'Alta' | 'Media' | 'Baja';
  saleMode: SaleMode;
  pickupDate: string | null;
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  quantityTotal: number;
  requiresVehicle: boolean;
  requiresLoadingHelp: boolean;
  flag: string;
  research: string;
};

type Spec = {
  title: string;
  category: string;
  photos: string[];
  asking: number;
  description?: string;
  condition?: string;
  functionality?: string;
  included?: string[];
  excluded?: string;
  quantity?: number;
  structure?: string;
  delayed?: boolean;
  vehicle?: boolean;
  help?: boolean;
  flag?: string;
  measurements?: string;
  confidence?: 'Alta' | 'Media' | 'Baja';
  market?: [number, number];
  research?: string;
};

const weak = 'No se localizó un comparable local suficientemente similar; precio provisional y confianza baja.';
const samsung = 'Comparable local nuevo: Samsung C27F390FHL de 27 pulgadas, Gs. 1.595.000. https://www.shoppingchina.com.py/producto/639360';
const apc = 'Comparable local nuevo: APC BV650I-MS 650 VA / 375 W, Gs. 540.000. https://tiendamovil.com.py/shop/gaming/ups-apc-back-550va-bv650i-ms-proteccion-confiable-para-tus-dispositivos-esenciales.html';
const forza = 'Referencia local débil, modelo no confirmado: Forza SL-602UL 600 VA nuevo, Gs. 526.350. https://www.mapy.com.py/produto/ups-inteligente-forza-sl-602ul-600va-220volt/';
const singer = 'Referencia de categoría, no del modelo exacto: Singer Facilita Pro HD4423 nueva, Gs. 2.799.000. https://inverfin.com.py/products/maquina-de-coser-singer-facilita-pro-hd4423';

const s = (title: string, category: string, photos: string[], asking: number, extra: Omit<Spec, 'title'|'category'|'photos'|'asking'> = {}): Spec => ({ title, category, photos, asking, ...extra });

const specs: Spec[] = [
  s('Freezer vertical', 'Electrodomésticos', ['IMG_7782.JPG','IMG_7783.JPG'], 1200000, { delayed:true, vehicle:true, help:true, functionality:'No verificado.', flag:'Confirmar marca, modelo, capacidad, enfriamiento y medidas.' }),
  s('Sofá rojo', 'Muebles', ['IMG_7790.JPG'], 700000, { delayed:true, vehicle:true, help:true, excluded:'Objetos del ambiente no incluidos.', flag:'Confirmar medidas, firmeza y manchas o desgaste no visibles.' }),
  s('Juego de cortinas grises', 'Hogar', ['IMG_7792.JPG','IMG_7794.JPG','IMG_7797.JPG'], 250000, { description:'Paneles de cortina grises fotografiados instalados.', included:[], excluded:'Muebles y objetos del ambiente no incluidos.', flag:'No está claro cuántos paneles se venden ni si barral y herrajes están incluidos.' }),
  s('Hervidor eléctrico Philips', 'Electrodomésticos', ['IMG_7800.JPG'], 120000, { functionality:'No verificado.', flag:'Confirmar modelo, capacidad y funcionamiento.' }),
  s('Máquina de pan', 'Electrodomésticos', ['IMG_7803.JPG','IMG_7804.JPG'], 300000, { functionality:'No verificado.', flag:'Confirmar marca, modelo, funcionamiento e inclusiones internas.' }),
  s('Campana extractora Electrolux', 'Electrodomésticos', ['IMG_7805.JPG','IMG_7808.JPG'], 450000, { delayed:true, vehicle:true, functionality:'No verificado.', excluded:'Muebles y objetos circundantes no incluidos.', flag:'Confirmar modelo, medidas, luces, extracción y herrajes incluidos.' }),
  s('Transformador MB 220 V a 110 V 4000 W', 'Electrónica', ['IMG_7813.JPG'], 450000, { functionality:'No verificado.', flag:'Confirmar funcionamiento; potencia transcrita de la etiqueta visible.' }),
  s('Portarrollos de papel higiénico de piso', 'Hogar', ['IMG_7815.JPG'], 70000),
  s('Basurero gris con pedal', 'Hogar', ['IMG_7816.JPG','IMG_7816~2.JPG'], 100000, { functionality:'Pedal y cierre no verificados.', flag:'Confirmar capacidad y funcionamiento del pedal.' }),
  s('Microondas Electrolux', 'Electrodomésticos', ['IMG_7824.JPG','IMG_7824~2.JPG'], 450000, { delayed:true, functionality:'No verificado.', flag:'Confirmar modelo, capacidad, calentamiento y plato giratorio.' }),
  s('Lavavajillas', 'Electrodomésticos', ['IMG_7826.JPG','IMG_7827.JPG'], 1500000, { delayed:true, vehicle:true, help:true, functionality:'No verificado.', excluded:'Muebles y objetos circundantes no incluidos.', flag:'Confirmar marca, modelo, medidas, conexiones y ciclo completo.' }),
  s('Kit de herramienta rotativa', 'Herramientas', ['IMG_7828.JPG'], 180000, { functionality:'No verificado.', included:['Herramienta, estuche y accesorios visibles'], flag:'Confirmar marca, funcionamiento y conteo de accesorios.' }),
  s('Taladro eléctrico Makita con cable', 'Herramientas', ['IMG_7829.JPG'], 350000, { functionality:'No verificado.', flag:'Confirmar modelo, portabrocas y funcionamiento.' }),
  s('Aspiradora Stanley 600 W', 'Herramientas', ['IMG_7830.JPG','IMG_7831.JPG'], 500000, { vehicle:true, functionality:'No verificado.', flag:'Confirmar aspiración, soplado, filtro y accesorios incluidos.' }),
  s('Sierra circular', 'Herramientas', ['IMG_7832.JPG'], 350000, { functionality:'No verificado.', flag:'Confirmar marca, modelo, disco, guarda y funcionamiento.' }),
  s('Sierra caladora Juster con hojas', 'Herramientas', ['IMG_7833.JPG','IMG_7840.JPG'], 220000, { functionality:'No verificado.', included:['Sierra caladora','Paquete de hojas visible'], flag:'Confirmar funcionamiento y contenido exacto del paquete.' }),
  s('Taladro inalámbrico rojo y negro con kit', 'Herramientas', ['IMG_7834.JPG'], 300000, { functionality:'No verificado.', included:['Taladro, estuche y accesorios visibles'], flag:'Confirmar marca, batería, cargador y funcionamiento.' }),
  s('Basurero grande con tapa', 'Hogar', ['IMG_7836.JPG'], 180000, { vehicle:true, functionality:'Tapa no verificada.', flag:'Confirmar capacidad, cierre y ruedas si las hubiera.' }),
  s('Taladro inalámbrico Energizer con bolso', 'Herramientas', ['IMG_7837.JPG','IMG_7838.JPG'], 420000, { functionality:'No verificado.', included:['Taladro y bolso visibles'], flag:'Confirmar modelo, batería, cargador y funcionamiento.' }),
  s('Organizador con tornillos y fijaciones', 'Herramientas', ['IMG_7839.JPG'], 120000, { included:['Organizador y contenido visible'], flag:'Contenido y cantidad exactos no inventariados.' }),
  s('Caja de herramientas Truper naranja', 'Herramientas', ['IMG_7841.JPG'], 100000, { description:'Caja de herramientas naranja; el interior se muestra sin contenido.', excluded:'Herramientas no incluidas.', functionality:'Cierres no verificados.' }),
  s('Martillo de uña', 'Herramientas', ['IMG_7842.JPG'], 50000),
  s('Lote de herramientas eléctricas de mano', 'Herramientas', ['IMG_7846a.jpg','IMG_7846b.jpg','IMG_7846c.jpg'], 160000, { included:['Dos destornilladores, destornillador probador y comprobador de tensión visibles'], functionality:'No verificado.', flag:'Confirmar si se vende como lote y probar el comprobador.' }),
  s('Lote de herramientas de medición', 'Herramientas', ['IMG_7847a.jpg','IMG_7847b.jpg'], 100000, { included:['Regla plegable y escuadra combinada visibles'], flag:'Confirmar venta conjunta y estado de graduaciones.' }),
  s('Extensión eléctrica y regleta', 'Electrónica', ['IMG_7848.JPG'], 90000, { included:['Extensión y regleta visibles'], functionality:'No verificado.', flag:'Confirmar venta conjunta, largo del cable y funcionamiento.' }),
  s('Banquito plegable', 'Muebles', ['IMG_7850.JPG'], 70000, { quantity:2, structure:'Precio por unidad; 2 unidades aparentemente intercambiables.', functionality:'Mecanismo y estabilidad no verificados.', flag:'Confirmar que ambas unidades son iguales y el precio por unidad.' }),
  s('Banqueta alta', 'Muebles', ['IMG_7851.JPG'], 160000, { quantity:2, structure:'Precio por unidad; 2 unidades aparentemente intercambiables.', vehicle:true, flag:'Confirmar que ambas unidades son iguales, medidas y estabilidad.' }),
  s('Lote de dos bolsas de dormir', 'Hogar', ['IMG_7854.JPG'], 200000, { included:['Dos bolsas de dormir visibles'], structure:'Un lote de 2 unidades no idénticas.', flag:'Confirmar si se venden juntas; revisar cierres, limpieza y medidas.' }),
  s('Licuadora Oster', 'Electrodomésticos', ['IMG_7855.JPG'], 250000, { functionality:'No verificado.', flag:'Confirmar modelo, funcionamiento y tapa.' }),
  s('Afilador eléctrico Smith’s', 'Electrodomésticos', ['IMG_7856.JPG'], 250000, { functionality:'No verificado.', flag:'Confirmar modelo y funcionamiento.' }),
  s('Juego de cortador y rallador de verduras', 'Cocina', ['IMG_7858.JPG'], 100000, { included:['Piezas visibles'], flag:'Confirmar conteo de piezas e integridad de cuchillas.' }),
  s('Escurridor de platos', 'Cocina', ['IMG_7861.JPG'], 90000),
  s('Cocina a gas con horno', 'Electrodomésticos', ['IMG_7863.JPG','IMG_7864.JPG','IMG_7865.JPG','IMG_7876.JPG','IMG_7877.JPG','IMG_7878.JPG'], 1200000, { delayed:true, vehicle:true, help:true, functionality:'No verificado.', excluded:'Utensilios y objetos circundantes no incluidos.', flag:'Confirmar marca, modelo, medidas, encendido, hornallas, horno, pérdidas y parrillas/bandejas incluidas.' }),
  s('Mueble bajo de cocina con mesada', 'Muebles', ['IMG_7867.JPG'], 450000, { delayed:true, vehicle:true, help:true, excluded:'Objetos apoyados y muebles contiguos no incluidos.', flag:'Confirmar medidas, material y si la mesada está incluida/fija.' }),
  s('Cajonera angosta de cocina de 4 cajones', 'Muebles', ['IMG_7868.JPG','IMG_7872.JPG'], 350000, { delayed:true, vehicle:true, flag:'Confirmar medidas, material y deslizamiento de cajones.' }),
  s('Repisa de pared para especias', 'Muebles', ['IMG_7874.JPG','IMG_7875.JPG'], 180000, { excluded:'Frascos, especias y objetos visibles no incluidos.', flag:'Confirmar medidas y herrajes de instalación.' }),
  s('Alfombra de cocina', 'Hogar', ['IMG_7870.JPG'], 60000, { flag:'Confirmar medidas y estado de la cara inferior.' }),
  s('Juego de 4 moldes de pizza', 'Cocina', ['IMG_7879.JPG'], 120000, { included:['Cuatro moldes visibles'], structure:'Un juego de 4 piezas.' }),
  s('Tabla de cortar blanca', 'Cocina', ['IMG_7880.JPG','IMG_7881.JPG'], 40000, { quantity:2, structure:'Precio por unidad; 2 unidades aparentemente intercambiables.', flag:'Confirmar que ambas unidades se venden por separado y sus medidas.' }),
  s('Canasta para parrilla', 'Cocina', ['IMG_7882.JPG'], 80000, { functionality:'Cierre y mango no verificados.' }),
  s('Juego de 2 bandejas de servir', 'Cocina', ['IMG_7883.JPG'], 100000, { included:['Dos bandejas visibles'], structure:'Un juego de 2 piezas.', flag:'Confirmar material y medidas.' }),
  s('Rodillo de cocina', 'Cocina', ['IMG_7885.JPG'], 40000),
  s('Lote de bandejas de aluminio descartables', 'Cocina', ['IMG_7886.JPG','IMG_7888.JPG'], 70000, { included:['Tres paquetes visibles'], flag:'Confirmar cantidad por paquete y si se vende todo junto.' }),
  s('Juego de 2 placas para horno', 'Cocina', ['IMG_7889.JPG'], 100000, { included:['Dos placas visibles'], structure:'Un juego de 2 piezas.', flag:'Confirmar medidas.' }),
  s('Juego de asadera con rejilla', 'Cocina', ['IMG_7891.JPG','IMG_7892.JPG','IMG_7893.JPG'], 140000, { included:['Asadera y rejilla visibles'], flag:'Confirmar número exacto de piezas y medidas.' }),
  s('Mueble bajo con fregadero doble', 'Muebles', ['IMG_7895.JPG','IMG_7899.JPG','IMG_7900.JPG','IMG_7904.JPG'], 900000, { delayed:true, vehicle:true, help:true, excluded:'Grifería, tuberías y objetos circundantes no confirmados como incluidos.', flag:'Confirmar medidas, material, grifería, desagües y alcance del desmontaje.' }),
  s('Molde para muffins', 'Cocina', ['IMG_7906.JPG'], 70000, { flag:'Confirmar capacidad y medidas.' }),
  s('Isla de cocina con ruedas', 'Muebles', ['IMG_7908.JPG','IMG_7910.JPG','IMG_7911.JPG','IMG_7912.JPG','IMG_7913.JPG'], 800000, { delayed:true, vehicle:true, help:true, excluded:'Objetos guardados o apoyados no incluidos.', functionality:'Ruedas, cajones y puertas no verificados.', flag:'Confirmar medidas, material, ruedas, cajones y herrajes.' }),
  s('Mueble para microondas', 'Muebles', ['IMG_7915.JPG','IMG_7917.JPG'], 500000, { delayed:true, vehicle:true, help:true, excluded:'Microondas, electrodomésticos, vajilla y objetos del ambiente no incluidos.', flag:'Confirmar medidas, material y estado de puertas/cajones.' }),
  s('Fuente de vidrio con tapa roja', 'Cocina', ['IMG_7918.JPG'], 80000, { included:['Fuente y tapa roja visibles'], flag:'Confirmar marca, capacidad y ausencia de astillas.' }),
  s('Basurero blanco con pedal', 'Hogar', ['IMG_7920.JPG','IMG_7921.JPG','IMG_7922.JPG'], 100000, { functionality:'Pedal y cierre no verificados.', flag:'Confirmar capacidad y funcionamiento del pedal.' }),
  s('Escalera plegable', 'Herramientas', ['PXL_20260904_150223112.jpg','PXL_20260904_150302054.jpg','PXL_20260904_150327502.jpg','PXL_20260904_150336957.jpg'], 350000, { vehicle:true, functionality:'Bisagras, seguros y estabilidad no verificados.', flag:'Confirmar marca, altura, carga máxima y estado de peldaños/seguros.' }),
  s('Puerta de seguridad', 'Hogar', ['PXL_20260904_150442302.jpg','PXL_20260904_150515511.jpg','PXL_20260904_150542073.jpg'], 250000, { functionality:'Cierre y fijaciones no verificados.', included:['Puerta y piezas visibles'], flag:'Confirmar ancho de instalación, herrajes incluidos y funcionamiento del cierre.' }),
  s('Sillón individual a juego', 'Muebles', ['IMG_7926.JPG'], 450000, { quantity:2, structure:'Precio por unidad; 2 sillones aparentemente intercambiables.', delayed:true, vehicle:true, help:true, flag:'Confirmar que ambas unidades son equivalentes, medidas, firmeza y estado del tapizado.' }),
  s('Pizarra blanca', 'Oficina', ['PXL_20260904_151947425.jpg','PXL_20260904_152040829.jpg','PXL_20260904_152119885.jpg'], 220000, { vehicle:true, excluded:'Marcadores y objetos del ambiente no incluidos salvo confirmación.', flag:'Confirmar medidas, herrajes y si incluye borrador/bandeja.' }),
  s('Reloj de pared redondo ornamentado', 'Decoración', ['PXL_20260904_152406140.jpg','PXL_20260904_152417383.jpg'], 120000, { functionality:'Movimiento y precisión no verificados.', flag:'Confirmar diámetro y funcionamiento.' }),
  s('Mesa plegable', 'Muebles', ['PXL_20260904_152912764.jpg','PXL_20260904_153111732.jpg','PXL_20260904_153310244.jpg','PXL_20260904_153441367.jpg','PXL_20260904_153501340.jpg'], 450000, { delayed:true, vehicle:true, functionality:'Mecanismo y estabilidad no verificados.', excluded:'Objetos del ambiente no incluidos.', flag:'Confirmar medidas, material, carga y funcionamiento del mecanismo.' }),
  s('Televisor Matsui MT-DSLE32 con control', 'Electrónica', ['PXL_20260904_153620324.jpg','PXL_20260904_153648324.jpg','PXL_20260904_154740822.jpg','PXL_20260904_154752181.jpg','PXL_20260904_154801469.jpg'], 550000, { delayed:true, functionality:'No verificado.', included:['Televisor y control remoto visibles'], flag:'Confirmar encendido, imagen, sonido, entradas, tamaño y estado del control.' }),
  s('Gabinete de madera', 'Muebles', ['PXL_20260904_153749620.jpg','PXL_20260904_153833085.jpg','PXL_20260904_153845563.jpg','PXL_20260904_153907638.jpg','PXL_20260904_153923279.jpg','PXL_20260904_153938481.jpg','PXL_20260904_154119882.jpg','PXL_20260904_154136039.jpg'], 650000, { delayed:true, vehicle:true, help:true, excluded:'Objetos guardados o apoyados no incluidos.', flag:'Confirmar medidas, material, llaves, puertas, cajones y daños.' }),
  s('Cortinas marrones', 'Hogar', ['PXL_20260904_155201528.jpg','PXL_20260904_155218020.jpg','PXL_20260904_155227444.jpg'], 250000, { description:'Paneles de cortina marrones fotografiados instalados.', excluded:'Muebles y objetos del ambiente no incluidos.', flag:'Confirmar cantidad de paneles y si barral y herrajes están incluidos.' }),
  s('Mesa auxiliar plegable', 'Muebles', ['PXL_20260904_160005510.NIGHT.jpg','PXL_20260904_160055504.jpg'], 180000, { functionality:'Mecanismo y estabilidad no verificados.', flag:'Confirmar medidas y estado del mecanismo.' }),
  s('Máquina de coser Singer con bolso rodante', 'Electrodomésticos', ['PXL_20260904_205620170.jpg','PXL_20260904_205644324.jpg','PXL_20260904_205655910.jpg','PXL_20260904_205731270.jpg','PXL_20260904_205748260.jpg','PXL_20260904_205819231.jpg','PXL_20260904_205833394.jpg','PXL_20260904_210026385.jpg','PXL_20260904_210310279.jpg','PXL_20260904_210319849.jpg','PXL_20260904_210327829.jpg','PXL_20260904_210340018.jpg','PXL_20260904_210405823.jpg','PXL_20260904_210414517.jpg','PXL_20260904_210426648.jpg','PXL_20260904_210437854.jpg','PXL_20260904_210548036.jpg','PXL_20260904_210557880.jpg','PXL_20260904_210611395.jpg','PXL_20260904_210621040.jpg','PXL_20260904_210631335.jpg','PXL_20260904_210708822.jpg','PXL_20260904_210808221.jpg'], 1200000, { delayed:true, functionality:'No verificado.', included:['Máquina, bolso/carro y piezas visibles; alcance exacto sujeto a confirmación'], flag:'Confirmar modelo, funcionamiento, pedal, cable, accesorios, bolso, funda y mesa/extensión.', research:singer, market:[800000,1800000] }),
  s('Monitor curvo Samsung C27F390FHL', 'Electrónica', ['PXL_20260904_220508771.jpg','PXL_20260904_220516622.jpg','PXL_20260904_220528534.jpg','PXL_20260904_220559935.jpg','PXL_20260904_220721049.jpg','PXL_20260904_221105864.jpg','PXL_20260904_221111959.jpg'], 750000, { functionality:'No verificado.', included:['Monitor y base visibles'], excluded:'Computadora y demás objetos del escritorio no incluidos.', flag:'Confirmar pantalla, entradas, cable de alimentación y cable de video.', research:samsung, market:[650000,1000000], confidence:'Media' }),
  s('UPS APC BV650I-MS 650 VA / 375 W', 'Electrónica', ['PXL_20260904_220904034.jpg','PXL_20260904_220935207.jpg','PXL_20260904_220951412.jpg','PXL_20260904_221013513.jpg'], 300000, { functionality:'No verificado.', flag:'Probar batería bajo carga y confirmar cableado.', research:apc, market:[250000,380000], confidence:'Media' }),
  s('Escritorio de madera', 'Oficina', ['PXL_20260904_221622453.jpg','PXL_20260904_221637837.jpg','PXL_20260904_221654796.jpg','PXL_20260904_221717989.jpg','PXL_20260904_221827240.jpg','PXL_20260904_221849556.jpg','PXL_20260904_221919343.jpg'], 650000, { delayed:true, vehicle:true, help:true, excluded:'Monitor, computadora, silla y objetos apoyados no incluidos.', functionality:'Cajones y herrajes no verificados.', flag:'Confirmar medidas, material, desmontaje y estado de cajones.' }),
  s('Silla de oficina', 'Oficina', ['PXL_20260904_222214721.jpg','PXL_20260904_222228595.jpg','PXL_20260904_222246219.jpg','PXL_20260904_222301437.jpg','PXL_20260904_222321974.jpg','PXL_20260904_222347036.jpg'], 300000, { delayed:true, vehicle:true, functionality:'Altura, ruedas y reclinación no verificadas.', flag:'Confirmar ajustes, pistón, ruedas, firmeza y desgaste del tapizado.' }),
  s('Juego de organizadores de escritorio', 'Oficina', ['IMG_7930.JPG'], 80000, { included:['Organizadores visibles'], flag:'Confirmar conteo de piezas.' }),
  s('Binoculares Bushnell con estuche', 'Electrónica', ['IMG_7931.JPG'], 350000, { functionality:'Enfoque y óptica no verificados.', included:['Binoculares, estuche y manual visibles'], flag:'Confirmar modelo, aumentos y estado de lentes.' }),
  s('Mortero con mano', 'Cocina', ['IMG_7932.JPG'], 70000, { included:['Mortero y mano visibles'], flag:'Material y medidas no confirmados.' }),
  s('Fuente rectangular de vidrio', 'Cocina', ['IMG_7933.JPG'], 70000, { flag:'Confirmar marca, medidas y ausencia de astillas.' }),
  s('Juego de fuentes redondas de vidrio', 'Cocina', ['IMG_7934.JPG'], 100000, { included:['Dos fuentes anidadas visibles'], structure:'Un juego de 2 piezas.', flag:'Confirmar conteo, medidas y ausencia de astillas.' }),
  s('Fuente ovalada con tapa blanca', 'Cocina', ['IMG_7935.JPG'], 90000, { included:['Fuente y tapa visibles'], flag:'Confirmar material, capacidad y ausencia de astillas.' }),
  s('Fuente rectangular de vidrio n.º 2', 'Cocina', ['IMG_7937.JPG'], 70000, { flag:'Confirmar marca, medidas y ausencia de astillas.' }),
  s('Fuente redonda de vidrio n.º 2', 'Cocina', ['IMG_7938.JPG'], 70000, { flag:'Confirmar marca, medidas y ausencia de astillas.' }),
  s('Vaso térmico de viaje', 'Cocina', ['IMG_7939.JPG'], 50000, { functionality:'Cierre y retención térmica no verificados.', flag:'Confirmar capacidad y pérdidas.' }),
  s('Recipiente morado con tapa', 'Cocina', ['IMG_7940.JPG','IMG_7941.JPG'], 60000, { included:['Recipiente y tapa visibles'], flag:'Confirmar capacidad y cierre.' }),
  s('Juego de 3 abanicos decorativos', 'Decoración', ['IMG_7942.JPG'], 70000, { included:['Tres abanicos visibles'], structure:'Un juego de 3 piezas.' }),
  s('Lote de bordado y manualidades', 'Manualidades', ['IMG_7943.JPG','IMG_7944.JPG'], 180000, { included:['Materiales y accesorios visibles'], flag:'Inventariar contenido exacto y confirmar venta como lote.' }),
  s('Juego Connect 4', 'Juegos', ['IMG_7946.JPG'], 80000, { functionality:'Integridad del juego no verificada.', flag:'Contar fichas y confirmar piezas completas.' }),
  s('Kit de cuentas y manualidades 7 en 1', 'Juegos', ['IMG_7947.JPG'], 100000, { functionality:'Integridad no verificada.', flag:'Confirmar contenido y piezas completas.' }),
  s('Juego de cartas UNO', 'Juegos', ['IMG_7948.JPG'], 40000, { functionality:'Mazo completo no verificado.', flag:'Contar cartas.' }),
  s('Organizador circular para cartas y juegos', 'Juegos', ['IMG_7954.JPG'], 90000, { included:['Organizador, cartas, dados y piezas visibles'], flag:'Contenido exacto y completitud no verificados.' }),
  s('Lote de 2 mazos de naipes', 'Juegos', ['IMG_7955.JPG'], 50000, { included:['Dos mazos visibles'], functionality:'Mazos completos no verificados.', flag:'Contar cartas y confirmar venta conjunta.' }),
  s('Juego de mesa Aggravation', 'Juegos', ['IMG_7956.JPG'], 100000, { functionality:'Piezas completas no verificadas.', flag:'Inventariar tablero, fichas, dados e instrucciones.' }),
  s('Recipiente verde con inserto', 'Cocina', ['IMG_7959.JPG','IMG_7961.JPG','IMG_7963.JPG'], 70000, { included:['Recipiente, tapa e inserto visibles'], flag:'Confirmar uso previsto, capacidad y cierre.' }),
  s('Estuche rígido pequeño', 'Hogar', ['IMG_7964.JPG','IMG_7966.JPG'], 60000, { excluded:'Contenido no incluido; el estuche se muestra vacío.', functionality:'Cierres no verificados.', flag:'Confirmar medidas y funcionamiento de cierres.' }),
  s('Muñequera ortopédica', 'Salud', ['IMG_7968.JPG'], 40000, { flag:'Confirmar talla, lado, marca y estado higiénico.' }),
  s('Sombrero de sol tejido', 'Accesorios personales', ['IMG_7969.JPG'], 60000, { flag:'Material y talla no confirmados.' }),
  s('Juego de 5 abanicos decorativos', 'Decoración', ['IMG_7972.JPG','IMG_7974.JPG'], 100000, { included:['Cinco abanicos visibles'], structure:'Un juego de 5 piezas.', flag:'Confirmar conteo y estado individual.' }),
  s('Juego de 4 ruedas giratorias Fascy de 1 pulgada', 'Herramientas', ['IMG_7973.JPG'], 60000, { included:['Cuatro ruedas visibles'], structure:'Un juego de 4 piezas.', functionality:'Giro y rodamiento no verificados.' }),
  s('Portavela decorativo', 'Decoración', ['IMG_7975.JPG'], 50000, { excluded:'Vela no confirmada como incluida.', flag:'Confirmar medidas y si incluye vela.' }),
  s('Reloj de pared negro', 'Decoración', ['IMG_7976.JPG'], 70000, { functionality:'Movimiento y precisión no verificados.', flag:'Confirmar diámetro y funcionamiento.' }),
  s('Armario de madera', 'Muebles', ['IMG_7647~2-EDIT.jpg','IMG_7649~2.JPG','IMG_7648~2.JPG'], 1000000, { delayed:true, vehicle:true, help:true, excluded:'Ropa y objetos interiores no incluidos.', flag:'La foto IMG_7798.JPG estaba vacía/corrupta y fue excluida. Confirmar medidas, material, llaves, herrajes e interior.' }),
  s('Televisor grande', 'Electrónica', ['IMG_7789~2.jpg'], 700000, { delayed:true, vehicle:true, functionality:'No verificado.', excluded:'Mueble y objetos circundantes no incluidos.', flag:'Marca, modelo, tamaño, control remoto, encendido, imagen, sonido y entradas sin confirmar.' }),
  s('Juego de ganchos transparentes con ventosa', 'Hogar', ['IMG_7814~2.JPG'], 40000, { included:['Ganchos visibles'], flag:'Confirmar cantidad y adherencia.' }),
  s('Dispensador de jabón gris', 'Hogar', ['IMG_7817~2.JPG'], 40000, { functionality:'Bomba no verificada.', flag:'Confirmar capacidad y funcionamiento.' }),
  s('UPS Forza', 'Electrónica', ['IMG_7819~2.JPG','IMG_7821~2.JPG'], 250000, { functionality:'No verificado.', flag:'Modelo y capacidad no legibles; probar batería bajo carga.', research:forza, market:[180000,320000] }),
  s('Maza corta', 'Herramientas', ['IMG_7842~2.JPG'], 70000, { flag:'Confirmar peso y estado del mango.' }),
  s('Espátula o raspador', 'Herramientas', ['IMG_7842~2a.jpg'], 30000, { flag:'Confirmar ancho y estado del filo.' }),
  s('Juegos de brocas', 'Herramientas', ['IMG_7844~2.JPG'], 120000, { included:['Estuches y brocas visibles'], flag:'Contar piezas, identificar tipos y revisar desgaste.' }),
  s('Lote de herramientas manuales', 'Herramientas', ['IMG_7845~2a.jpg','IMG_7845~2b.jpg','IMG_7845~2c.jpg'], 150000, { included:['Palanca, pelacables/crimpadora y sierra manual pequeña visibles'], structure:'Un lote propuesto de 3 herramientas no intercambiables.', flag:'Confirmar si se vende como lote o por separado y revisar estado de cada herramienta.' }),
];

function item(spec: Spec, index: number): Volume2BatchItem {
  const itemNumber = 58 + index;
  const delayed = Boolean(spec.delayed);
  const marketLow = spec.market?.[0] ?? Math.max(10000, Math.round(spec.asking * 0.8 / 10000) * 10000);
  const marketHigh = spec.market?.[1] ?? Math.max(marketLow, Math.round(spec.asking * 1.35 / 10000) * 10000);
  const quantity = spec.quantity ?? 1;
  const excluded = spec.excluded ?? 'No se identificaron otros objetos visibles que deban considerarse incluidos.';
  const functionality = spec.functionality ?? 'No aplica o no requiere prueba funcional específica; estado estructural no verificado.';
  return {
    id: `real-202609-volume2-${itemNumber}`,
    itemNumber,
    title: spec.title,
    category: spec.category,
    description: `${spec.description ?? `${spec.title} usado, ofrecido tal como aparece en las fotografías originales.`} ${excluded}`,
    condition: spec.condition ?? 'Usado; estado visual según fotografías',
    conditionNotes: 'Se conservan las fotografías originales sin retoque. Revisar señales de uso y detalles visibles antes de aprobar.',
    functionality,
    knownDefects: `${functionality} ${spec.flag ?? 'Medidas no disponibles.'}`,
    includedAccessories: spec.included ?? [],
    notIncludedVisible: excluded,
    quantityStructure: spec.structure ?? (quantity > 1 ? `Precio por unidad; ${quantity} unidades disponibles.` : 'Una unidad / un lote, según se describe.'),
    measurements: spec.measurements ?? 'No disponibles; medir antes de publicar si afectan transporte o compatibilidad.',
    photos: spec.photos,
    asking: spec.asking,
    marketLow,
    marketHigh,
    fast: Math.max(10000, Math.round(spec.asking * 0.85 / 10000) * 10000),
    floor: Math.max(10000, Math.round(spec.asking * 0.7 / 10000) * 10000),
    confidence: spec.confidence ?? 'Baja',
    saleMode: delayed ? 'DELAYED' : 'IMMEDIATE',
    pickupDate: delayed ? '2026-12-09' : null,
    pickupWindowStart: delayed ? '2026-12-09' : null,
    pickupWindowEnd: delayed ? '2026-12-12' : null,
    quantityTotal: quantity,
    requiresVehicle: Boolean(spec.vehicle),
    requiresLoadingHelp: Boolean(spec.help),
    flag: spec.flag ?? 'Confirmar medidas y estado antes de publicar.',
    research: spec.research ?? weak,
  };
}

export const VOLUME2_BATCH_ITEMS: Volume2BatchItem[] = specs.map(item);

if (VOLUME2_BATCH_ITEMS.length !== 101 || VOLUME2_BATCH_ITEMS.at(-1)?.itemNumber !== 158) {
  throw new Error('El Volumen 2 debe conservar exactamente los Item IDs 058–158.');
}
