import { authResponse, clean, createSession, hashPassword, normalizePhone, validatePassword } from './_shared';
import type { Env } from './_shared';

type Payload = { phone?: string; password?: string; sessionId?: string; path?: string };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const phone = normalizePhone(payload.phone);
  const password = validatePassword(payload.password, phone);
  if (!phone) return Response.json({ ok: false, error: 'invalid-phone' }, { status: 400 });
  if (!password) return Response.json({ ok: false, error: 'invalid-password' }, { status: 400 });

  const exists = await env.ANALYTICS_DB.prepare('SELECT id FROM app_users WHERE phone = ? LIMIT 1').bind(phone).first();
  if (exists) return Response.json({ ok: false, error: 'phone-exists' }, { status: 409 });

  const { hash, salt } = await hashPassword(password);
  const created = await env.ANALYTICS_DB.prepare(
    'INSERT INTO app_users (phone, password_hash, password_salt, last_login_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
  ).bind(phone, hash, salt).run();
  const userId = Number(created.meta.last_row_id);

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO analytics_events (event_name, path, session_id, user_agent, country) VALUES (?, ?, ?, ?, ?)`,
  ).bind('user_register', clean(payload.path, 200), clean(payload.sessionId, 120), clean(request.headers.get('user-agent'), 300), clean(request.headers.get('cf-ipcountry'), 8)).run();

  const token = await createSession(env, userId);
  return authResponse(token, { id: userId, phone });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
