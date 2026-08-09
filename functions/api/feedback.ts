type Env = {
  ANALYTICS_DB: D1Database;
};

type FeedbackPayload = {
  featureNeeds?: string[];
  targetCity?: string;
  targetRole?: string;
  contact?: string;
  message?: string;
  path?: string;
  sessionId?: string;
};

function clean(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: FeedbackPayload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const featureNeeds = Array.isArray(payload.featureNeeds)
    ? payload.featureNeeds.map((item) => clean(item, 80)).filter(Boolean).join('; ')
    : '';

  if (!featureNeeds && !clean(payload.message)) {
    return Response.json({ ok: false, error: 'empty-feedback' }, { status: 400 });
  }

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO user_feedback
      (feature_needs, target_city, target_role, contact, message, path, session_id, user_agent, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      featureNeeds || '未选择',
      clean(payload.targetCity, 80),
      clean(payload.targetRole, 120),
      clean(payload.contact, 160),
      clean(payload.message, 1000),
      clean(payload.path, 200),
      clean(payload.sessionId, 120),
      clean(request.headers.get('user-agent'), 300),
      clean(request.headers.get('cf-ipcountry'), 8),
    )
    .run();

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO analytics_events
      (event_name, path, session_id, user_agent, country)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      'feedback_submit',
      clean(payload.path, 200),
      clean(payload.sessionId, 120),
      clean(request.headers.get('user-agent'), 300),
      clean(request.headers.get('cf-ipcountry'), 8),
    )
    .run();

  return Response.json({ ok: true });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
