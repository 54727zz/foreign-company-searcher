export type Env = {
  ANALYTICS_DB: D1Database;
};

export type UserRecord = {
  id: number;
  phone: string;
  password_hash: string;
  password_salt: string;
};

const encoder = new TextEncoder();

export function clean(value: unknown, maxLength = 240): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function normalizePhone(value: unknown): string | null {
  const phone = clean(value, 32)?.replace(/\s+/g, '') ?? '';
  if (!/^1[3-9]\d{9}$/.test(phone)) return null;
  return phone;
}

const weakPasswords = new Set([
  'password1',
  'password123',
  'abc12345',
  'abcd1234',
  'qwerty123',
  'admin123',
  '11111111',
  '12345678',
  '123456789',
]);

export function validatePassword(value: unknown, phone?: string | null): string | null {
  const password = typeof value === 'string' ? value : '';
  const lower = password.toLowerCase();
  if (password.length < 8 || password.length > 20) return null;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return null;
  if (/^\d+$/.test(password)) return null;
  if (weakPasswords.has(lower)) return null;
  if (phone && password.includes(phone)) return null;
  return password;
}

export function randomToken(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (item) => item.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, salt = randomToken(16)): Promise<{ hash: string; salt: string }> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 },
    key,
    256,
  );
  const hash = Array.from(new Uint8Array(bits), (item) => item.toString(16).padStart(2, '0')).join('');
  return { hash, salt };
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

export async function createSession(env: Env, userId: number): Promise<string> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`,
  ).bind(userId, tokenHash).run();
  return token;
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export async function getUserFromRequest(request: Request, env: Env): Promise<{ id: number; phone: string } | null> {
  const token = readBearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.ANALYTICS_DB.prepare(
    `SELECT app_users.id AS id, app_users.phone AS phone
     FROM user_sessions
     JOIN app_users ON app_users.id = user_sessions.user_id
     WHERE user_sessions.token_hash = ? AND user_sessions.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
  ).bind(tokenHash).first<{ id: number; phone: string }>();
  return row ?? null;
}

export function authResponse(token: string, user: { id: number; phone: string }) {
  return Response.json({ ok: true, token, user: { id: user.id, phone: user.phone } });
}
