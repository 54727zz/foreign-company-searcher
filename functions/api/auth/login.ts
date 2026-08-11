import { authResponse, clean, createSession, hashPassword, normalizePhone, timingSafeEqual, validatePassword } from './_shared';
import type { Env, UserRecord } from './_shared';

type Payload = { phone?: string; password?: string; sessionId?: string; path?: string };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const phone = normalizePhone(payload.phone);
  const password = typeof payload.password === 'string' ? payload.password : null;
  if (!phone || !password) return Response.json({ ok: false, error: 'invalid-credentials' }, { status: 401 });

  const user = await env.ANALYTICS_DB.prepare('SELECT id, phone, password_hash, password_salt FROM app_users WHERE phone = ? LIMIT 1').bind(phone).first<UserRecord>();
  if (!user) return Response.json({ ok: false, error: 'invalid-credentials' }, { status: 401 });

  const { hash } = await hashPassword(password, user.password_salt);
  if (!timingSafeEqual(hash, user.password_hash)) return Response.json({ ok: false, error: 'invalid-credentials' }, { status: 401 });

  await env.ANALYTICS_DB.prepare('UPDATE app_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO analytics_events (event_name, path, session_id, user_agent, country) VALUES (?, ?, ?, ?, ?)`,
  ).bind('user_login', clean(payload.path, 200), clean(payload.sessionId, 120), clean(request.headers.get('user-agent'), 300), clean(request.headers.get('cf-ipcountry'), 8)).run();

  const token = await createSession(env, user.id);
  return authResponse(token, { id: user.id, phone: user.phone });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
