import type { InventoryStatus, SaleMode } from './types';

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
  status: InventoryStatus;
  needsReview: boolean;
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
  status?: InventoryStatus;
  needsReview?: boolean;
};

const weak = 'No se localizó un comparable local suficientemente similar; precio provisional y confianza baja.';
const samsung = 'Comparable local nuevo: Samsung C27F390FHL de 27 pulgadas, Gs. 1.595.000. https://www.shoppingchina.com.py/producto/639360';
const apc = 'Comparable local nuevo: APC BV650I-MS 650 VA / 375 W, Gs. 540.000. https://tiendamovil.com.py/shop/gaming/ups-apc-back-550va-bv650i-ms-proteccion-confiable-para-tus-dispositivos-esenciales.html';
const forza = 'Referencia local débil, modelo no confirmado: Forza SL-602UL 600 VA nuevo, Gs. 526.350. https://www.mapy.com.py/produto/ups-inteligente-forza-sl-602ul-600va-220volt/';
const singer = 'Referencia de categoría, no del modelo exacto: Singer Facilita Pro HD4423 nueva, Gs. 2.799.000. https://inverfin.com.py/products/maquina-de-coser-singer-facilita-pro-hd4423';

const s = (title: string, category: string, photos: string[], asking: number, extra: Omit<Spec, 'title'|'category'|'photos'|'asking'> = {}): Spec => ({ title, category, photos, asking, ...extra });

