import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {database} from './inventory-database.mjs';

export const ADMIN_COOKIE='__Host-psych_admin_session';
export const STANDARD_SECONDS=12*60*60;
export const REMEMBER_SECONDS=30*24*60*60;
const secret=()=>String(process.env.ADMIN_TOKEN||'');
const digest=value=>createHash('sha256').update(value).digest('hex');
const binding=()=>createHmac('sha256',secret()).update('psych-admin-session-v1').digest('hex');
const query=(sql,params)=>database().pool.query(sql,params);

export function validOwnerCredential(provided) {
  const expected=secret();
  return Boolean(expected&&typeof provided==='string'&&provided&&
    timingSafeEqual(Buffer.from(digest(provided),'hex'),Buffer.from(digest(expected),'hex')));
}
export function sessionToken(request) {
  const cookies=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(ADMIN_COOKIE+'='));
  if(cookies.length!==1)return null;
  const token=cookies[0].slice(ADMIN_COOKIE.length+1);
  return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
}
export function sameOriginMutation(request) {
  const origin=request.headers.get('origin');
  return origin===new URL(request.url).origin && !['cross-site','same-site'].includes(request.headers.get('sec-fetch-site'));
}
export function sessionCookie(token,seconds) {
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}
export async function readAdminSession(request) {
  if(!secret())return null;
  const origin=request.headers.get('origin');
  if((origin&&origin!==new URL(request.url).origin)||['cross-site','same-site'].includes(request.headers.get('sec-fetch-site')))return null;
  const token=sessionToken(request);if(!token)return null;
  const row=(await query(`SELECT role,expires_at,remember_me FROM admin_sessions
    WHERE token_hash=$1 AND credential_binding=$2 AND role='OWNER'
      AND revoked_at IS NULL AND expires_at>clock_timestamp()`,[digest(token),binding()])).rows[0];
  return row?{role:row.role,expiresAt:new Date(row.expires_at).toISOString(),rememberMe:row.remember_me}:null;
}
export async function adminAuthorized(request) {
  // Existing integrations may continue using the original owner credential.
  // Browser sessions never receive/store that credential after login.
  const provided=request.headers.get('x-admin-token');
  if(provided)return validOwnerCredential(provided);
  if(!['GET','HEAD'].includes(request.method)&&!sameOriginMutation(request))return false;
  return Boolean(await readAdminSession(request));
}
export async function createAdminSession(request,{token,rememberMe=false}={}) {
  if(!sameOriginMutation(request))throw Object.assign(new Error('Origen no permitido.'),{status:403});
  if(!validOwnerCredential(token))throw Object.assign(new Error('Acceso no autorizado.'),{status:401});
  const seconds=rememberMe===true?REMEMBER_SECONDS:STANDARD_SECONDS;
  const raw=randomBytes(32).toString('base64url');
  // All expiry calculations use the database clock; lifetime is absolute and
  // ordinary activity cannot silently renew a remembered session indefinitely.
  const row=(await query(`INSERT INTO admin_sessions(token_hash,credential_binding,role,remember_me,expires_at)
    VALUES($1,$2,'OWNER',$3,clock_timestamp()+($4*interval '1 second')) RETURNING expires_at`,
    [digest(raw),binding(),rememberMe===true,seconds])).rows[0];
  return {cookie:sessionCookie(raw,seconds),session:{role:'OWNER',rememberMe:rememberMe===true,expiresAt:new Date(row.expires_at).toISOString()}};
}
export async function revokeAdminSession(request,{all=false}={}) {
  if(!sameOriginMutation(request))throw Object.assign(new Error('Origen no permitido.'),{status:403});
  if(all){
    if(!await adminAuthorized(request))throw Object.assign(new Error('Acceso no autorizado.'),{status:401});
    await query('UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE credential_binding=$1 AND revoked_at IS NULL',[binding()]);
  }else{
    const token=sessionToken(request);
    if(token)await query('UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1 AND revoked_at IS NULL',[digest(token)]);
  }
  return sessionCookie('',0);
}
