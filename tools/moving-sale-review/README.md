# Volume 5 — revisión local persistente

Base de implementación: `3c715222757deb6593be1469205939e45f3a8e04`. Solo herramientas locales. No hay comando de publicación, importación al sitio ni conexión a inventario operacional. Volume 4 conserva sus rutas, resultados y valores predeterminados.

## Abrir ahora, sin fotos ni números reales

En PowerShell:

```powershell
cd C:\Users\davel\Documents\GitHub\psych-volume5-local-review
npm ci
npm run review:volume5 -- init --output .moving-sale-review/ready
npm run review:volume5 -- serve --output .moving-sale-review/ready
```

Abrir <http://127.0.0.1:5105/review.html>. `init` se ejecuta una sola vez. `serve` se puede volver a ejecutar cuando haga falta, incluso después de cerrar Codex. Requiere Node.js y una terminal local abierta; Codex/Work y una sesión de navegador anterior no son necesarios. El servidor escucha únicamente en este equipo. Cerrar la terminal detiene el servidor sin borrar los datos.

## Ingresar el lote real

Coloque **solo los originales**, sin cambiar sus nombres, en una carpeta plana; por ejemplo:

```text
C:\MovingSale\Volume5\originals\
  frente.jpg
  detalle.jpg
  otro-producto.jpg
C:\MovingSale\Volume5\notes.json   (agrupación explícita obligatoria, fuera de originals)
```

```powershell
cd C:\Users\davel\Documents\GitHub\psych-volume5-local-review
npm run review:volume5 -- ingest --photos "C:\MovingSale\Volume5\originals" --notes "C:\MovingSale\Volume5\notes.json" --output .moving-sale-review/volume5
npm run review:volume5 -- serve --output .moving-sale-review/volume5
```

El ingreso real requiere un manifiesto de agrupación explícita con `--notes`. Sin él, se detiene antes de crear la salida o acceder al registro inmutable: **no asigna números ni crea/modifica el registro**. Primero inspeccione las fotos, resuelva agrupaciones inciertas y enumere cada producto físico o juego intencional. Varias perspectivas de un producto deben estar en un solo grupo y consumen un solo número. Aunque cada foto corresponda a un producto distinto, enumere esos grupos explícitamente; no existe una excepción automática. Solo `--fixture` admite una foto por ensayo sin manifiesto y nunca usa números reales. **No se infiere identidad, precio, funcionamiento ni defectos**.

Con rutas configurables:

```powershell
npm run review:volume5 -- ingest --repo "C:\Users\davel\Documents\GitHub\psych-volume5-local-review" --photos "C:\MovingSale\Volume5\originals" --notes "C:\MovingSale\Volume5\notes.json" --output .moving-sale-review/volume5
```

`example-notes.json` muestra el esquema. Debe enumerar todas las fotos exactamente una vez. Varios archivos en un grupo requieren `groupingJustification`. `referencePhotos` requiere `referenceJustifications` por archivo. El formato de notas `GROUP` de Volume 4 también sirve para fotos individuales; para varias fotos use JSON con justificación. Las notas se conservan con su huella y una copia. No se importa una planilla arbitraria como fuente de hechos sin reconciliarla; convierta sus filas al esquema de notas identificando los archivos. El archivo Excel generado es de revisión, no un mecanismo de importación automática de correcciones.

### Originales excluidos y rotación del propietario

Un original puede quedar fuera de todos los Items mediante una declaración explícita en el JSON:

```json
{
  "groups": [{
    "sourceGroupId": "G014",
    "photos": ["frente.jpg", "detalle.jpg"],
    "groupingJustification": "Dos vistas del mismo recipiente, confirmadas por el propietario.",
    "sellerConfirmed": true,
    "groupingConfirmed": true,
    "product": { "title": "Recipiente", "description": "Recipiente con tapa." }
  }],
  "excludedPhotos": [{ "filename": "ya-publicado.jpg", "reason": "Pertenece a un artículo ya publicado." }],
  "photoTransforms": { "frente.jpg": { "rotateDegrees": -90 } }
}
```

Cada original debe aparecer exactamente una vez como foto pública, referencia justificada o fuente excluida con motivo. Una exclusión no crea Item, foto de referencia, portada ni copia optimizada: conserva nombre, ruta, SHA-256 y motivo en el estado y la reconciliación. La verificación sigue leyendo y comprobando el original excluido. Sin declaración explícita, una foto sin asignar sigue siendo un error.