const specs: Spec[] = [
  s('Congeladora vertical Tokyo CGTOK157L', 'Electrodomésticos', ['IMG_7782.JPG','IMG_7783.JPG'], 1300000, { delayed:true, vehicle:true, help:true, description:'Congeladora vertical Tokyo modelo CGTOK157L, de frío húmedo, con 3 niveles de temperatura, 5 cajones, puerta reversible e interior de alta resistencia.', functionality:'Funcionamiento confirmado por el vendedor.', included:['5 cajones'], flag:'' }),
  s('Sofá La-Z-Boy con 2 almohadones', 'Muebles', ['IMG_7790.JPG'], 750000, { delayed:true, vehicle:true, help:true, description:'Sofá La-Z-Boy rojo con 2 almohadones incluidos.', included:['2 almohadones'], excluded:'Cortinas y demás muebles del ambiente no incluidos.', flag:'' }),
  s('Juego de cortinas grises, 2 paneles', 'Hogar', ['IMG_7792.JPG','IMG_7794.JPG','IMG_7797.JPG'], 190000, { description:'Juego de 2 paneles de cortina grises. Cada panel mide aproximadamente 135 cm de ancho por 250 cm de alto.', included:['2 paneles de cortina','Cortinas de encaje blancas'], excluded:'Barral no incluido.', structure:'Un juego disponible ahora. El segundo juego idéntico se publica por separado con retiro posterior.', measurements:'Cada panel: 135 cm de ancho × 250 cm de alto.', flag:'' }),
  s('Hervidor eléctrico Philips', 'Electrodomésticos', ['IMG_7800.JPG'], 120000, { delayed:true, functionality:'No verificado.', flag:'Confirmar modelo, capacidad y funcionamiento.' }),
  s('Máquina de pan', 'Electrodomésticos', ['IMG_7803.JPG','IMG_7804.JPG'], 300000, { functionality:'No verificado.', flag:'Confirmar marca, modelo, funcionamiento e inclusiones internas.' }),
  s('Campana extractora Electrolux', 'Electrodomésticos', ['PXL_20260926_175430734.jpg','PXL_20260926_175421487.MP.jpg','PXL_20260926_175350038.jpg'], 450000, { vehicle:true, description:'Campana extractora Electrolux. Medidas aproximadas: 90 × 14 × 50 cm.', measurements:'90 × 14 × 50 cm.', flag:'' }),
  s('Transformador MB 220 V a 110 V 4000 W', 'Electrónica', ['PXL_20260926_182755420.jpg','PXL_20260926_182745187.jpg','PXL_20260926_182734129.jpg','PXL_20260926_182711501.jpg','PXL_20260926_182656023.jpg','PXL_20260926_182804401.jpg'], 425000, { delayed:true, description:'Transformador MB de 220 V a 110 V, 4000 W.', measurements:'13 × 16 × 19 cm.', flag:'' }),
  s('Portarrollos de papel higiénico de piso', 'Hogar', ['IMG_7815.JPG'], 54000),
  s('Basurero gris con pedal', 'Hogar', ['IMG_7816.JPG','IMG_7816~2.JPG'], 70000, { functionality:'Pedal y cierre en estado funcional según confirmación del vendedor.', flag:'' }),
  s('Microondas Electrolux EMDN20S5ML', 'Electrodomésticos', ['IMG_7824.JPG','IMG_7824~2.JPG'], 250000, { delayed:true, description:'Microondas Electrolux modelo EMDN20S5ML, capacidad de 20 litros, potencia de salida de 700 W y consumo de 1600 W. Aproximadamente 4 años de uso.', condition:'Buen estado', functionality:'Funciona correctamente según confirmación del vendedor.', flag:'' }),
  s('Lavavajillas Bosch SMS46IW08E, 13 servicios', 'Electrodomésticos', ['IMG_7826.JPG','IMG_7827.JPG','PXL_20260927_171930513.jpg'], 2900000, { vehicle:true, help:true, description:'Lavavajillas Bosch modelo SMS46IW08E, fabricado en Alemania, capacidad para 13 servicios. Aproximadamente 3 años de uso.', measurements:'59 × 85 × 59 cm.', functionality:'Funciona perfectamente según confirmación del vendedor.', flag:'' }),
  s('Kit Dremel de herramienta rotativa', 'Herramientas', ['IMG_7828.JPG'], 180000, { included:['Herramienta Dremel','Estuche','Accesorios visibles'], flag:'Funcionamiento específico no reconfirmado en este cierre.' }),
  s('Taladro eléctrico Makita con cable', 'Herramientas', ['IMG_7829.JPG'], 150000, { flag:'' }),
  s('Aspiradora Stanley SL18125P 600 W para líquidos y sólidos', 'Electrodomésticos', ['PXL_20260927_002933054.jpg','PXL_20260927_185314577.jpg','PXL_20260927_002908981.jpg'], 375000, { delayed:true, description:'Aspiradora Stanley modelo SL18125P de 600 W para líquidos y sólidos. Capacidad aproximada de 3,8 litros.', included:['Manguera','2 accesorios','Base/soporte negro de pared'], measurements:'Aprox. 24 × 25 × 32 cm.', functionality:'Funciona muy bien según confirmación del vendedor.', flag:'' }),
  s('Sierra circular NEO SC-907/3/220 de 1600 W', 'Herramientas', ['IMG_7832.JPG'], 200000, { description:'Sierra circular NEO modelo SC-907/3/220, potencia real de 1600 W, base de aluminio y guía láser. Diámetro de disco de 185 mm.', measurements:'Peso aproximado: 4 kg. Disco: 185 mm.', flag:'' }),
  s('Sierra caladora Juster 750 W con hojas', 'Herramientas', ['IMG_7833.JPG','IMG_7840.JPG'], 150000, { description:'Sierra caladora Juster de 750 W, 220–240 V y velocidad variable de 1.000 a 3.000 rpm. Prácticamente sin uso; utilizada una sola vez.', included:['Hojas visibles'], condition:'Excelente estado general', flag:'' }),
  s('Mini motosierra inalámbrica Nappo de 6 pulgadas con 2 baterías y accesorios', 'Herramientas', ['IMG_7834.JPG'], 180000, { description:'Mini motosierra inalámbrica Nappo compacta, de aproximadamente 6 pulgadas. Adecuada para poda y cortes livianos, como ramas pequeñas.', included:['2 baterías','Cable de carga','Cadena adicional','Aceite','Herramientas de ajuste'], condition:'Presenta señales normales de uso', functionality:'Las baterías conservan buen funcionamiento según confirmación del vendedor.', measurements:'Cadena/barra: 1/4 pulgada × 6 pulgadas.', flag:'' }),
  s('Basurero grande con tapa', 'Hogar', ['IMG_7836.JPG'], 50000, { measurements:'Diámetro aproximado 35 cm × 40 cm de alto.', flag:'' }),
  s('Taladro inalámbrico Energizer con bolso', 'Herramientas', ['IMG_7837.JPG','IMG_7838.JPG'], 180000, { delayed:true, description:'Taladro inalámbrico Energizer con bolso. Tiene aproximadamente 6 años y ha tenido uso liviano.', included:['Bolso'], flag:'' }),
  s('Juego de 3 organizadores de fijaciones', 'Herramientas', ['IMG_8354.JPG','IMG_8355.JPG'], 85000, { description:'Juego de 3 organizadores con tornillos y fijaciones, herrajes para colgar cuadros y clavos.', included:['3 organizadores con el contenido visible'], structure:'Se vende el conjunto completo.', flag:'' }),
  s('Caja de herramientas Truper naranja', 'Herramientas', ['IMG_7841.JPG'], 50000, { flag:'' }),
  s('Martillo de uña', 'Herramientas', ['IMG_7842.JPG'], 20000, { measurements:'Peso aproximado: 841 g.', flag:'' }),
  s('Lote de herramientas manuales para electricidad', 'Herramientas', ['IMG_7846a.jpg','IMG_7846b.jpg','IMG_7846c.jpg'], 60000, { description:'Lote pequeño de herramientas manuales para electricidad: un tester funcional, dos destornilladores básicos y un destornillador tester sencillo.', included:['Tester','2 destornilladores','Destornillador tester'], functionality:'El tester funciona según confirmación del vendedor.', flag:'' }),
  s('Escuadra metálica para medición y trazado', 'Herramientas', ['IMG_7847a.jpg'], 15000, { description:'Escuadra metálica sencilla para trabajos de medición, marcado y trazado en carpintería, bricolaje y trabajos generales.', structure:'Una herramienta. La escuadra combinada se publica por separado.', flag:'' }),
  s('Extensión eléctrica de 28 m', 'Electrónica', ['IMG_7848.JPG'], 90000, { delayed:true, description:'Extensión eléctrica doméstica de aproximadamente 28 metros.', measurements:'Longitud aproximada: 28 m.', flag:'' }),
  s('Banquito plegable', 'Muebles', ['IMG_7850.JPG'], 70000, { delayed:true, quantity:2, structure:'Precio por unidad; 2 unidades aparentemente intercambiables.', functionality:'Mecanismo y estabilidad no verificados.', flag:'Confirmar que ambas unidades son iguales y el precio por unidad.' }),
  s('Banqueta alta', 'Muebles', ['IMG_7851.JPG'], 70000, { quantity:2, structure:'Precio por unidad; 2 unidades disponibles.', flag:'' }),
  s('Bolsa de dormir', 'Hogar', ['IMG_7854.JPG'], 75000, { quantity:2, description:'Bolsa de dormir tamaño adulto. Hay 2 unidades y se venden individualmente.', condition:'Sin uso previo confirmado por el vendedor', structure:'Precio por unidad; 2 unidades disponibles.', flag:'' }),
  s('Licuadora Oster BLSTMG-B00 de 8 velocidades con vaso de vidrio', 'Electrodomésticos', ['PXL_20260927_183702612.jpg','PXL_20260927_185617763.jpg'], 200000, { delayed:true, description:'Licuadora Oster modelo BLSTMG-B00, color negro, con vaso de vidrio y 8 velocidades. Aproximadamente 5–6 años, con muy poco uso.', functionality:'Funciona bien según confirmación del vendedor.', flag:'' }),
  s('Afilador eléctrico Smith’s', 'Electrodomésticos', ['IMG_7856.JPG'], 250000, { functionality:'No verificado.', flag:'Confirmar modelo y funcionamiento.' }),
  s('Juego de cortador y rallador de verduras', 'Hogar', ['IMG_7858.JPG'], 60000, { flag:'' }),
  s('Escurridor de platos', 'Cocina', ['IMG_7861.JPG'], 90000),
  s('Cocina a gas de 5 hornallas con horno y broiler', 'Electrodomésticos', ['IMG_7863.JPG','IMG_7864.JPG','IMG_7865.JPG','IMG_7876.JPG','IMG_7877.JPG','IMG_7878.JPG'], 750000, { delayed:true, vehicle:true, help:true, description:'Cocina a gas de 5 hornallas con horno y broiler.', included:['2 cubrejuntas laterales de silicona negra','Encendedor de cuello largo'], functionality:'Funciona. La hornalla delantera derecha enciende manualmente, pero su encendido automático no funciona.', flag:'' }),
  s('Mueble bajo de cocina con mesada de granito, cajón y 2 estantes deslizables', 'Muebles', ['IMG_7867.JPG'], 500000, { delayed:true, vehicle:true, help:true, description:'Mueble bajo de cocina de construcción robusta de madera, no aglomerado, con mesada de granito sellada y desmontable, un cajón superior, puerta inferior y 2 estantes deslizables.', measurements:'35 cm ancho × 64 cm profundidad × 92 cm alto al frente; 99 cm hasta el zócalo trasero.', flag:'' }),
  s('Mueble bajo de cocina con mesada de granito y 5 cajones', 'Muebles', ['IMG_7868.JPG','IMG_7872.JPG'], 500000, { delayed:true, vehicle:true, help:true, description:'Mueble bajo de cocina de construcción robusta de madera, no aglomerado, con mesada de granito sellada y desmontable y 5 cajones.', measurements:'35 cm ancho × 64 cm profundidad × 92 cm alto al frente; 99 cm hasta el zócalo trasero.', flag:'' }),
  s('Repisa de pared para especias', 'Hogar', ['IMG_7874.JPG','IMG_7875.JPG'], 90000, { measurements:'32 × 67 × 11 cm.', flag:'' }),
  s('Alfombra de cocina', 'Hogar', ['IMG_7870.JPG'], 60000, { flag:'Confirmar medidas y estado de la cara inferior.' }),
  s('Juego de 4 moldes de pizza', 'Cocina', ['IMG_7879.JPG'], 120000, { included:['Cuatro moldes visibles'], structure:'Un juego de 4 piezas.' }),
  s('Tabla de cortar blanca', 'Hogar', ['IMG_7881.JPG'], 40000, { quantity:2, status:'UNLISTED', needsReview:false, description:'Retirada del inventario: entregada/regalada.', flag:'' }),
  s('Canasta para parrilla', 'Hogar', ['IMG_7882.JPG'], 60000, { flag:'' }),
  s('Juego de 2 bandejas de servir', 'Hogar', ['IMG_7883.JPG'], 48000, { flag:'' }),
  s('Rodillo de cocina', 'Cocina', ['IMG_7885.JPG'], 40000),
  s('Lote de bandejas de aluminio descartables', 'Hogar', ['IMG_7886.JPG','IMG_7888.JPG'], 35000, { flag:'Cantidad exacta de piezas no reconfirmada.' }),
  s('Juego de 2 bandejas metálicas para horno', 'Hogar', ['IMG_7889.JPG'], 100000, { measurements:'43 × 27 cm.', flag:'' }),
  s('Juego de asadera con rejilla', 'Hogar', ['IMG_7891.JPG','IMG_7892.JPG','IMG_7893.JPG'], 110000, { flag:'' }),
  s('Mueble bajo de cocina con fregadero doble', 'Muebles', ['PXL_20260926_180259619.jpg','PXL_20260926_180307564.jpg'], 1000000, { delayed:true, vehicle:true, help:true, description:'Mueble bajo de cocina de construcción robusta de madera, no aglomerado, con mesada de granito sellada y desmontable y fregadero doble de acero inoxidable con escurridor.', measurements:'122 cm ancho × 64 cm profundidad × 92 cm alto al frente; 99 cm hasta el zócalo trasero.', flag:'' }),
  s('Molde para muffins', 'Hogar', ['IMG_7906.JPG'], 55000, { flag:'' }),
  s('Isla de cocina con ruedas y mesada de granito', 'Muebles', ['IMG_7908.JPG','IMG_7910.JPG','IMG_7911.JPG','IMG_7912.JPG','IMG_7913.JPG'], 900000, { delayed:true, vehicle:true, help:true, description:'Isla de cocina con ruedas, construcción robusta de madera, no aglomerado, y mesada de granito sellada y desmontable.', measurements:'135 × 92 × 65 cm.', flag:'' }),
  s('Mueble para microondas', 'Muebles', ['IMG_7915.JPG','IMG_7917.JPG','IMG_8353.JPG'], 500000, { delayed:true, vehicle:true, description:'Mueble alto de madera para microondas. La parte superior es desmontable.', excluded:'Objetos decorativos o aparatos visibles no incluidos salvo indicación expresa.', flag:'' }),
  s('Fuente rectangular Marinex con tapa naranja', 'Hogar', ['IMG_7918.JPG'], 25000, { quantity:2, description:'Fuente rectangular de vidrio Marinex con tapa naranja, capacidad aproximada de 1,2 litros.', structure:'Precio por unidad; 2 unidades idénticas disponibles.', flag:'' }),
  s('Basurero blanco con pedal', 'Hogar', ['IMG_7920.JPG','IMG_7921.JPG','IMG_7922.JPG'], 60000, { flag:'' }),
  s('Escalera plegable', 'Herramientas', ['PXL_20260904_150223112.jpg','PXL_20260904_150302054.jpg','PXL_20260904_150327502.jpg','PXL_20260904_150336957.jpg'], 350000, { delayed:true, vehicle:true, functionality:'Bisagras, seguros y estabilidad no verificados.', flag:'Confirmar marca, altura, carga máxima y estado de peldaños/seguros.' }),
  s('Barrera para niño o mascota', 'Hogar', ['PXL_20260904_150442302.jpg','PXL_20260904_150515511.jpg','PXL_20260904_150542073.jpg'], 90000, { description:'Barrera ajustable para limitar el paso de niños o mascotas. Se vende como barrera doméstica, sin afirmaciones de certificación de seguridad.', flag:'' }),
  s('Sillón individual a juego', 'Muebles', ['PXL_20260904_151050915.jpg'], 450000, { status:'UNLISTED', description:'Registro duplicado de Item 045; no publicar por separado.', flag:'' }),
  s('Pizarra blanca', 'Oficina', ['PXL_20260904_151947425.jpg','PXL_20260904_152040829.jpg','PXL_20260904_152119885.jpg'], 65000, { flag:'' }),
  s('Reloj de pared redondo ornamentado', 'Decoración', ['PXL_20260904_152406140.jpg','PXL_20260904_152417383.jpg'], 100000, { flag:'' }),
  s('Mesa plegable', 'Muebles', ['PXL_20260904_152912764.jpg','PXL_20260904_153111732.jpg','PXL_20260904_153310244.jpg','PXL_20260904_153441367.jpg','PXL_20260904_153501340.jpg'], 400000, { delayed:true, vehicle:true, description:'Mesa plegable de aproximadamente 3 años.', measurements:'180 × 75 × 72 cm.', flag:'' }),
  s('Televisor Matsui MT-DSLE32 con control', 'Electrónica', ['PXL_20260904_153620324.jpg','PXL_20260904_153648324.jpg','PXL_20260904_154740822.jpg','PXL_20260904_154752181.jpg','PXL_20260904_154801469.jpg'], 550000, { functionality:'No verificado.', included:['Televisor y control remoto visibles'], flag:'Confirmar encendido, imagen, sonido, entradas, tamaño y estado del control.' }),
  s('Gabinete de madera', 'Muebles', ['PXL_20260904_153833085.jpg','PXL_20260904_153845563.jpg','PXL_20260904_153907638.jpg','PXL_20260904_153923279.jpg','PXL_20260904_153938481.jpg','PXL_20260904_154119882.jpg','PXL_20260904_154136039.jpg'], 450000, { vehicle:true, description:'Gabinete de madera.', flag:'' }),
  s('Juego de cortinas marrones', 'Hogar', ['PXL_20260904_155201528.jpg'], 90000, { delayed:true, description:'Juego de cortinas marrones. La imagen fue ajustada para mostrar ambos paneles con largo consistente.', excluded:'Barral no incluido.', flag:'' }),
  s('Mesa auxiliar plegable', 'Muebles', ['PXL_20260904_205620170.jpg'], 180000, { status:'UNLISTED', description:'Registro duplicado de Item 054; no publicar por separado.', flag:'' }),
  s('Máquina de coser Singer con bolso rodante', 'Electrodomésticos', ['PXL_20260904_205644324.jpg','PXL_20260904_205731270.jpg'], 345000, { delayed:true, status:'SOLD', description:'Máquina de coser Singer con bolso rodante. Artículo vendido.', included:['Bolso rodante'], flag:'' }),
  s('Monitor curvo Samsung C27F390FHL', 'Electrónica', ['PXL_20260904_220508771.jpg','PXL_20260904_220516622.jpg','PXL_20260904_220528534.jpg','PXL_20260904_220559935.jpg','PXL_20260904_220721049.jpg','PXL_20260904_221105864.jpg','PXL_20260904_221111959.jpg'], 750000, { delayed:true, functionality:'No verificado.', included:['Monitor y base visibles'], excluded:'Computadora y demás objetos del escritorio no incluidos.', flag:'Confirmar pantalla, entradas, cable de alimentación y cable de video.', research:samsung, market:[650000,1000000], confidence:'Media' }),
  s('UPS APC BV650I-MS 650 VA / 375 W', 'Electrónica', ['PXL_20260904_220904034.jpg','PXL_20260904_220935207.jpg','PXL_20260904_220951412.jpg','PXL_20260904_221013513.jpg'], 300000, { delayed:true, functionality:'No verificado.', flag:'Probar batería bajo carga y confirmar cableado.', research:apc, market:[250000,380000], confidence:'Media' }),
  s('Escritorio de madera con bandejas deslizables e iluminación LED', 'Oficina', ['PXL_20260904_221622453.jpg','PXL_20260904_221637837.jpg','PXL_20260904_221654796.jpg','PXL_20260904_221717989.jpg','PXL_20260904_221827240.jpg','PXL_20260904_221849556.jpg','PXL_20260904_221919343.jpg'], 240000, { delayed:true, vehicle:true, description:'Escritorio de madera con iluminación LED inferior y dos bandejas deslizables: una para teclado y otra para mouse o accesorios.', measurements:'103 × 79 × 55 cm.', flag:'' }),
  s('Silla de oficina', 'Oficina', ['PXL_20260904_222214721.jpg','PXL_20260904_222228595.jpg','PXL_20260904_222246219.jpg','PXL_20260904_222301437.jpg','PXL_20260904_222321974.jpg','PXL_20260904_222347036.jpg'], 550000, { delayed:true, flag:'' }),
  s('Juego de accesorios de escritorio', 'Oficina', ['IMG_7930.JPG'], 110000, { description:'Conjunto de accesorios de escritorio con organizador de bandejas, basurero, portalápices de malla, engrampadora y perforadora.', included:['Organizador de bandejas','Basurero','Portalápices de malla','Engrampadora','Perforadora'], flag:'' }),
  s('Binoculares Bushnell con estuche', 'Accesorios', ['IMG_7931.JPG'], 35000, { included:['Estuche'], flag:'' }),
  s('Mortero con mano', 'Hogar', ['IMG_7932.JPG'], 50000, { flag:'' }),
  s('Fuente rectangular de vidrio', 'Hogar', ['IMG_7933.JPG'], 70000, { measurements:'32 × 25 cm.', flag:'' }),
  s('Juego de fuentes redondas de vidrio', 'Hogar', ['IMG_7934.JPG'], 100000, { status:'UNLISTED', description:'Registro duplicado absorbido por Item 129; no publicar por separado.', flag:'' }),
  s('Fuente ovalada con tapa blanca', 'Hogar', ['IMG_7935.JPG','IMG_7934.JPG'], 70000, { measurements:'35 × 25 cm, forma ovalada.', flag:'' }),
  s('Fuente rectangular de vidrio', 'Hogar', ['IMG_7937.JPG'], 60000, { measurements:'30 × 22 cm.', flag:'' }),
  s('Fuente ovalada de vidrio', 'Hogar', ['IMG_7938.JPG'], 55000, { measurements:'30 × 21 cm, forma ovalada.', flag:'' }),
  s('Vaso térmico de viaje', 'Hogar', ['IMG_7939~2.JPG'], 50000, { status:'UNLISTED', description:'Retirado del inventario: entregado/regalado.', flag:'' }),
  s('Recipiente morado con tapa', 'Cocina', ['IMG_7940.JPG','IMG_7941.JPG'], 60000, { included:['Recipiente y tapa visibles'], flag:'Confirmar capacidad y cierre.' }),
  s('Juego de 3 abanicos decorativos', 'Decoración', ['IMG_7942.JPG'], 22000, { flag:'' }),
  s('Lote de bordado y manualidades', 'Manualidades', ['IMG_7943.JPG','IMG_7944.JPG'], 55000, { flag:'Contenido exacto del lote no reconfirmado.' }),
  s('Juego Connect 4', 'Juegos', ['IMG_7946.JPG'], 48000, { flag:'' }),
  s('Kit de cuentas y manualidades 7 en 1', 'Manualidades', ['IMG_7947.JPG'], 100000, { status:'UNLISTED', description:'Retirado del inventario: entregado/regalado.', flag:'' }),
  s('Juego de cartas UNO', 'Juegos', ['IMG_7948.JPG'], 18000, { flag:'' }),
  s('Organizador circular para cartas y juegos', 'Juegos', ['IMG_7954.JPG'], 60000, { flag:'' }),
  s('Lote de 3 mazos de naipes', 'Juegos', ['IMG_7955.JPG'], 75000, { description:'Lote de 3 mazos de naipes: 2 mazos en caja negra y un tercer mazo separado.', included:['3 mazos de naipes'], flag:'' }),
  s('Juego de mesa Aggravation', 'Juegos', ['IMG_7956.JPG'], 60000, { flag:'' }),
  s('Escurridor y recipiente para guardar lechuga Tupperware', 'Hogar', ['IMG_7959.JPG','IMG_7961.JPG','IMG_7963.JPG'], 60000, { description:'Recipiente Tupperware para escurrir y guardar lechuga.', flag:'' }),
  s('Estuche rígido pequeño', 'Accesorios', ['IMG_7964.JPG','IMG_7966.JPG'], 30000, { measurements:'16 × 9 × 10,5 cm de profundidad.', flag:'' }),
  s('Rodillera ortopédica ACE', 'Salud y cuidado personal', ['IMG_7968.JPG'], 50000, { flag:'' }),
  s('Sombrero de sol tejido', 'Accesorios', ['IMG_7969.JPG'], 54000, { flag:'' }),
  s('Juego de 5 abanicos decorativos', 'Decoración', ['IMG_7972.JPG','IMG_7974.JPG'], 90000, { flag:'' }),
  s('Juego de 4 ruedas giratorias Fascy de 1 pulgada', 'Herramientas', ['IMG_7973.JPG'], 60000, { included:['Cuatro ruedas visibles'], structure:'Un juego de 4 piezas.', functionality:'Giro y rodamiento no verificados.' }),
  s('Portavela decorativo', 'Decoración', ['IMG_7975.JPG'], 40000, { excluded:'Vela no confirmada como incluida.', flag:'Confirmar si incluye vela.' }),
  s('Reloj de pared marrón', 'Decoración', ['IMG_7976.JPG'], 70000, { flag:'' }),
  s('Armario de madera', 'Muebles', ['IMG_7647~2-EDIT.jpg','IMG_7649~2.JPG','IMG_7648~2.JPG'], 1500000, { delayed:true, vehicle:true, help:true, status:'SOLD', description:'Armario de madera. Artículo vendido.', excluded:'Ropa y objetos interiores no incluidos.', flag:'La foto IMG_7798.JPG estaba vacía/corrupta y permanece excluida.' }),
  s('Televisor JVC LT-65KM858 QLED Pro 65 4K Google TV', 'Electrónica', ['PXL_20260926_182112288.jpg','PXL_20260926_182042688.jpg','PXL_20260926_182002882.jpg'], 2000000, { delayed:true, vehicle:true, description:'Televisor JVC modelo LT-65KM858, QLED Pro de 65 pulgadas, 4K con Google TV. Aproximadamente 6 meses.', flag:'' }),
  s('Gancho transparente con ventosa', 'Hogar', ['IMG_7814~2.JPG'], 12000, { quantity:4, description:'Gancho transparente con ventosa, vendido por unidad.', structure:'Precio por unidad; 4 unidades disponibles ahora. Otras 3 unidades se publican por separado con retiro posterior.', measurements:'Ventosa de aproximadamente 6 cm de diámetro; altura total aproximada 12 cm.', flag:'' }),
  s('Dispensador de jabón gris', 'Hogar', ['IMG_7817~2.JPG'], 40000, { functionality:'Bomba no verificada.', flag:'Confirmar capacidad y funcionamiento.' }),
  s('UPS Forza', 'Electrónica', ['IMG_7819~2.JPG','IMG_7821~2.JPG'], 250000, { functionality:'No verificado.', flag:'Modelo y capacidad no legibles; probar batería bajo carga.', research:forza, market:[180000,320000] }),
  s('Maza corta de 1,719 kg', 'Herramientas', ['IMG_7842~2.JPG'], 50000, { measurements:'Peso aproximado: 1.719 g.', flag:'' }),
  s('Espátula o raspador', 'Herramientas', ['IMG_7842~2a.jpg'], 5000, { flag:'' }),
  s('Juegos de brocas', 'Herramientas', ['IMG_7844~2.JPG'], 120000, { included:['Estuches y brocas visibles'], description:'Conjunto de brocas de distintos tamaños. Algunas piezas Bosch son visibles en las fotografías.', flag:'' }),
  s('Cortahierro / cincel plano para mampostería', 'Herramientas', ['IMG_7845~2a.jpg'], 10000, { description:'Cortahierro o cincel plano para trabajos de mampostería, pensado para golpear con martillo o maza al picar o abrir canaletas.', structure:'Una herramienta. Los otros dos artículos fotografiados originalmente se venderán por separado.', flag:'' }),
];

