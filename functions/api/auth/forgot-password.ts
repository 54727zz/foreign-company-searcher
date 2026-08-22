import { clean, normalizePhone } from './_shared';
import type { Env } from './_shared';

type Payload = { phone?: string; message?: string; sessionId?: string; path?: string };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const phone = normalizePhone(payload.phone);
  if (!phone) return Response.json({ ok: false, error: 'invalid-phone' }, { status: 400 });

  const user = await env.ANALYTICS_DB.prepare('SELECT id FROM app_users WHERE phone = ? LIMIT 1').bind(phone).first<{ id: number }>();

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO user_feedback (feature_needs, target_city, target_role, contact, message, path, session_id, user_agent, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    '忘记密码/账号找回',
    '',
    '',
    phone,
    clean(payload.message, 500) ?? (user ? '用户提交密码找回申请，账号存在。' : '用户提交密码找回申请，未匹配到账号。'),
    clean(payload.path, 200),
    clean(payload.sessionId, 120),
    clean(request.headers.get('user-agent'), 300),
    clean(request.headers.get('cf-ipcountry'), 8),
  ).run();

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO analytics_events (event_name, path, session_id, user_agent, country) VALUES (?, ?, ?, ?, ?)`,
  ).bind('password_reset_request', clean(payload.path, 200), clean(payload.sessionId, 120), clean(request.headers.get('user-agent'), 300), clean(request.headers.get('cf-ipcountry'), 8)).run();

  return Response.json({ ok: true, exists: Boolean(user) }, { headers: { 'cache-control': 'no-store' } });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
