import path from 'node:path';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import {
  loadExistingProducts, optimizeGroups, optimizeReferencePhotos, slugify,
  validateCatalog, writeBatchModule, writeReports,
} from './workflow.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const intakeDir = 'C:/Users/davel/Downloads/Vol 4/originals';
const workbook = 'C:/Users/davel/Downloads/Vol 4/notes measurements for pics vol 6^J7.xlsx';
const outputDir = path.join(root, 'images/volume-4');
const referenceDir = path.join(root, '.volume4-pilot/reference-images');
const reportDir = path.join(root, 'volume4/review-output');
const batchFile = path.join(root, 'source/lib/volume4-batch.mjs');

const originalEntries = (await readdir(intakeDir, { withFileTypes: true })).filter(entry => entry.isFile());
const filenameByNumber = new Map(originalEntries.map(entry => [Number(entry.name.match(/(\d{3})(?=\.[^.]+$)/)?.[1]), entry.name]));
function names(numbers) {
  return numbers.map(number => {
    const name = filenameByNumber.get(number);
    if (!name) throw new Error(`Missing original photo number ${number}.`);
    return name;
  });
}
function g(id, photoNumbers, title, category, description, options = {}) {
  return {
    groupId: String(id).padStart(3, '0'), photos: names(photoNumbers),
    referencePhotos: names(options.reference || []), title, category, description,
    condition: options.condition || '', defects: options.defects ?? 'Desgaste por uso normal.',
    functionality: options.functionality || '', dimensions: options.dimensions || '',
    quantity: options.quantity || 1, saleMode: options.saleMode || 'IMMEDIATE',
    included: options.included || [], notIncludedVisible: options.notIncludedVisible || '',
    flags: options.flags || [], sheet: options.sheet || '', pricingReference: options.pricingReference || '',
    coverIndex: options.coverIndex || 0,
  };
}

