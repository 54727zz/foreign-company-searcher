import { clean, getUserFromRequest } from '../auth/_shared';
import type { Env } from '../auth/_shared';

type Payload = {
  cities?: unknown;
  companies?: unknown;
  keywords?: unknown;
};

const allowedTypes = new Set(['city', 'company', 'keyword']);
const maxItemsPerType = 20;

function valuesFromPayload(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => clean(item, 80)).filter((item): item is string => Boolean(item)))].slice(0, maxItemsPerType);
}

async function ensureTable(env: Env) {
  await env.ANALYTICS_DB.prepare(
    `CREATE TABLE IF NOT EXISTS user_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subscription_type TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, subscription_type, value),
      FOREIGN KEY(user_id) REFERENCES app_users(id)
    )`,
  ).run();
  await env.ANALYTICS_DB.prepare('CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id)').run();
  await env.ANALYTICS_DB.prepare('CREATE INDEX IF NOT EXISTS idx_user_subscriptions_type_value ON user_subscriptions(subscription_type, value)').run();
}

async function all<T = unknown>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  await ensureTable(env);

  const rows = await all<{ subscription_type: string; value: string; created_at: string }>(env.ANALYTICS_DB.prepare(
    `SELECT subscription_type, value, created_at
     FROM user_subscriptions
     WHERE user_id = ?
     ORDER BY subscription_type ASC, value ASC`,
  ).bind(user.id));

  return Response.json({ ok: true, subscriptions: rows, generatedAt: new Date().toISOString() });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  await ensureTable(env);

  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const groups: Array<[string, string[]]> = [
    ['city', valuesFromPayload(payload.cities)],
    ['company', valuesFromPayload(payload.companies)],
    ['keyword', valuesFromPayload(payload.keywords)],
  ];

  for (const [type] of groups) {
    if (!allowedTypes.has(type)) return Response.json({ ok: false, error: 'invalid-type' }, { status: 400 });
  }

  await env.ANALYTICS_DB.prepare('DELETE FROM user_subscriptions WHERE user_id = ?').bind(user.id).run();
  for (const [type, values] of groups) {
    for (const value of values) {
      await env.ANALYTICS_DB.prepare(
        `INSERT INTO user_subscriptions (user_id, subscription_type, value, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, subscription_type, value) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
      ).bind(user.id, type, value).run();
    }
  }

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO analytics_events (event_name, path, session_id, user_agent, country)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind('subscription_save', clean(new URL(request.url).pathname, 200), null, clean(request.headers.get('user-agent'), 300), clean(request.headers.get('cf-ipcountry'), 8)).run();

  return Response.json({ ok: true });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
