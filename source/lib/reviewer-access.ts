import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';

type Database = D1Database;

const CODE_LIFETIME_MS = 30 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 10;
const REVIEWER_COOKIE = 'mudanza_reviewer_session';

export type ReviewerAccessCode = { code: string; expiresAt: number };
export type ReviewerSession = { id: string; displayName: string; expiresAt: number };
export type ReviewerAccessStatus = {
  hasActiveSession: boolean;
  activeSessionCount: number;
  latestSessionExpiresAt: number | null;
  hasActiveCode: boolean;
  activeCodeExpiresAt: number | null;
};

function database(): Database {
  const db = (env as unknown as { DB?: Database }).DB;
  if (!db) throw new Error('La base de datos del sitio no está disponible.');
  return db;
}

function authSecret(): string {
  const secret = (env as unknown as { REVIEWER_AUTH_SECRET?: string }).REVIEWER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('La autenticación del revisor no está configurada.');
  return secret;
}

async function ensureReviewerTables(db: Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS reviewer_access_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      created_by_email TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      consumed_session_id TEXT,
      invalidated_at INTEGER,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reviewer_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT 'María',
      created_from_code_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_reviewer_access_codes_active ON reviewer_access_codes(expires_at, consumed_at, invalidated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_reviewer_sessions_active ON reviewer_sessions(expires_at, revoked_at)'),
  ]);
}

function normalizeCode(code: string): string {
  return code.replace(/\D/g, '');
}