`photoTransforms` acepta únicamente `rotateDegrees`: 0, ±90, ±180 o ±270. El signo negativo gira en sentido antihorario. El optimizador normaliza primero la orientación EXIF, aplica la rotación manual, redimensiona proporcionalmente y genera WebP sRGB sin metadatos. No cambia los originales. Los llamadores de Volume 4 sin estas opciones mantienen el comportamiento anterior.

Antes de reservar IDs, el ingreso valida exclusiones, duplicados, cobertura de originales, referencias, transformaciones y salida nueva, y decodifica todas las fotos que necesitan derivados. La salida existente no se sobrescribe: preserve el archivo de preparación y elija un hijo nuevo, por ejemplo `review/intake`.

`groupingConfirmed:true` requiere `sellerConfirmed:true` y justificación; conserva una agrupación ya revisada sin volver a abrir esa pregunta. No aprueba el producto: el estado sigue sin revisar, con `NEEDS_REVIEW`, portada sin elegir y revisión del español pendiente. `sourceGroupId` y `ownerNotes` conservan la referencia y notas del propietario; la copia del manifiesto conserva los datos de preparación. Los precios, defectos, medidas o funcionamiento desconocidos no se completan automáticamente.

`--repo`, `--photos`, `--notes`, `--output` y `--port` son configurables. Ninguna ruta de Downloads está codificada. La salida debe ser nueva: el ingreso rechaza sobrescribir una revisión existente o escribir dentro de los originales o rutas de producción. Para otro lote use otra salida; el registro de IDs es compartido entre worktrees del repositorio.

## Archivos y persistencia

Salida predeterminada: `.moving-sale-review/volume5/` (ignorada por Git):

- `review.html`, `app.mjs`, `core.mjs`, `review.css`: aplicación estática en español, servida con una API local mínima para guardar.
- `owner-review-state.json`: estado completo en disco; incluye ediciones, confirmaciones, preguntas, estados, precio del vendedor, investigación separada, orden y foto principal por identidad de origen.
- `backups/volume5-revision-*.json`: copia anterior a cada cambio o restauración, con escritura atómica y bloqueo entre procesos.
- `initial-owner-review-state.json`: copia inicial independiente.
- `images/volume-5/v5-*.webp`: copias optimizadas locales. Los originales se leen, nunca se escriben. Se conserva SHA-256 de originales y derivados.
- `intake-reconciliation.json`: inventario de todas las fuentes, optimización y conteo público/referencia.
- `Moving_Sale_Inventory_Volume_5.xlsx`: una fila por Item físico activo; hojas **Revisión** y **Referencia interna**, miniaturas incrustadas, filtros, encabezado fijo y desplegables en español. Las decisiones de precio permanecen separadas.

La planilla refleja la revisión al generarla. Pulse **Generar planilla Excel** para actualizarla después de editar y luego **Descargar planilla**. No confunda un campo vacío de corrección con una eliminación: `REMOVE` es obligatorio para quitar explícitamente. No se asigna precio de sitio a un producto que aún no está publicado.

**EXPORTAR COPIA DE REVISIÓN** descarga un JSON portable completo. **Restaurar copia** verifica Volume 5, lote, fuentes, huellas y cobertura de números; guarda primero el estado actual. Después exige nueva aprobación. Una copia anterior a una separación que no contiene los nuevos IDs se rechaza. Conserve también la carpeta de salida y los originales si mueve la revisión a otro equipo: el JSON por sí solo no contiene fotos. Para cambiar la ubicación de originales, reconcilie las rutas y huellas explícitamente; no restaure de forma ciega sobre otro lote.

El guardado no usa localStorage. Varias ventanas usan revisiones: una edición desactualizada se rechaza y pide recargar. Los errores de guardado quedan visibles. Mantenga el registro global de IDs junto al repositorio y sus respaldos: se encuentra en el directorio Git común, `moving-sale-volume5-ids.json`. No se debe borrar para reiniciar pruebas.

## Revisión y asistencia

Grilla, búsqueda, filtros, indicador de edición, navegación anterior/siguiente, guardado al navegar, advertencia por cambios sin guardar, visor completo, flechas del teclado, selección de foto principal, orden público, fotos de referencia separadas, preguntas, incluidos y NO incluidos, medidas, funcionamiento y logística. Las fotos seleccionadas se pueden separar o transferir; la fusión transfiere y verifica antes de retirar. Los IDs retirados quedan registrados permanentemente. Una separación exige elegir portada en ambos Items; una fusión conserva la portada del destino. No hay acción de borrar fotos: transfiera o marque referencia con motivo documentado.

