type Env = {
  ANALYTICS_DB: D1Database;
};

type TrackEvent = {
  eventName?: string;
  company?: string;
  region?: string;
  city?: string;
  targetUrl?: string;
  path?: string;
  sessionId?: string;
};

const allowedEvents = new Set([
  'company_detail_click',
  'career_link_click',
  'wechat_qr_open',
  'region_filter_click',
  'city_filter_click',
  'feedback_submit',
  'company_applied_click',
  'company_saved_click',
  'company_later_click',
  'user_register',
  'user_login',
  'subscription_save',
]);

function clean(value: unknown, maxLength = 240): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: TrackEvent;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const eventName = clean(payload.eventName, 80);
  if (!eventName || !allowedEvents.has(eventName)) {
    return Response.json({ ok: false, error: 'invalid-event' }, { status: 400 });
  }

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO analytics_events
      (event_name, company, region, city, target_url, path, session_id, user_agent, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      eventName,
      clean(payload.company),
      clean(payload.region, 80),
      clean(payload.city, 80),
      clean(payload.targetUrl, 500),
      clean(payload.path, 200),
      clean(payload.sessionId, 120),
      clean(request.headers.get('user-agent'), 300),
      clean(request.headers.get('cf-ipcountry'), 8),
    )
    .run();

  return Response.json({ ok: true });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