async function keyedHash(purpose: 'code' | 'session', value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomDigits(length: number): string {
  const limit = 256 - (256 % 10);
  let result = '';
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (const byte of bytes) {
      if (byte < limit) result += String(byte % 10);
      if (result.length === length) break;
    }
  }
  return result;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createReviewerAccessCode(ownerEmail: string): Promise<ReviewerAccessCode> {
  const db = database();
  await ensureReviewerTables(db);
  const now = Date.now();
  const expiresAt = now + CODE_LIFETIME_MS;
  const raw = randomDigits(6);
  const code = `${raw.slice(0, 3)}-${raw.slice(3)}`;
  await db.batch([
    db.prepare(`UPDATE reviewer_access_codes SET invalidated_at = ?
      WHERE consumed_at IS NULL AND invalidated_at IS NULL`).bind(now),
    db.prepare(`INSERT INTO reviewer_access_codes
      (id, code_hash, created_by_email, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), await keyedHash('code', raw), ownerEmail, expiresAt, now),
  ]);
  return { code, expiresAt };
}

export async function exchangeReviewerCode(code: string): Promise<{ token: string; expiresAt: number }> {
  const normalized = normalizeCode(code);
  const db = database();
  await ensureReviewerTables(db);
  const now = Date.now();
  if (normalized.length !== 6) {
    await registerFailedAttempt(db, now);
    throw new Error('Código inválido o vencido.');
  }

  const codeHash = await keyedHash('code', normalized);
  const row = await db.prepare(`SELECT id FROM reviewer_access_codes
    WHERE code_hash = ? AND expires_at > ? AND consumed_at IS NULL AND invalidated_at IS NULL
      AND failed_attempts < ?`)
    .bind(codeHash, now, MAX_CODE_ATTEMPTS).first<{ id: string }>();
  if (!row) {
    await registerFailedAttempt(db, now);
    throw new Error('Código inválido o vencido.');
  }

  const sessionId = crypto.randomUUID();
  const token = randomToken();
  const expiresAt = now + SESSION_LIFETIME_MS;
  const results = await db.batch([
    db.prepare(`UPDATE reviewer_access_codes
      SET consumed_at = ?, consumed_session_id = ?
      WHERE id = ? AND expires_at > ? AND consumed_at IS NULL AND invalidated_at IS NULL
        AND failed_attempts < ?`)
      .bind(now, sessionId, row.id, now, MAX_CODE_ATTEMPTS),
    db.prepare(`INSERT INTO reviewer_sessions
      (id, token_hash, display_name, created_from_code_id, created_at, expires_at, last_seen_at)
      SELECT ?, ?, 'María', id, ?, ?, ? FROM reviewer_access_codes
      WHERE id = ? AND consumed_session_id = ?`)
      .bind(sessionId, await keyedHash('session', token), now, expiresAt, now, row.id, sessionId),
  ]);
  if (!results[1]?.meta.changes) throw new Error('Código inválido o vencido.');
  return { token, expiresAt };
}

async function registerFailedAttempt(db: Database, now: number): Promise<void> {
  await db.prepare(`UPDATE reviewer_access_codes
    SET failed_attempts = failed_attempts + 1,
      invalidated_at = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE invalidated_at END
    WHERE id = (
      SELECT id FROM reviewer_access_codes
      WHERE expires_at > ? AND consumed_at IS NULL AND invalidated_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    )`).bind(MAX_CODE_ATTEMPTS, now, now).run();
}

export async function setReviewerSessionCookie(token: string, expiresAt: number): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(REVIEWER_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt),
    maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  });
}

export async function getReviewerSession(): Promise<ReviewerSession | null> {
  const token = (await cookies()).get(REVIEWER_COOKIE)?.value;
  if (!token) return null;
  const db = database();
  await ensureReviewerTables(db);
  const now = Date.now();
  const session = await db.prepare(`SELECT id, display_name, expires_at FROM reviewer_sessions
    WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL`)
    .bind(await keyedHash('session', token), now)
    .first<{ id: string; display_name: string; expires_at: number }>();
  if (!session) return null;
  await db.prepare('UPDATE reviewer_sessions SET last_seen_at = ? WHERE id = ?').bind(now, session.id).run();
  return { id: session.id, displayName: session.display_name, expiresAt: session.expires_at };
}

export async function revokeCurrentReviewerSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(REVIEWER_COOKIE)?.value;
  if (token) {
    const db = database();
    await ensureReviewerTables(db);
    await db.prepare(`UPDATE reviewer_sessions SET revoked_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL`)
      .bind(Date.now(), await keyedHash('session', token)).run();
  }
  cookieStore.delete(REVIEWER_COOKIE);
}

export async function revokeAllReviewerSessions(): Promise<number> {
  const db = database();
  await ensureReviewerTables(db);
  const now = Date.now();
  const result = await db.prepare(`UPDATE reviewer_sessions SET revoked_at = ?
    WHERE revoked_at IS NULL AND expires_at > ?`).bind(now, now).run();
  return Number(result.meta.changes ?? 0);
}

export async function getReviewerAccessStatus(): Promise<ReviewerAccessStatus> {
  const db = database();
  await ensureReviewerTables(db);
  const now = Date.now();
  const sessions = await db.prepare(`SELECT COUNT(*) AS count, MAX(expires_at) AS latest_expires_at
    FROM reviewer_sessions WHERE revoked_at IS NULL AND expires_at > ?`)
    .bind(now).first<{ count: number; latest_expires_at: number | null }>();
  const code = await db.prepare(`SELECT expires_at FROM reviewer_access_codes
    WHERE consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > ? AND failed_attempts < ?
    ORDER BY created_at DESC LIMIT 1`)
    .bind(now, MAX_CODE_ATTEMPTS).first<{ expires_at: number }>();
  const count = Number(sessions?.count ?? 0);
  return {
    hasActiveSession: count > 0,
    activeSessionCount: count,
    latestSessionExpiresAt: sessions?.latest_expires_at ? Number(sessions.latest_expires_at) : null,
    hasActiveCode: Boolean(code),
    activeCodeExpiresAt: code ? Number(code.expires_at) : null,
  };
}

// Retained only so previously authorized ChatGPT-based reviewers do not break.
export async function isStoredReviewer(userId: string): Promise<boolean> {
  const db = database();
  const row = await db.prepare(`SELECT 1 AS allowed FROM reviewer_accounts
    WHERE user_id = ? AND role = 'REVIEWER' AND active = 1`).bind(userId).first<{ allowed: number }>();
  return Boolean(row?.allowed);
}