const groups = [
  g(1,[2,3,4,5,6,189,190,191,296],'Centro de lavado LG WashTower WK14BS6R','Electrodomésticos','Centro de lavado vertical LG WashTower con lavadora de 14 kg y secadora de 10 kg. Control central, conectividad LG ThinQ y acabado color inox.',{reference:[168,169,170],condition:'Muy buen estado',functionality:'Funciona bien',dimensions:'60 × 165,5 × 66 cm',saleMode:'DELAYED',included:['Mangueras','Rejilla de secado','Pernos de transporte','Llave para ajuste de altura'],sheet:'2-6, 168-170, 189-191, 296',pricingReference:'Pagado: USD 1.682 en marzo de 2026',flags:['Confirmar precio de venta y fecha exacta de retiro.','Las fotos 168-170 son solo de referencia técnica.']}),
  g(2,[7],'Hidrolavadora Wasko Bravo de 1600 W','Herramientas','Hidrolavadora eléctrica Wasko Bravo de 1600 W para limpieza doméstica.',{condition:'Buen estado',functionality:'Funciona bien',saleMode:'DELAYED',included:['Manguera','Lanza','Adaptador de filtro de agua'],sheet:'7'}),
  g(3,[8],'Juego de bandejas para hielo con recipiente','Cocina','Conjunto para preparar y guardar cubos de hielo, con bandejas y recipiente plástico.',{defects:'',flags:['Confirmar cantidad exacta de piezas incluidas.']}),
  g(4,[9],'Cafetera italiana de acero inoxidable','Cocina','Cafetera tipo moka de acero inoxidable para preparar café sobre cocina.',{functionality:'',flags:['Confirmar capacidad y funcionamiento.']}),
  g(5,[10,11],'Kit de decoración para repostería','Cocina','Juego de accesorios para decorar tortas y otros productos de repostería.',{flags:['Confirmar inventario exacto de accesorios.']}),
  g(6,[12,13],'Caja organizadora de madera para té','Cocina','Caja de madera con divisiones interiores para organizar sobres de té.',{}),
  g(7,[14],'Vaso térmico de acero inoxidable','Cocina','Vaso térmico reutilizable de acero inoxidable con tapa.',{flags:['Confirmar capacidad.']}),
  g(8,[15,16],'Bol de vidrio con tapa azul','Cocina','Bol de vidrio para servir o conservar alimentos, con tapa plástica azul.',{condition:'Buen estado',included:['Tapa azul'],sheet:'15-16',flags:['Capacidad aproximada de 3 L pendiente de confirmación.']}),
  g(9,[17],'Lámpara de mesa morada','Decoración','Lámpara de mesa morada con pantalla y bombilla.',{condition:'Estado regular',defects:'Base reparada. Desgaste por uso normal.',functionality:'Funciona bien',dimensions:'36 cm de alto × 22 cm de diámetro',included:['Pantalla','1 bombilla'],sheet:'17'}),
  g(10,[18,19,20,303],'Kit de barra negra para utensilios de cocina','Cocina','Barra metálica negra para colgar cucharones, espátulas y otros utensilios. Se vende cada kit por separado.',{reference:[346,347,348,349],condition:'Buen estado',defects:'Desgaste por uso normal.',quantity:3,included:['1 barra','2 soportes de pared','2 ganchos grandes de aproximadamente 4 pulgadas','5 ganchos pequeños de aproximadamente 3 pulgadas','Herrajes pequeños de montaje'],sheet:'18-20; owner correction adds 303, 346-349',flags:['Tres kits disponibles; precio debe ser por kit.','Fotos 346-349 son referencias visuales y no forman parte de la galería pública.']}),
  g(11,[21,22],'Portatorta plástico con tapa y asa','Cocina','Recipiente plástico para transportar y conservar tortas, con tapa y asa.',{}),
  g(12,[23,24],'Espátula Tramontina con mango de madera','Cocina','Espátula metálica Tramontina con mango de madera.',{condition:'Buen estado',sheet:'23-24'}),
  g(13,[25],'Espátula Tramontina','Cocina','Espátula metálica Tramontina para cocinar.',{condition:'Buen estado',sheet:'25',pricingReference:'Precio pagado registrado: Gs. 38.950'}),
  g(14,[26,27],'Canasta cuadrada con borde negro','Hogar','Canasta cuadrada tejida con borde de cuerina negra.',{condition:'Buen estado',dimensions:'29 × 29 cm; profundidad pendiente',sheet:'26-27',flags:['Falta medir la profundidad.']}),
  g(15,[28,29],'Juego de seis copas de vidrio','Cocina','Juego de seis copas de vidrio transparente.',{quantity:1,flags:['Confirmar que se vende como juego completo de seis.']}),
  g(16,[30],'Par de copas decorativas','Cocina','Dos copas decorativas con diseño en el tallo.',{quantity:1}),
  g(17,[31,32,33,34,35],'Olla de cocción lenta con funda','Electrodomésticos','Olla eléctrica de cocción lenta con tapa de vidrio y funda para transporte.',{flags:['Confirmar marca, capacidad y funcionamiento.']}),
  g(18,[36,37],'Fuente Marinex de vidrio templado con tapa roja','Cocina','Fuente rectangular Marinex de vidrio templado de 5 L con tapa roja.',{condition:'Buen estado',dimensions:'35 × 24 × 7 cm',included:['Tapa roja'],sheet:'36-37'}),
  g(19,[39],'Cacerola Tramontina mediana con tapa','Cocina','Cacerola Tramontina de 2,35 L con mango y tapa.',{condition:'Buen estado',dimensions:'22 cm de diámetro',included:['Tapa'],sheet:'39'}),
  g(20,[40],'Cacerola Tramontina pequeña con tapa','Cocina','Cacerola Tramontina de 1,2 L con mango y tapa adaptada.',{condition:'Buen estado',dimensions:'18 cm de diámetro',included:['Tapa no original que ajusta al recipiente'],sheet:'40'}),
  g(21,[41,42,43],'Olla Tramontina grande de 4 L','Cocina','Olla Tramontina de 4 L con asas laterales y tapa.',{condition:'Buen estado',dimensions:'22 cm de diámetro',included:['Tapa'],sheet:'41-43'}),
  g(22,[44,45,46],'Olla Tramontina mediana de 3,2 L','Cocina','Olla Tramontina de 3,2 L con asas laterales y tapa.',{condition:'Buen estado',dimensions:'22 cm de diámetro',included:['Tapa'],sheet:'44-46'}),
  g(23,[48,49,50],'Olla a presión de 5 L','Cocina','Olla a presión de 5 L con tapa.',{condition:'Buen estado',defects:'Pequeña grieta en el mango; no afecta el funcionamiento. Desgaste por uso normal.',functionality:'Funciona muy bien',saleMode:'DELAYED',included:['Tapa'],sheet:'48-50'}),
  g(24,[51,52],'Molde Wilton rectangular para hornear','Cocina','Molde metálico Wilton para pan, pastel de carne u otras preparaciones al horno.',{condition:'Estado regular',dimensions:'15 × 27 × 7 cm',sheet:'51-52',flags:['Las fotos muestran otros moldes; confirmar cuáles se incluyen en esta venta.']}),
  g(25,[53,54],'Bol blanco con base de goma','Cocina','Bol blanco profundo con base antideslizante de goma.',{condition:'Buen estado',dimensions:'27 cm de diámetro × 14 cm de profundidad',sheet:'53-54'}),
  g(26,[57,241,242,243],'Sartén Lodge de hierro fundido','Cocina','Sartén Lodge de hierro fundido con pico vertedor y mango largo.',{flags:['Confirmar diámetro.']}),
  g(27,[58],'Surtido de papel aluminio y bolsas para cocina','Cocina','Surtido de consumibles para envolver y guardar alimentos.',{defects:'',flags:['Confirmar inventario y si se vende como un solo lote.']}),
  g(28,[60],'Par de protectores de fieltro para sartenes','Cocina','Dos separadores de fieltro para proteger sartenes y ollas al apilarlas.',{condition:'Buen estado',defects:'',dimensions:'35 cm',quantity:2,sheet:'60'}),
  g(29,[62],'Canastas plásticas rosa y durazno','Hogar','Dos canastas plásticas, una rosa y una color durazno.',{condition:'Buen estado',dimensions:'33 × 21 × 26 cm',quantity:2,sheet:'62',flags:['Confirmar si se venden juntas o por separado.']}),
  g(30,[65],'Canasta coladora para freír','Cocina','Canasta metálica con mango para freír o escurrir alimentos.',{condition:'Buen estado',sheet:'65'}),
  g(31,[66],'Surtido de utensilios de cocina','Cocina','Surtido de utensilios manuales para cocina.',{flags:['Confirmar piezas incluidas y modalidad de venta.']}),
  g(32,[67],'Surtido de utensilios pequeños de cocina','Cocina','Conjunto de utensilios pequeños para preparación y servicio de alimentos.',{flags:['Confirmar piezas incluidas y modalidad de venta.']}),
  g(33,[69,70],'Organizador de cubiertos','Cocina','Bandeja organizadora con divisiones para cubiertos y utensilios.',{}),
  g(34,[71],'Canasta rectangular grande tejida','Hogar','Canasta rectangular grande de material tejido.',{condition:'Buen estado',dimensions:'37 × 47 cm',sheet:'71',flags:['Confirmar material y profundidad.']}),
  g(35,[72,73,74,75],'Juego de tres rejillas para enfriar','Cocina','Juego de tres rejillas revestidas para enfriar productos horneados.',{condition:'Buen estado',functionality:'Funciona bien',included:['3 rejillas'],sheet:'72-75',pricingReference:'Precio pagado registrado: Gs. 110.000 por el juego'}),
  g(36,[78,79],'Recipiente transparente con tapa marrón','Cocina','Recipiente transparente para almacenamiento con tapa marrón. Dos unidades disponibles, vendidas por separado.',{condition:'Buen estado',dimensions:'16 × 27 × 16 cm',quantity:2,included:['Tapa marrón'],sheet:'78-79'}),
  g(37,[80],'Fuente decorativa con pedestal','Decoración','Fuente decorativa con pedestal y bomba sumergible.',{condition:'Estado regular',defects:'Pequeños saltados en la cerámica y manchas de agua. Desgaste por uso normal.',functionality:'Funciona bien',dimensions:'Pedestal: 58 cm de alto. Fuente: 29 cm de ancho × 55 cm de alto',included:['Bomba sumergible'],sheet:'80'}),
  g(38,[81,82,83],'Kit de recipientes plásticos con tapas','Cocina','Juego de recipientes plásticos de varios tamaños con sus tapas.',{included:['Recipientes y tapas mostrados'],flags:['Confirmar cantidad exacta de recipientes.']}),
  g(39,[84],'Juego de tres botellas rociadoras','Hogar','Juego de tres botellas plásticas con rociador.',{quantity:1,flags:['Confirmar que se vende como juego de tres.']}),
  g(40,[85],'Par de recipientes plásticos','Cocina','Dos recipientes plásticos transparentes para almacenamiento.',{flags:['Confirmar si se venden juntos o por separado.']}),
  g(41,[86,87],'Juego blanco de té o café','Cocina','Juego blanco para servir té o café, con piezas coordinadas.',{flags:['Confirmar cantidad exacta de piezas.']}),
  g(42,[88,89],'Juego de seis vasos de vidrio','Cocina','Juego de seis vasos de vidrio transparente.',{}),
  g(43,[90,91],'Par de recipientes cerámicos con tapa','Cocina','Dos recipientes cerámicos blancos con tapa.',{}),
  g(44,[95,96],'Paraguas con diseño de cebra','Accesorios personales','Paraguas plegable con estampado de cebra y funda.',{}),
  g(45,[97,98],'Portafolio marrón','Accesorios personales','Portafolio marrón con asas y compartimentos interiores.',{}),
  g(46,[99],'Surtido de espátulas y raspadores','Cocina','Conjunto de espátulas y raspadores manuales.',{flags:['Confirmar cantidad y modalidad de venta.']}),
  g(47,[100],'Surtido de pinceles','Manualidades','Surtido de pinceles de varios tamaños para pintura y manualidades.',{flags:['Confirmar cantidad.']}),
  g(48,[104],'Surtido de cajas decorativas pequeñas','Decoración','Conjunto de cajas pequeñas decorativas.',{flags:['Confirmar cantidad y si se vende como lote.']}),
  g(49,[105,106],'Paraguas azul a cuadros','Accesorios personales','Paraguas plegable azul con diseño a cuadros y funda.',{}),
  g(50,[107],'Surtido de accesorios decorativos de escritorio','Oficina','Conjunto de accesorios pequeños para escritorio y organización.',{flags:['Confirmar piezas incluidas y modalidad de venta.']}),
  g(51,[108],'Par de protectores impermeables para celular','Accesorios personales','Dos fundas impermeables transparentes para proteger un celular durante actividades acuáticas.',{defects:'',quantity:2,flags:['Confirmar profundidad máxima de uso y si se venden juntas o por separado.']}),
  g(52,[109,110],'Tres topes para puertas','Hogar','Conjunto de tres topes para puertas: una cuña decorativa y dos dispositivos negros, incluido un tipo que ayuda a evitar el cierre completo.',{quantity:3,flags:['Confirmar si los tres se venden juntos o por separado.']}),
  g(53,[112,113],'Bolsa organizadora de zapatos para debajo de la cama','Hogar','Bolsa plana con divisiones para guardar zapatos debajo de la cama.',{flags:['Falta medir.']}),
  g(54,[114,115],'Juego de recipientes de vidrio con tapas','Cocina','Juego de recipientes de vidrio para alimentos con tapas plásticas.',{flags:['Confirmar cantidad exacta de piezas.']}),
  g(55,[116],'Recipiente de vidrio con tapa','Cocina','Recipiente de vidrio para alimentos con tapa. Dos unidades disponibles, vendidas por separado.',{quantity:2,included:['Tapa'],flags:['Confirmar capacidad.']}),
  g(56,[117,118,120,121],'Bolso de viaje con ruedas','Accesorios personales','Bolso de viaje con ruedas, asa extensible y compartimentos.',{reference:[226,227],condition:'Estado regular',defects:'Ruedas dañadas. Desgaste por uso normal.',flags:['Fotos 226-227 documentan el daño de las ruedas y son solo de referencia interna.']}),
  g(57,[122,123],'Extintor portátil','Hogar','Extintor portátil para uso doméstico o vehicular.',{flags:['Confirmar vigencia, carga, capacidad y estado operativo antes de ofrecerlo.']}),
  g(58,[124,125],'Banquito plegable verde','Hogar','Banquito plástico plegable color verde.',{flags:['Confirmar capacidad de carga.']}),
  g(59,[126,127],'Recipiente plástico apilable','Hogar','Recipiente plástico transparente con tapa. Cuatro unidades disponibles, vendidas por separado.',{quantity:4,flags:['Las fotos parecen mostrar más de cuatro recipientes; confirmar cuáles cuatro forman la venta.']}),
  g(60,[128,129],'Recipiente alto para alimentos secos','Cocina','Recipiente alto transparente con tapa para cereales u otros alimentos secos.',{quantity:2,flags:['Confirmar si hay dos unidades y si se venden por separado.']}),
  g(61,[130],'Rieles metálicos para herramientas','Herramientas','Rieles metálicos para organizar herramientas en la pared.',{flags:['Faltan las fotos adicionales y los accesorios que el propietario planea proporcionar.','Confirmar cantidad de rieles y piezas incluidas.']}),
  g(62,[131,132],'Juego de protectores para mesa','Hogar','Juego de protectores rectangulares con diseño de tazas para apoyar objetos sobre una mesa.',{flags:['Confirmar uso, material y cantidad.']}),
  g(63,[134],'Pinza de cocina','Cocina','Pinza manual para sujetar y servir alimentos.',{}),
  g(64,[135,136],'Serrucho manual','Herramientas','Serrucho manual con mango plástico. Dos unidades disponibles.',{quantity:2,flags:['Confirmar si se venden por separado.']}),
  g(65,[137,138],'Machete con mango negro','Herramientas','Machete de hoja larga con mango negro.',{flags:['Confirmar largo de la hoja y condición del filo.']}),
  g(66,[139],'Bolsas de sustrato para plantas','Jardín','Dos bolsas de sustrato para jardinería.',{defects:'',quantity:2,flags:['Confirmar contenido restante y si se venden juntas.']}),
  g(67,[140,141],'Espátula metálica de cocina','Cocina','Espátula metálica de cocina. Dos unidades disponibles.',{quantity:2,flags:['Confirmar si se venden por separado.']}),
  g(68,[142],'Herramienta enrollada para parrilla','Herramientas','Herramienta metálica enrollada para limpieza o mantenimiento de parrilla.',{flags:['Confirmar uso exacto y medidas.']}),
  g(69,[144],'Barra blanca extensible a presión','Hogar','Barra blanca extensible a presión para cortina u organización.',{condition:'Buen estado',functionality:'Funciona bien',dimensions:'55 a 98 cm',sheet:'144'}),
  g(70,[145],'Barra negra extensible para cortina','Hogar','Barra negra extensible para cortina.',{condition:'Buen estado',functionality:'Funciona bien',dimensions:'65 a 126 cm',sheet:'145'}),
  g(71,[146],'Barra gris plateada extensible','Hogar','Barra gris plateada extensible para cortina.',{condition:'Buen estado',functionality:'Funciona bien',dimensions:'155 a 210 cm',sheet:'146'}),
  g(72,[147],'Barra marrón para cortina','Hogar','Barra marrón para cortina.',{condition:'Buen estado',defects:'No incluye soportes. Desgaste por uso normal.',functionality:'Funciona bien',dimensions:'155 cm',sheet:'147'}),
  g(73,[148],'Barra blanca extensible para cortina de baño','Hogar','Barra plástica blanca extensible para cortina de baño.',{condition:'Buen estado',functionality:'Funciona bien',dimensions:'148 a 255 cm',sheet:'148'}),
  g(74,[149],'Barra extensible para cortina de baño','Hogar','Barra plástica extensible para cortina de baño. Dos unidades disponibles, vendidas por separado.',{condition:'Buen estado',functionality:'Funciona bien',dimensions:'148 a 255 cm',quantity:2,sheet:'149',pricingReference:'Precio pagado registrado: Gs. 33.500'}),
  g(75,[150,151],'Barra gris extensible para armario','Hogar','Barra gris extensible para armario con extremos rectangulares.',{condition:'Buen estado',functionality:'Funciona bien',dimensions:'67 a 126 cm',sheet:'150-151'}),
  g(76,[152],'Barra extensible para piscina','Jardín','Barra extensible para accesorios de limpieza de piscina.',{condition:'Buen estado',functionality:'Funciona bien',dimensions:'Largo mínimo: 217 cm',sheet:'152',flags:['Falta medir el largo máximo.']}),
  g(77,[153,154],'Portavelas de vidrio','Decoración','Portavelas de vidrio transparente.',{condition:'Estado regular',defects:'Pequeña grieta cerca de la base. Desgaste por uso normal.',quantity:2,flags:['Confirmar si se vende el par o una sola unidad.']}),
  g(78,[155],'Gabinetes altos','Muebles','Gabinetes altos para almacenamiento, mostrados lado a lado.',{quantity:2,flags:['Confirmar si son dos unidades vendidas juntas o por separado.','Faltan las fotos relacionadas mencionadas por el propietario y la planilla.']}),
  g(79,[156],'Tela azul oscura','Hogar','Pieza de tela azul oscura para uso doméstico.',{flags:['Confirmar tipo de artículo y medidas.']}),
  g(80,[157],'Lona protectora para pintura y obra','Herramientas','Lona protectora para cubrir pisos o muebles durante trabajos de pintura o construcción.',{condition:'Buen estado',defects:'Manchas de pintura por uso.',dimensions:'268 × 180 cm',sheet:'157'}),
  g(81,[158],'Tela rosada','Manualidades','Pieza de tela rosada.',{flags:['Confirmar material, uso y medidas.']}),
  g(82,[159],'Tela gris','Manualidades','Pieza de tela gris.',{flags:['Confirmar material, uso y medidas.']}),
  g(83,[160],'Surtido de estuches de viaje','Accesorios personales','Conjunto de estuches y accesorios pequeños para viaje.',{flags:['Confirmar piezas incluidas.']}),
  g(84,[161],'Bolsa reutilizable','Hogar','Bolsa reutilizable con asas.',{flags:['Confirmar medidas.']}),
  g(85,[162,163,164],'Caja transparente con tapa roja','Hogar','Caja plástica transparente con tapa roja para almacenamiento.',{flags:['Confirmar capacidad y medidas.']}),
  g(86,[165,166],'Funda artesanal de tela para libro o Biblia','Accesorios personales','Funda negra artesanal de tela, confeccionada en Camboya, para libro o Biblia de tamaño estándar.',{condition:'Buen estado',dimensions:'20 × 29 × 6 cm',sheet:'165-166'}),
  g(87,[171,172],'Colchón inflable Intex individual','Hogar','Colchón inflable Intex tamaño individual en su empaque.',{flags:['Confirmar condición, accesorios y funcionamiento.']}),
  g(88,[173],'Mantel rojo artesanal','Hogar','Mantel rojo hecho a mano.',{condition:'Buen estado',dimensions:'74 × 78 cm',sheet:'173'}),
  g(89,[174],'Mantel azul marino artesanal','Hogar','Mantel azul marino hecho a mano.',{condition:'Buen estado',dimensions:'181 × 100 cm',sheet:'174'}),
  g(90,[175],'Mantel blanco de encaje artesanal','Hogar','Mantel blanco de encaje hecho a mano.',{condition:'Buen estado',dimensions:'96 × 148 cm',sheet:'175'}),
  g(91,[176],'Camino de mesa colorido artesanal','Hogar','Camino de mesa colorido hecho a mano.',{condition:'Buen estado',dimensions:'57 × 167 cm',sheet:'176'}),
  g(92,[177,178,179],'Camino de mesa gris de gasa','Hogar','Camino de mesa gris de gasa.',{condition:'Buen estado',defects:'Faltan algunas borlas. Desgaste por uso normal.',sheet:'177-179',flags:['Falta medir.']}),
  g(93,[180,182],'Bolso negro','Accesorios personales','Bolso negro flexible para transporte o almacenamiento.',{flags:['Confirmar tipo, uso y medidas.']}),
  g(94,[181],'Bolsa morada enrollable','Accesorios personales','Bolsa morada enrollable para transporte o almacenamiento.',{flags:['Confirmar si es bolsa de dormir y verificar medidas.']}),
  g(95,[183,184],'Juego de fundas para almohada','Hogar','Grupo de fundas textiles para almohada.',{flags:['Confirmar cantidad, tamaños y modalidad de venta.']}),
  g(96,[185,186,187],'Colchoneta de yoga','Salud y cuidado personal','Colchoneta enrollable para yoga o ejercicios.',{defects:'Desgaste visible en el borde. Desgaste por uso normal.',flags:['Confirmar medidas.','No se fusionó con la foto 217 por falta de evidencia suficiente.']}),
  g(97,[188],'Olla Lodge azul de 7,38 L','Cocina','Olla Lodge esmaltada azul de 7,38 L con tapa.',{condition:'Buen estado',included:['Tapa','Protectores de goma'],sheet:'188'}),
  g(98,[192,193,194,195],'Conservadora Coleman de 16 L','Hogar','Conservadora Coleman de 16 L para bebidas y alimentos.',{condition:'Buen estado',dimensions:'36 × 36 × 23 cm',sheet:'192-195'}),
  g(99,[196,197],'Pistola de soldar en empaque','Herramientas','Pistola eléctrica para soldar presentada en su empaque.',{flags:['Confirmar marca, potencia, contenido y funcionamiento.']}),
  g(100,[198,199,200],'Masajeador manual con accesorios','Salud y cuidado personal','Masajeador manual con cabezales intercambiables.',{included:['Cabezales mostrados'],flags:['Confirmar funcionamiento.']}),
  g(101,[201,202],'Linterna de camping Energizer','Electrónica','Linterna Energizer para camping y uso doméstico.',{condition:'Buen estado',functionality:'Funciona bien',dimensions:'14 cm de alto',sheet:'201-202'}),
  g(102,[203],'Tapete azul y naranja','Hogar','Tapete pequeño con diseño azul y naranja.',{condition:'Buen estado',dimensions:'54 × 36 cm',sheet:'203'}),
  g(103,[204,205,206],'Portacaja de pañuelos','Hogar','Cubierta decorativa para colocar sobre una caja rectangular de pañuelos de papel y mantenerla accesible.',{flags:['Confirmar material y medidas.']}),
  g(104,[207],'Surtido de precintos plásticos','Herramientas','Surtido de precintos plásticos de varios tamaños para sujetar y organizar cables u objetos.',{defects:'',flags:['Confirmar cantidad.']}),
  g(105,[208],'Surtido de adhesivos y protectores para muebles','Hogar','Conjunto de piezas adhesivas y protectores para muebles y superficies.',{flags:['Confirmar inventario y uso de cada pieza.']}),
  g(106,[209],'Surtido de artículos de primeros auxilios','Salud y cuidado personal','Conjunto de artículos básicos de primeros auxilios.',{flags:['Revisar fechas de vencimiento, contenido y aptitud de venta antes de aprobar.']}),
  g(107,[210],'Surtido de argollas para cortina','Hogar','Conjunto de argollas que se colocan sobre una barra para sujetar cortinas de baño, cocina, ventana u otros espacios.',{flags:['Confirmar cantidad y si se venden como un solo lote.']}),
  g(108,[211],'Cuerda para saltar de 3 metros','Salud y cuidado personal','Cuerda de 3 metros para saltar y hacer ejercicio.',{condition:'Buen estado',dimensions:'3 m',sheet:'211'}),
  g(109,[212],'Juego de coladores para desagüe','Hogar','Juego de coladores pequeños para desagües de fregadero o lavabo.',{flags:['Reemplazar o actualizar la foto 212 antes de publicar.','Confirmar cantidad y medidas.']}),
  g(110,[213,214,215],'Luz con sensor de movimiento a pilas','Electrónica','Luz a pilas con sensor de movimiento para iluminación auxiliar.',{flags:['Confirmar pilas requeridas, funcionamiento y si admite uso exterior.']}),
  g(111,[217],'Colchoneta de ejercicio morada','Salud y cuidado personal','Colchoneta enrollable morada para ejercicios.',{flags:['Puede pertenecer a la colchoneta de fotos 185-187; confirmar antes de combinar.','Falta medir.']}),
  g(112,[218,219],'Diccionario de derecho','Otros','Diccionario de Derecho de Rafael de Pina y Rafael de Pina Vara, Editorial Porrúa.',{flags:['Confirmar edición y estado interior.']}),
  g(113,[220,221],'Libro guía para escribir notas personales','Otros','Libro “On a Personal Note”, guía en inglés para mejorar la escritura de notas y mensajes personales.',{flags:['Confirmar autores y estado interior.']}),
  g(114,[222],'Surtido de tarjetas y sobres','Manualidades','Conjunto de tarjetas, papeles y sobres de varios colores y diseños.',{flags:['Confirmar cantidad y modalidad de venta.']}),
  g(115,[223,224,225],'Balanza digital Ufesa','Salud y cuidado personal','Balanza digital Ufesa para uso personal.',{condition:'Buen estado',functionality:'',included:['Pila'],sheet:'223-225',flags:['La planilla califica el funcionamiento como regular; confirmar funcionamiento antes de aprobar.']}),
  g(116,[228,229],'Malla media sombra','Jardín','Malla negra tipo media sombra para jardín, patio u otras áreas exteriores.',{flags:['Falta medir largo y ancho.']}),
  g(117,[230],'Juego de ropa de cama celeste','Hogar','Conjunto de piezas textiles celestes para cama.',{flags:['Confirmar piezas, tamaño y modalidad de venta.']}),
  g(118,[231,232],'Toalla gris','Hogar','Toalla gris de tejido absorbente.',{flags:['Confirmar cantidad y medidas.']}),
  g(119,[233,234],'Juego de botellas y vasos plásticos','Cocina','Conjunto de recipientes plásticos para bebidas con tapas y boquillas.',{flags:['Confirmar piezas incluidas y modalidad de venta.']}),
  g(120,[235,236],'Guantes desechables para preparación de alimentos','Cocina','Cajas de guantes desechables transparentes y negros para manipulación de alimentos.',{defects:'',flags:['Las fotos confirman dos tipos de guantes; confirmar tamaños, cantidades restantes y si se venden juntos.']}),
  g(121,[237,320,323],'Mortero con mano','Cocina','Mortero gris con mano para triturar especias y otros ingredientes.',{flags:['Confirmar material y medidas.']}),
  g(122,[238,239],'Par de coladores plásticos','Cocina','Dos coladores plásticos blancos de diferentes tamaños.',{quantity:1}),
  g(123,[240],'Destapacaños de cinta plana','Herramientas','Destapacaños Plomer de cinta plana con carrete, modelo PD-210.',{flags:['Confirmar longitud disponible y condición.']}),
  g(124,[249,250],'Juego de basurero y escobillero para baño','Hogar','Juego coordinado para baño con basurero de pedal y escobillero.',{flags:['Confirmar si se vende como juego.']}),
  g(125,[251,252,253],'Basurero blanco de pedal','Hogar','Basurero circular blanco con tapa y pedal.',{flags:['Confirmar capacidad y medidas.']}),
  g(126,[255],'Surtido de tarjetas y sobres','Manualidades','Conjunto de tarjetas y sobres de varios colores y tamaños.',{flags:['Confirmar cantidad y si se combina con la foto 222.']}),
  g(127,[256,266],'Calentador de tortillas','Cocina','Recipiente térmico de tela para mantener calientes tortillas de maíz o harina recién calentadas.',{}),
  g(128,[259,260],'Recipiente plástico con tapa azul','Cocina','Recipiente plástico rectangular transparente con tapa azul.',{flags:['Confirmar capacidad y medidas.']}),
  g(129,[261,262],'Grupo de cuadernos pequeños','Oficina','Conjunto de cuadernos de varios tamaños y diseños.',{flags:['Confirmar cantidad y modalidad de venta.']}),
  g(130,[263,264,265],'Carpeta grande para documentos','Oficina','Carpeta rígida grande con cierre para organizar documentos.',{flags:['Confirmar si admite papel A4 y carta; faltan medidas.']}),
  g(131,[267],'Surtido de notas adhesivas','Oficina','Conjunto de notas adhesivas de varios tamaños y colores.',{defects:'',flags:['Confirmar cantidad restante.']}),
  g(132,[268],'Surtido de lápices, marcadores y bolígrafos','Oficina','Conjunto de lápices de colores, marcadores, bolígrafos y otros útiles de escritura.',{flags:['Confirmar inventario y condición de tinta.']}),
  g(133,[269],'Portapapeles negro','Oficina','Portapapeles negro con pinza metálica.',{}),
  g(134,[270],'Surtido de útiles de oficina','Oficina','Conjunto con chinches, clips, sujetadores tipo binder y dos lápices táctiles.',{flags:['Confirmar cantidad exacta de cada pieza.']}),
  g(135,[271],'Surtido de fichas y cuadernos pequeños','Oficina','Conjunto de fichas de colores y cuadernos pequeños.',{flags:['Confirmar inventario y modalidad de venta.']}),
  g(136,[272],'Surtido escolar infantil','Oficina','Conjunto escolar con cuaderno de alfabetización, lápices y accesorios.',{flags:['Confirmar piezas incluidas.']}),
  g(137,[273],'Surtido de papel cuadriculado y lápices','Oficina','Conjunto de blocs de papel cuadriculado, lápices y accesorios.',{flags:['Confirmar piezas incluidas.']}),
  g(138,[274],'Paquetes de láminas autoadhesivas para plastificar','Oficina','Paquetes de láminas autoadhesivas para plastificar sin máquina.',{defects:'',flags:['Confirmar cantidad de láminas restantes.']}),
  g(139,[275],'Surtido de cartulinas y cuadernos','Oficina','Conjunto de cartulinas de colores y cuadernos.',{flags:['Confirmar inventario y modalidad de venta.']}),
  g(140,[276,277],'Caja plástica blanca con tapa','Hogar','Caja plástica transparente con tapa blanca para almacenamiento.',{flags:['Confirmar capacidad y medidas.']}),
  g(141,[278],'Surtido de carpetas plásticas','Oficina','Conjunto de carpetas plásticas de varios colores.',{flags:['Confirmar cantidad.']}),
  g(142,[279],'Surtido de fundas plásticas para documentos','Oficina','Conjunto de fundas plásticas para archivar documentos.',{flags:['Confirmar tamaños y cantidad.']}),
  g(143,[280,281,282],'Grupo de carpetas con anillos','Oficina','Conjunto de carpetas con anillos y bolsillos interiores.',{flags:['Confirmar cantidad y modalidad de venta.']}),
  g(144,[283],'Carpetas con separadores y protectores A4','Oficina','Conjunto de carpetas con separadores y fundas protectoras para documentos A4.',{flags:['Confirmar cantidad y piezas incluidas.']}),
  g(145,[284],'Juego de lápices de grafito y colores','Oficina','Estuche Studio C con lápices de colores, lápices de grafito y sacapuntas.',{defects:'',flags:['Confirmar que el estuche está completo.']}),
  g(146,[285],'Surtido de sellos y tintas para manualidades','Manualidades','Conjunto de sellos decorativos y almohadillas de tinta.',{flags:['Confirmar piezas incluidas y estado de las tintas.']}),
  g(147,[286],'Surtido para álbumes y manualidades','Manualidades','Conjunto de papeles, plantillas y accesorios para álbumes y proyectos creativos.',{flags:['Confirmar inventario.']}),
  g(148,[287],'Espejo de cuerpo entero con soporte','Hogar','Espejo vertical de cuerpo entero con estructura negra y soporte inferior.',{flags:['Falta medir.']}),
  g(149,[288,289,290,291,292,293,294,295],'SsangYong Rexton RJ290 2002 diésel','Otros','SsangYong Rexton RJ290 año 2002, diésel, con aproximadamente 230.000 km. Primer propietario en Paraguay; importado desde Corea vía Chile. Incluye amplificador de audio y subwoofer trasero de aproximadamente 8 pulgadas. Neumáticos Dunlop Grandtrek AT5 de uso reciente.',{condition:'Buen estado',functionality:'Funciona muy bien',included:['Amplificador de audio instalado','Subwoofer trasero de aproximadamente 8 pulgadas'],flags:['Confirmar precio, documentación, kilometraje exacto y disponibilidad.','El propietario estima menos de 1.000 km de uso en los neumáticos; mantener como dato sujeto a confirmación.','No se infirieron cilindrada, potencia, tracción ni tipo de transmisión.']}),
  g(150,[298],'Tapa metálica grande para olla','Cocina','Tapa metálica genérica para olla o sartén.',{condition:'Estado regular',defects:'Está doblada y presenta decoloración por uso.',functionality:'Funciona bien',dimensions:'34 cm de diámetro',sheet:'298'}),
  g(151,[299],'Tapa grande de silicona gris','Cocina','Tapa flexible de silicona gris para olla o sartén.',{condition:'Buen estado',dimensions:'28 cm de diámetro',sheet:'299'}),
  g(152,[300],'Tapa de silicona azul','Cocina','Tapa flexible de silicona azul para olla o sartén.',{condition:'Buen estado',dimensions:'22 cm de diámetro',sheet:'300'}),
  g(153,[301,302],'Par de jarras medidoras OXO','Cocina','Dos jarras medidoras OXO transparentes con mango negro, de diferentes capacidades.',{flags:['Confirmar capacidades y si se venden juntas.']}),
  g(154,[304,309],'Canasta plegable para cocinar al vapor','Cocina','Canasta metálica plegable para cocinar verduras u otros alimentos al vapor dentro de una olla.',{}),
  g(155,[305,310],'Mandolina manual con protector','Cocina','Mandolina manual para cortar alimentos en láminas, con protector para la mano.',{included:['Protector para la mano']}),
  g(156,[306,311],'Rallador metálico de cuatro caras','Cocina','Rallador metálico tipo caja con cuatro caras.',{}),
  g(157,[307,312],'Cuchara grande perforada','Cocina','Cuchara plástica grande perforada para servir y escurrir alimentos.',{}),
  g(158,[308,313],'Pala plástica pequeña','Cocina','Pala plástica transparente pequeña para servir o dosificar alimentos.',{}),
  g(159,[314],'Par de platos llanos','Cocina','Dos platos llanos blancos de tamaño estándar para comida.',{condition:'Buen estado',quantity:2,sheet:'314',flags:['Falta medir el diámetro.']}),
  g(160,[315],'Juego de cinco platos Corelle grandes','Cocina','Juego de cinco platos llanos Corelle de tamaño grande.',{condition:'Buen estado',quantity:5,sheet:'315',flags:['Falta medir el diámetro.']}),
  g(161,[316],'Juego de seis cuchillos de mesa','Cocina','Juego de seis cuchillos de mesa con mango blanco.',{condition:'Buen estado',quantity:6,sheet:'316'}),
  g(162,[317],'Juego de cuatro cucharas','Cocina','Juego de cuatro cucharas con mango blanco.',{condition:'Buen estado',quantity:4,sheet:'317'}),
  g(163,[318],'Juego de cuatro tenedores','Cocina','Juego de cuatro tenedores con mango blanco.',{condition:'Buen estado',quantity:4,sheet:'318'}),
  g(164,[319,322],'Escurridor metálico para vasos y platos','Cocina','Escurridor metálico con soportes exteriores para vasos y una sección central para platos u otros artículos.',{flags:['Confirmar medidas.']}),
  g(165,[321,324],'Salvamanteles metálico','Cocina','Base metálica para colocar debajo de ollas y fuentes calientes y proteger la mesa o mesada.',{flags:['Confirmar diámetro.']}),
  g(166,[325],'Par de bols de vidrio templado','Cocina','Dos bols de vidrio templado de tamaño regular.',{quantity:2,flags:['Confirmar medidas y si se venden como par.']}),
  g(167,[326],'Bol pequeño negro con flores','Cocina','Bol pequeño negro con diseño floral blanco.',{flags:['Confirmar material y medidas.']}),
  g(168,[327],'Bol pequeño de vidrio','Cocina','Bol pequeño de vidrio transparente.',{flags:['Confirmar capacidad y medidas.']}),
  g(169,[328],'Juego de platos Corelle medianos y pequeños','Cocina','Juego con tres platos Corelle medianos y tres platos Corelle pequeños.',{condition:'Buen estado',quantity:6,sheet:'328',flags:['Falta medir los diámetros.','Confirmar que las seis piezas se venden como un solo juego.']}),
  g(170,[329,331],'Caja organizadora Sanremo con ruedas','Hogar','Caja plástica transparente Sanremo con tapa y ruedas para almacenamiento.',{flags:['Confirmar capacidad y medidas.']}),
  g(171,[330,332],'Caja organizadora alta con asa','Hogar','Caja plástica alta y transparente con tapa, asa y cierres azules, de 6,5 L.',{}),
  g(172,[333],'Jarra de repuesto para cafetera Black & Decker de 12 tazas','Electrodomésticos','Jarra de vidrio de repuesto proveniente de una cafetera Black & Decker de 12 tazas.',{flags:['Confirmar modelos compatibles antes de publicar.']}),
  g(173,[334],'Jarra tipo Mason con asa','Cocina','Jarra de vidrio tipo Mason de tamaño estándar con asa.',{flags:['Confirmar capacidad.']}),
  g(174,[335],'Vaso pequeño de vidrio','Cocina','Vaso pequeño de vidrio transparente.',{flags:['Confirmar capacidad.']}),
  g(175,[336,338],'Servilletero metálico negro','Cocina','Servilletero metálico negro para mantener servilletas organizadas y accesibles.',{}),
  g(176,[337,339],'Servilletero plástico transparente','Cocina','Servilletero plástico transparente con diseño decorativo.',{}),
  g(177,[340],'Cinta métrica de 5 metros','Herramientas','Cinta métrica retráctil de 5 m / 16 pies.',{functionality:'',flags:['Confirmar funcionamiento del seguro y la cinta.']}),
  g(178,[341],'Martillo pequeño con destornilladores en el mango','Herramientas','Martillo para trabajos pequeños con varios destornilladores guardados dentro del mango.',{included:['Destornilladores integrados en el mango'],flags:['Confirmar si contiene cuatro o cinco destornilladores y verificar que estén completos.']}),
  g(179,[342,344],'Caja plástica con cierre morado','Hogar','Caja plástica transparente con tapa y cierre morado para almacenamiento.',{flags:['Confirmar capacidad y medidas.']}),
  g(180,[343,345],'Caja plástica con diseño de hojas','Hogar','Caja plástica transparente con tapa decorada con hojas verdes.',{flags:['Confirmar capacidad y medidas.']}),
];

