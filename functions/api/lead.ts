type Env = {
  ANALYTICS_DB: D1Database;
};

type LeadPayload = {
  contact?: string;
  intent?: string;
  company?: string;
  city?: string;
  path?: string;
  sessionId?: string;
};

const allowedIntents = new Set(['applied', 'saved', 'later']);

function clean(value: unknown, maxLength = 240): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: LeadPayload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const contact = clean(payload.contact, 160);
  const intent = clean(payload.intent, 40);
  if (!contact) return Response.json({ ok: false, error: 'empty-contact' }, { status: 400 });
  if (intent && !allowedIntents.has(intent)) return Response.json({ ok: false, error: 'invalid-intent' }, { status: 400 });

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO user_leads
      (contact, intent, company, city, path, session_id, user_agent, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      contact,
      intent,
      clean(payload.company),
      clean(payload.city, 120),
      clean(payload.path, 200),
      clean(payload.sessionId, 120),
      clean(request.headers.get('user-agent'), 300),
      clean(request.headers.get('cf-ipcountry'), 8),
    )
    .run();

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO analytics_events
      (event_name, company, city, path, session_id, user_agent, country)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      'lead_submit',
      clean(payload.company),
      clean(payload.city, 120),
      clean(payload.path, 200),
      clean(payload.sessionId, 120),
      clean(request.headers.get('user-agent'), 300),
      clean(request.headers.get('cf-ipcountry'), 8),
    )
    .run();

  return Response.json({ ok: true });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