Antes de aprobar, confirme agrupación, responda preguntas obligatorias, complete los datos pendientes, elija una portada pública y revise la redacción. Cambiar un Item aprobado exige nueva revisión; una edición del texto exige volver a confirmar la revisión del español. `MEDIR` es solo interno y bloquea aprobación y entrega. No hay garantía de corrección gramatical completa por una expresión regular: la aprobación incluye revisión deliberada de redacción, además de las barreras automáticas de idioma y filtración interna.

Guardar una edición solo envía los campos que realmente cambiaron; los valores precargados intactos no se consideran confirmados por guardar otro campo. Vacío sigue significando sin cambios y `REMOVE` sigue siendo la eliminación explícita. **Aprobar borrador**, después de pasar la validación, confirma y protege todos los campos públicos editables del producto aprobado frente a la asistencia y al restablecimiento de propuestas. El propietario conserva la posibilidad de editarlos; una edición posterior exige nueva revisión.

La asistencia propone campos sin sobrescribir los confirmados por el propietario:

```powershell
npm run review:volume5 -- assist --output .moving-sale-review/volume5 --operations "C:\MovingSale\Volume5\propuestas.json"
```

Archivo: arreglo de operaciones `{"type":"assist","itemNumber":510,"changes":{"title":"Estante de madera"}}` o `{"type":"research","itemNumber":510,"pricing":{...}}`. La investigación nunca escribe `asking`. La interfaz permite revisar/editar toda la evidencia en el panel interno. No hay búsquedas de mercado inventadas: todavía no hay productos reales que investigar.

Investigación: `confidence: LOW|MEDIUM|HIGH`, `originalPricePaid`, `currentRetailPrice`, `localUsedMarketRange`, `suggestedAskingPrice`, `fastSalePrice`, `privateSellerFloor`, `rationale`, `uncertainties`, `sources`, `comparables`. Un comparable útil tiene `itemSpecific:true`, `localParaguay:true`, `price`, `url` presente en `sources`, `observedAt`, `comparison` y `market:"used"|"new"`. Confianza LOW o sin evidencia local específica deja recomendaciones y venta rápida en `null`. Rango usado requiere al menos dos comparables y extremos exactos. No existe una base numérica por categoría. La calidad, actualidad y semejanza de cada evidencia deben revisarse; no se deducen de la etiqueta de confianza.

## Validación y entrega futura

```powershell
npm run review:volume5 -- validate --output .moving-sale-review/volume5
npm run review:volume5 -- workbook --output .moving-sale-review/volume5
```

El generador Excel usa las dependencias de documentos instaladas en el equipo, descubiertas desde `CODEX_WORKSPACE_NODE_MODULES` o el directorio estándar del runtime local. En otro equipo configure esa variable apuntando al `node_modules` que contiene `@oai/artifact-tool`. El servidor y la revisión existentes no dependen de Codex en ejecución. Si falla la planilla después del ingreso, los IDs ya reservados, imágenes y estado inicial quedan conservados; corrija la dependencia y ejecute `workbook`, **no repita el ingreso**.

**Generar entrega local aprobada** crea `volume5-local-handoff.json` privado solo con los Items aprobados y completos. Los demás siguen en la revisión, con sus IDs y estados originales. La entrega registra los IDs seleccionados y retenidos; sus productos siguen `NEEDS_REVIEW`, `needsReview:true`, `publicationAllowed:false`. La portada seleccionada va a `photos[0]`, con `coverIndex:0`, sin cambiar nombres ni perder el orden relativo restante. La auditoría pública queda explícitamente pendiente; no se afirma MATCH sin una proyección real. También puede ejecutar `npm run review:volume5 -- handoff --output "<revisión>"`.

En un trabajo de publicación separado, compare el lote y la proyección reales:

```powershell
npm run review:volume5 -- audit --output .moving-sale-review/volume5 --batch "C:\MovingSale\Volume5\future-final-batch.json" --projection "C:\MovingSale\Volume5\future-public-projection.json"
```

Ambos archivos son arreglos JSON. Sin opciones, la auditoría conserva la exigencia de aprobación de todo el lote. Con `--approved-only` compara todos los aprobados; con `--items 512,514,604` compara exactamente esos IDs, que deben estar aprobados. Compara todos los campos de `PUBLIC_FIELDS`, además de conteo, identidades únicas, orden y portada; no admite Items omitidos, adicionales ni incompletos en la selección. Usa `askingPricePYG` e `images` para la proyección pública. El adaptador distingue Volume 5 por su identidad y conserva el texto aprobado, medidas, funcionamiento, estructura, exclusiones y fechas de pago como campos explícitos. Los Volumes anteriores conservan su proyección. Cualquier desigualdad falla con salida no cero; solo una coincidencia real genera `MATCH = YES`. El archivo de auditoría tampoco autoriza ni ejecuta publicación.