const existingProducts = await loadExistingProducts(root);
const committedMax = Math.max(...existingProducts.map(item => Number(item.itemNumber) || 0));
const response = await fetch('https://thelabossieres.com/.netlify/functions/volume2-catalog', { headers: { accept: 'application/json' } });
if (!response.ok) throw new Error(`Production catalog check failed with ${response.status}.`);
const production = await response.json();
const productionMax = Math.max(...production.products.map(item => Number(item.itemNumber) || 0));
const startingItemNumber = Math.max(committedMax, productionMax) + 1;

const optimized = await optimizeGroups(groups, { intakeDir, outputDir, publicPrefix: '/images/volume-4' });
const reference = await optimizeReferencePhotos(groups, { intakeDir, outputDir: referenceDir });
const products = groups.map((group, index) => {
  const itemNumber = startingItemNumber + index;
  return {
    id: `real-202610-volume4-${itemNumber}`, itemNumber,
    slug: `${slugify(group.title)}-item-${itemNumber}`, title: group.title, category: group.category,
    description: group.description, condition: group.condition, conditionNotes: '', knownDefects: group.defects,
    includedAccessories: group.included, notIncludedVisible: group.notIncludedVisible,
    photos: optimized.photosByGroup.get(group.groupId), asking: null, saleMode: group.saleMode,
    pickupDate: null, pickupWindowStart: null, pickupWindowEnd: null, quantityTotal: group.quantity,
    status: 'NEEDS_REVIEW', needsReview: true, requiresVehicle: group.groupId === '149',
    requiresLoadingHelp: group.groupId === '001', dateListed: '2026-10-11',
  };
});
const reviews = groups.map((group, index) => ({
  itemNumber: startingItemNumber + index, groupId: group.groupId, functionality: group.functionality,
  dimensions: group.dimensions, coverIndex: group.coverIndex,
  sourcePhotos: [...group.photos, ...group.referencePhotos], spreadsheetReference: group.sheet,
  pricingReference: group.pricingReference,
  referenceImages: reference.photosByGroup.get(group.groupId).map(name => `../../.volume4-pilot/reference-images/${name}`),
  flags: ['price: missing; seller asking price required', ...(group.dimensions ? [] : ['dimensions: missing or not applicable; review']),
    ...(group.condition ? [] : ['condition: needs review']), ...(group.functionality ? [] : ['functionality: unknown or not applicable; review']),
    ...group.flags, ...(group.referencePhotos.length ? [`Reference-only photos: ${group.referencePhotos.join(', ')}`] : [])],
}));

