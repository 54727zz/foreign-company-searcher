import { clean, getUserFromRequest } from '../auth/_shared';
import type { Env } from '../auth/_shared';

type Payload = { intent?: string; company?: string; city?: string; path?: string; sessionId?: string };

const allowedIntents = new Set(['applied', 'saved', 'later']);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const intent = clean(payload.intent, 40);
  const company = clean(payload.company, 160);
  if (!intent || !allowedIntents.has(intent)) return Response.json({ ok: false, error: 'invalid-intent' }, { status: 400 });
  if (!company) return Response.json({ ok: false, error: 'empty-company' }, { status: 400 });

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO user_company_intents (user_id, intent, company, city, path, session_id) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(user.id, intent, company, clean(payload.city, 120), clean(payload.path, 200), clean(payload.sessionId, 120)).run();

  const eventName = intent === 'applied' ? 'company_applied_click' : intent === 'saved' ? 'company_saved_click' : 'company_later_click';
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO analytics_events (event_name, company, city, path, session_id, user_agent, country) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(eventName, company, clean(payload.city, 120), clean(payload.path, 200), clean(payload.sessionId, 120), clean(request.headers.get('user-agent'), 300), clean(request.headers.get('cf-ipcountry'), 8)).run();

  return Response.json({ ok: true });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