### Preparar una entrega parcial para autorización

Desde el checkout de código revisado, con la revisión real existente:

```powershell
npm run review:volume5 -- release --output "C:\MovingSale\Volume5\review\real-intake" --release-dir "C:\MovingSale\Volume5\release-102" --held 512,514,604 --expected-count 102
```

La carpeta de entrega debe estar fuera del checkout y de la revisión. La preparación bloquea escrituras concurrentes de la revisión mientras verifica los originales y copias optimizadas, el registro de IDs, todas las aprobaciones y el recorrido exacto de los campos públicos. No escribe en el estado del propietario, la planilla, las rutas de producción ni los servicios de Netlify. `publicationAllowed` permanece `false`.

La entrega contiene un manifiesto con hashes del estado, registro y planilla, commits de base y herramientas, IDs seleccionados/retenidos, lote candidato, proyección real del adaptador público, auditoría por Item, comparación aditiva, manifiesto de fotos y copias idénticas de las fotos públicas seleccionadas. `candidate/source/lib/volume5-batch.mjs` contiene el lote acumulado, conservando sin cambios los productos ya publicados; las fotos de esta entrega corresponden solo a los nuevos Items. No incluye fotos de referencia, fuentes excluidas, investigación privada ni notas del propietario en los productos públicos.

`activation.patch` es una integración pendiente de autorización. No se aplica durante la preparación. La versión de preparación de `catalogBatchProducts()` no importa ningún lote Volume 5. La activación autorizada copia los archivos candidatos y agrega el import de Volume 5 al catálogo aditivo; nunca reemplaza los módulos anteriores. Si Volume 5 ya está conectado, el patch queda vacío y solo se amplía su módulo acumulado. La proyección dinámica existente mantiene la prioridad de overrides, cantidades comprometidas y estados operativos. La preparación no migra, inicializa ni modifica esas tiendas.

Repetir la misma preparación verifica el contenido existente y no duplica archivos ni registros; un archivo alterado se rechaza. Una entrega interrumpida puede completar los archivos faltantes únicamente si el manifiesto sigue siendo idéntico. Si cambia la revisión, el código o la fecha de catálogo, use una nueva carpeta.

Cuando el propietario apruebe los tres retenidos, use `--items 512,514,604 --expected-count 3` sin el antiguo `--held`. Los IDs ya presentes en el catálogo se excluyen de la selección nueva; solicitarlos expresamente se rechaza. Se conservan los 102 registros anteriores en el módulo acumulado sin recalcularlos ni recodificar sus fotos. El validador acepta registros propios ya publicados solo si coinciden ID y número de Item con una asignación de este lote en el registro inmutable; una colisión extranjera o una asignación ausente sigue fallando. Use el código actualizado y el catálogo desplegado también en el runtime de revisión, conservando cualquier personalización local de interfaz.

Antes de desplegar, Governance debe revisar el manifiesto, auditoría y comparación, reconfirmar el hash del estado y la base actual de main, verificar la integración candidata y autorizar expresamente merge/activación/despliegue. Conserve el commit y deploy anteriores. Si aún no hay órdenes Volume 5, puede revertir solo la activación. Si ya existen órdenes, conserve los productos e identidades y pause nuevas ventas únicamente para esos IDs mediante los controles existentes. No borre órdenes, pagos, reservas, overrides ni filas de inventario y no restaure una base vieja sobre actividad posterior.

## Pruebas sin consumir Item 510

`ingest --fixture` usa exclusivamente identificadores `fixture-v5-*` y nunca toca el registro global. Use una salida separada bajo `.moving-sale-review/fixtures/`. Los ensayos y lotes vacíos no pueden generar entrega aprobada ni pasar la auditoría de publicación.

```powershell
npm test
node --check tools/moving-sale-review/cli.mjs
git diff --check
```

Reutilización de Volume 4: reconciliación estricta de archivos en `optimizeGroups`, orientación EXIF, resize proporcional sin ampliar (máximo 2400 px), sRGB, WebP calidad 82 y metadatos eliminados; cargador de catálogo existente y parser de notas. La única extensión del código de Volume 4 es un parámetro opcional `filePrefix` con valor predeterminado `v4`; las pruebas originales siguen vigentes. La UI conserva sus patrones de tarjetas, galería, modal, navegación y estados, con controlador adaptado a persistencia en disco.
