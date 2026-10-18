import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { active, assert, reduceState, restoreState, finalizedProduct, approvalErrors } from './core.mjs';
import { readJson, saveState, validateState, stateContext, allocate, withLock, atomicJson, copyApp } from './storage.mjs';
export async function serve({ root, outputDir, port = 5105 }) {
  outputDir = path.resolve(outputDir);
  await copyApp(outputDir);
  const token = randomBytes(32).toString('hex');
  const stateFile = path.join(outputDir, 'owner-review-state.json');
  let state = await readJson(stateFile);
  const context = await stateContext(state, root);
  await validateState(state, { ...context, outputDir });
  const server = http.createServer(async (req, res) => {
    const json = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      assert(req.headers.host === `127.0.0.1:${server.address().port}`, 'Host local inválido.');
      if (req.headers.origin) assert(req.headers.origin === origin, 'Origen no permitido.');
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/api/state') { state = await readJson(stateFile); return json({ state, token }); }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        state = await readJson(stateFile);
        res.setHeader('content-disposition', `attachment; filename="volume5-owner-review-state-r${state.revision}.json"`);
        return json(state);
      }
      if (req.method === 'POST' && ['/api/action', '/api/restore', '/api/workbook', '/api/handoff'].includes(url.pathname)) {
        assert(req.headers['x-review-token'] === token, 'Sesión de revisión inválida. Recargue la página.');
        let body = ''; for await (const chunk of req) { body += chunk; assert(Buffer.byteLength(body) <= 20_000_000, 'Copia demasiado grande.'); }
        const data = JSON.parse(body);
        const response = await withLock(stateFile, async () => {
          const disk = await readJson(stateFile);
          state = disk;
          assert(data.revision === state.revision, 'El estado cambió en otra ventana. Recargue antes de guardar.');
          if (url.pathname === '/api/workbook') {
            const { generateWorkbook } = await import('./workbook.mjs');
            await generateWorkbook(state, outputDir); return { state, message: 'Planilla actualizada.' };
          }
          if (url.pathname === '/api/handoff') {
            assert(active(state).length && state.mode === 'real', 'El lote está vacío o es un ensayo.');
            for (const item of active(state)) assert(item.reviewStatus === 'approved' && !approvalErrors(item).length, 'Todos los Items deben estar completos y aprobados.');
            const latestContext = await stateContext(state, root);
            await validateState(state, { ...latestContext, outputDir });
            const batch = active(state).map(finalizedProduct);
            await atomicJson(path.join(outputDir, 'volume5-local-handoff.json'), { volume: 5, batchId: state.batchId, publicationAllowed: false, publicProjectionAudit: 'REQUIRED_IN_SEPARATE_WORKSTREAM', products: batch, covers: active(state).map(i => ({ item: i.product.itemNumber, ownerApprovedCoverSource: i.coverSourceId, finalPhotos0: finalizedProduct(i).photos[0], publicImages0: null, match: 'NOT_CHECKED' })) });
            return { state, message: 'Entrega local generada. Falta auditoría del catálogo público en el proceso de publicación separado.' };
          }
          let next;
          if (url.pathname === '/api/restore') next = restoreState(state, data.state);
          else {
            const operation = data.operation;
            assert(operation.type !== 'assist', 'La asistencia se aplica con la herramienta local, nunca como edición del propietario.');
            let newItemNumber;
            if (operation.type === 'split') {
              if (state.mode === 'fixture') newItemNumber = `fixture-v5-${String(state.items.length + 1).padStart(4, '0')}`;
              else { const reg = await stateContext(state, root); [newItemNumber] = await allocate({ ...reg, count: 1, batchId: state.batchId }); }
            }
            next = reduceState(state, operation, { newItemNumber });
          }
          const latestContext = await stateContext(next, root);
          await validateState(next, { ...latestContext, outputDir });
          await saveState(outputDir, next, state); state = next;
          return { state, message: 'Guardado en disco.' };
        });
        return json(response);
      }
      assert(req.method === 'GET', 'Método no permitido.');
      const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'review.html';
      const allowed = ['review.html', 'review.css', 'app.mjs', 'core.mjs', 'Moving_Sale_Inventory_Volume_5.xlsx'].includes(relative) || /^images\/volume-5\/v5-[a-z0-9-]+\.webp$/.test(relative);
      assert(allowed, 'Archivo no disponible.');
      const bytes = await readFile(path.join(outputDir, relative));
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.webp': 'image/webp', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      res.writeHead(200, { 'content-type': mime[path.extname(relative)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'" }); res.end(bytes);
    } catch (error) { json({ error: error.message }, 400); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
