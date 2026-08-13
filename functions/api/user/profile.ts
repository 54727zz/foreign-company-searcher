import { getUserFromRequest } from '../auth/_shared';
import type { Env } from '../auth/_shared';

async function all<T = unknown>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

async function tryRun(statement: D1PreparedStatement) {
  try {
    await statement.run();
  } catch {
    // Older deployments may not have subscription tables yet; profile should still load.
  }
}

async function tryAll<T = unknown>(statement: D1PreparedStatement): Promise<T[]> {
  try {
    return await all<T>(statement);
  } catch {
    return [];
  }
}

function escapeLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  await tryRun(env.ANALYTICS_DB.prepare(
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
  ));

  const [intents, stats, subscriptions] = await Promise.all([
    all(env.ANALYTICS_DB.prepare(
      `SELECT intent, company, city, created_at
       FROM user_company_intents
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 200`,
    ).bind(user.id)),
    all(env.ANALYTICS_DB.prepare(
      `SELECT intent, COUNT(*) AS count
       FROM user_company_intents
       WHERE user_id = ?
       GROUP BY intent`,
    ).bind(user.id)),
    tryAll<{ subscription_type: string; value: string; created_at: string }>(env.ANALYTICS_DB.prepare(
      `SELECT subscription_type, value, created_at
       FROM user_subscriptions
       WHERE user_id = ?
       ORDER BY subscription_type ASC, value ASC`,
    ).bind(user.id)),
  ]);

  const cities = subscriptions.filter((item) => item.subscription_type === 'city').map((item) => item.value);
  const companies = subscriptions.filter((item) => item.subscription_type === 'company').map((item) => item.value);
  const keywords = subscriptions.filter((item) => item.subscription_type === 'keyword').map((item) => item.value);
  const clauses: string[] = [];
  const binds: string[] = [];

  for (const city of cities) {
    clauses.push('(city LIKE ? ESCAPE \'\\\' OR location LIKE ? ESCAPE \'\\\' OR raw_location LIKE ? ESCAPE \'\\\')');
    binds.push(escapeLike(city), escapeLike(city), escapeLike(city));
  }
  for (const company of companies) {
    clauses.push('company LIKE ? ESCAPE \'\\\'');
    binds.push(escapeLike(company));
  }
  for (const keyword of keywords) {
    clauses.push('title LIKE ? ESCAPE \'\\\'');
    binds.push(escapeLike(keyword));
  }

  const watchedJobs = clauses.length ? await tryAll(env.ANALYTICS_DB.prepare(
    `SELECT job_key, company, title, city, location, source_platform, source_url, scraped_at
     FROM jobs
     WHERE status = 'active' AND (${clauses.join(' OR ')})
     ORDER BY scraped_at DESC, company ASC, title ASC
     LIMIT 80`,
  ).bind(...binds)) : [];

  return Response.json({ ok: true, user, intents, stats, subscriptions, watchedJobs, generatedAt: new Date().toISOString() });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
