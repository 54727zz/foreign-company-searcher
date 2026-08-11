import { getUserFromRequest } from '../auth/_shared';
import type { Env } from '../auth/_shared';

async function all<T = unknown>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const [intents, stats] = await Promise.all([
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
  ]);

  return Response.json({ ok: true, user, intents, stats, generatedAt: new Date().toISOString() });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