function item(spec: Spec, index: number): Volume2BatchItem {
  const itemNumber = 58 + index;
  const delayed = Boolean(spec.delayed);
  const marketLow = spec.market?.[0] ?? Math.max(10000, Math.round(spec.asking * 0.8 / 10000) * 10000);
  const marketHigh = spec.market?.[1] ?? Math.max(marketLow, Math.round(spec.asking * 1.35 / 10000) * 10000);
  const quantity = spec.quantity ?? 1;
  const excluded = spec.excluded ?? '';
  const functionality = spec.functionality ?? 'No aplica o no requiere prueba funcional específica; estado estructural no verificado.';
  return {
    id: `real-202609-volume2-${itemNumber}`,
    itemNumber,
    title: spec.title,
    category: spec.category,
    description: [spec.description ?? spec.title, excluded].filter(Boolean).join(' '),
    condition: spec.condition ?? 'Estado visual según fotografías',
    conditionNotes: '',
    functionality,
    knownDefects: [functionality, spec.flag ?? ''].filter(Boolean).join(' '),
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
    status: spec.status ?? 'AVAILABLE',
    needsReview: Boolean(spec.needsReview),
  };
}

export const VOLUME2_BATCH_ITEMS: Volume2BatchItem[] = specs.map(item);

if (VOLUME2_BATCH_ITEMS.length !== 101 || VOLUME2_BATCH_ITEMS.at(-1)?.itemNumber !== 158) {
  throw new Error('El Volumen 2 debe conservar exactamente los Item IDs 058–158.');
}