await writeBatchModule(batchFile, products);
const validation = await validateCatalog({ root, existingProducts, pilotProducts: products, intakeReport: optimized.report });
const sourceStats = await Promise.all(originalEntries.map(entry => stat(path.join(intakeDir, entry.name))));
const originalBytes = sourceStats.reduce((sum, value) => sum + value.size, 0);
const optimizedBytes = optimized.report.reduce((sum, image) => sum + image.optimizedBytes, 0);
const payload = {
  generatedAt: new Date().toISOString(),
  baseline: { checkpoint: 'bcbe90d54174de4cff18f40164c06648b9302357', committedMax, productionMax,
    productionProductCount: production.products.length },
  startingItemNumber, products, reviews, images: optimized.report, referenceImages: reference.report, validation,
  reconciliation: { sourcePhotoCount: originalEntries.length, spreadsheetDataRows: 75,
    publicCandidatePhotos: optimized.report.length, referenceOnlyPhotos: reference.report.length,
    referenceOnlyPhotoList: reference.report.map(row => row.originalFilename), unassignedPhotos: 0 },
  unresolved: {
    grouping: reviews.filter(review => review.flags.some(flag => /confirmar si|puede pertenecer|parecen mostrar|combina con|modalidad de venta/i.test(flag))).map(review => ({ itemNumber: review.itemNumber, flags: review.flags.filter(flag => /confirmar si|puede pertenecer|parecen mostrar|combina con|modalidad de venta/i.test(flag)) })),
    sellerFacts: reviews.filter(review => review.flags.length > 2).map(review => ({ itemNumber: review.itemNumber, flags: review.flags.slice(2) })),
    missingPrices: products.map(item => item.itemNumber),
    missingMeasurements: reviews.filter(review => !review.dimensions).map(review => review.itemNumber),
    photoReplacements: [startingItemNumber + 108],
  },
  totals: { originalBytes, optimizedBytes, reductionPercent: Number(((1 - optimizedBytes / originalBytes) * 100).toFixed(1)) },
};
await writeReports(reportDir, payload);
await writeFile(path.join(reportDir, 'real-intake-report.json'), JSON.stringify(payload, null, 2), 'utf8');

const workbookBefore = await stat(workbook);
const originalsAfter = await Promise.all(originalEntries.map(async entry => ({ name: entry.name, stat: await stat(path.join(intakeDir, entry.name)) })));
payload.integrity = { workbookSize: workbookBefore.size, originalCountAfter: originalsAfter.length };
process.stdout.write(`${JSON.stringify({ ok: true, startingItemNumber, endingItemNumber: products.at(-1).itemNumber,
  products: products.length, publicCandidatePhotos: optimized.report.length, referenceOnlyPhotos: reference.report.length,
  originalBytes, optimizedBytes, reductionPercent: payload.totals.reductionPercent, validation }, null, 2)}\n`);
