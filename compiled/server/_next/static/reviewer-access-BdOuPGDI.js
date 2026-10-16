import{i as e}from"./headers-DHOUr5Gk.js";import{env as t}from"cloudflare:workers";var n=1800*1e3,r=720*60*60*1e3,i=10,a=`mudanza_reviewer_session`;function o(){let e=t.DB;if(!e)throw Error(`La base de datos del sitio no está disponible.`);return e}function s(){let e=t.REVIEWER_AUTH_SECRET;if(!e||e.length<32)throw Error(`La autenticación del revisor no está configurada.`);return e}async function c(e){await e.batch([e.prepare(`CREATE TABLE IF NOT EXISTS reviewer_access_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      created_by_email TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      consumed_session_id TEXT,
      invalidated_at INTEGER,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`),e.prepare(`CREATE TABLE IF NOT EXISTS reviewer_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT 'María',
      created_from_code_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER
    )`),e.prepare(`CREATE INDEX IF NOT EXISTS idx_reviewer_access_codes_active ON reviewer_access_codes(expires_at, consumed_at, invalidated_at)`),e.prepare(`CREATE INDEX IF NOT EXISTS idx_reviewer_sessions_active ON reviewer_sessions(expires_at, revoked_at)`)])}function l(e){return e.replace(/\D/g,``)}async function u(e,t){let n=await crypto.subtle.importKey(`raw`,new TextEncoder().encode(s()),{name:`HMAC`,hash:`SHA-256`},!1,[`sign`]),r=await crypto.subtle.sign(`HMAC`,n,new TextEncoder().encode(`${e}:${t}`));return Array.from(new Uint8Array(r),e=>e.toString(16).padStart(2,`0`)).join(``)}function d(e){let t=``;for(;t.length<e;){let n=crypto.getRandomValues(new Uint8Array(e));for(let r of n)if(r<250&&(t+=String(r%10)),t.length===e)break}return t}function f(){let e=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...e)).replace(/\+/g,`-`).replace(/\//g,`_`).replace(/=+$/g,``)}async function p(e){let t=o();await c(t);let r=Date.now(),i=r+n,a=d(6),s=`${a.slice(0,3)}-${a.slice(3)}`;return await t.batch([t.prepare(`UPDATE reviewer_access_codes SET invalidated_at = ?
      WHERE consumed_at IS NULL AND invalidated_at IS NULL`).bind(r),t.prepare(`INSERT INTO reviewer_access_codes
      (id, code_hash, created_by_email, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(),await u(`code`,a),e,i,r)]),{code:s,expiresAt:i}}async function m(e){let t=l(e),n=o();await c(n);let a=Date.now();if(t.length!==6)throw await h(n,a),Error(`Código inválido o vencido.`);let s=await u(`code`,t),d=await n.prepare(`SELECT id FROM reviewer_access_codes
    WHERE code_hash = ? AND expires_at > ? AND consumed_at IS NULL AND invalidated_at IS NULL
      AND failed_attempts < ?`).bind(s,a,i).first();if(!d)throw await h(n,a),Error(`Código inválido o vencido.`);let p=crypto.randomUUID(),m=f(),g=a+r;if(!(await n.batch([n.prepare(`UPDATE reviewer_access_codes
      SET consumed_at = ?, consumed_session_id = ?
      WHERE id = ? AND expires_at > ? AND consumed_at IS NULL AND invalidated_at IS NULL
        AND failed_attempts < ?`).bind(a,p,d.id,a,i),n.prepare(`INSERT INTO reviewer_sessions
      (id, token_hash, display_name, created_from_code_id, created_at, expires_at, last_seen_at)
      SELECT ?, ?, 'María', id, ?, ?, ? FROM reviewer_access_codes
      WHERE id = ? AND consumed_session_id = ?`).bind(p,await u(`session`,m),a,g,a,d.id,p)]))[1]?.meta.changes)throw Error(`Código inválido o vencido.`);return{token:m,expiresAt:g}}async function h(e,t){await e.prepare(`UPDATE reviewer_access_codes
    SET failed_attempts = failed_attempts + 1,
      invalidated_at = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE invalidated_at END
    WHERE id = (
      SELECT id FROM reviewer_access_codes
      WHERE expires_at > ? AND consumed_at IS NULL AND invalidated_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    )`).bind(i,t,t).run()}async function g(t,n){(await e()).set(a,t,{httpOnly:!0,secure:!0,sameSite:`lax`,path:`/`,expires:new Date(n),maxAge:Math.max(0,Math.floor((n-Date.now())/1e3))})}async function _(){let t=(await e()).get(a)?.value;if(!t)return null;let n=o();await c(n);let r=Date.now(),i=await n.prepare(`SELECT id, display_name, expires_at FROM reviewer_sessions
    WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL`).bind(await u(`session`,t),r).first();return i?(await n.prepare(`UPDATE reviewer_sessions SET last_seen_at = ? WHERE id = ?`).bind(r,i.id).run(),{id:i.id,displayName:i.display_name,expiresAt:i.expires_at}):null}async function v(){let t=await e(),n=t.get(a)?.value;if(n){let e=o();await c(e),await e.prepare(`UPDATE reviewer_sessions SET revoked_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL`).bind(Date.now(),await u(`session`,n)).run()}t.delete(a)}async function y(){let e=o();await c(e);let t=Date.now(),n=await e.prepare(`UPDATE reviewer_sessions SET revoked_at = ?
    WHERE revoked_at IS NULL AND expires_at > ?`).bind(t,t).run();return Number(n.meta.changes??0)}async function b(){let e=o();await c(e);let t=Date.now(),n=await e.prepare(`SELECT COUNT(*) AS count, MAX(expires_at) AS latest_expires_at
    FROM reviewer_sessions WHERE revoked_at IS NULL AND expires_at > ?`).bind(t).first(),r=await e.prepare(`SELECT expires_at FROM reviewer_access_codes
    WHERE consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > ? AND failed_attempts < ?
    ORDER BY created_at DESC LIMIT 1`).bind(t,i).first(),a=Number(n?.count??0);return{hasActiveSession:a>0,activeSessionCount:a,latestSessionExpiresAt:n?.latest_expires_at?Number(n.latest_expires_at):null,hasActiveCode:!!r,activeCodeExpiresAt:r?Number(r.expires_at):null}}async function x(e){return!!(await o().prepare(`SELECT 1 AS allowed FROM reviewer_accounts
    WHERE user_id = ? AND role = 'REVIEWER' AND active = 1`).bind(e).first())?.allowed}export{x as a,g as c,_ as i,m as n,y as o,b as r,v as s,p as t};