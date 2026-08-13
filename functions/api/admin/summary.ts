type Env = {
  ANALYTICS_DB: D1Database;
  ADMIN_PASSWORD?: string;
};

type PagesContext = {
  request: Request;
  env: Env;
};

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      ...(init.headers ?? {}),
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

async function all<T = unknown>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

async function tryAll<T = unknown>(statement: D1PreparedStatement): Promise<T[]> {
  try {
    return await all<T>(statement);
  } catch {
    return [];
  }
}

export const onRequestGet = async ({ request, env }: PagesContext) => {
  const expected = env.ADMIN_PASSWORD;
  const token = readBearerToken(request);

  if (!expected) {
    return json({ ok: false, error: 'admin-password-not-configured' }, { status: 503 });
  }

  if (!token || !timingSafeEqual(token, expected)) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const [eventCounts, topCompanies, topCities, topRegions, topCareerLinks, topSavedCompanies, topAppliedCompanies, highIntentSessions, recentUsers, recentUserIntents, recentFeedback, dailyEvents, jobSources, jobCityCounts] = await Promise.all([
    all(env.ANALYTICS_DB.prepare(
      `SELECT event_name, COUNT(*) AS count
       FROM analytics_events
       WHERE event_name NOT LIKE 'paywall_%'
       GROUP BY event_name
       ORDER BY count DESC`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT company, COUNT(*) AS count
       FROM analytics_events
       WHERE company IS NOT NULL AND event_name = 'company_detail_click'
       GROUP BY company
       ORDER BY count DESC
       LIMIT 20`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT city, COUNT(*) AS count
       FROM analytics_events
       WHERE city IS NOT NULL AND event_name = 'city_filter_click'
       GROUP BY city
       ORDER BY count DESC
       LIMIT 20`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT region, COUNT(*) AS count
       FROM analytics_events
       WHERE region IS NOT NULL AND event_name = 'region_filter_click'
       GROUP BY region
       ORDER BY count DESC
       LIMIT 20`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT company, target_url, COUNT(*) AS count
       FROM analytics_events
       WHERE event_name = 'career_link_click'
       GROUP BY company, target_url
       ORDER BY count DESC
       LIMIT 20`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT company, COUNT(*) AS count
       FROM analytics_events
       WHERE event_name = 'company_saved_click' AND company IS NOT NULL
       GROUP BY company
       ORDER BY count DESC
       LIMIT 20`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT company, COUNT(*) AS count
       FROM analytics_events
       WHERE event_name = 'company_applied_click' AND company IS NOT NULL
       GROUP BY company
       ORDER BY count DESC
       LIMIT 20`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT session_id
         FROM analytics_events
         WHERE session_id IS NOT NULL
         GROUP BY session_id
         HAVING SUM(CASE WHEN event_name = 'city_filter_click' THEN 1 ELSE 0 END) > 0
            AND SUM(CASE WHEN event_name = 'company_detail_click' THEN 1 ELSE 0 END) > 0
            AND SUM(CASE WHEN event_name = 'career_link_click' THEN 1 ELSE 0 END) > 0
       )`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT id, phone, created_at, last_login_at
       FROM app_users
       ORDER BY id DESC
       LIMIT 30`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT user_company_intents.created_at AS created_at,
              app_users.phone AS phone,
              user_company_intents.intent AS intent,
              user_company_intents.company AS company,
              user_company_intents.city AS city
       FROM user_company_intents
       JOIN app_users ON app_users.id = user_company_intents.user_id
       ORDER BY user_company_intents.id DESC
       LIMIT 30`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT id, feature_needs, target_city, target_role, contact, message, country, created_at
       FROM user_feedback
       ORDER BY id DESC
       LIMIT 30`,
    )),
    all(env.ANALYTICS_DB.prepare(
      `SELECT date(created_at) AS day, event_name, COUNT(*) AS count
       FROM analytics_events
       WHERE created_at >= datetime('now', '-14 days')
         AND event_name NOT LIKE 'paywall_%'
       GROUP BY day, event_name
       ORDER BY day DESC, count DESC`,
    )),
    tryAll(env.ANALYTICS_DB.prepare(
      `SELECT company, source_platform, scope, status, last_success_at, last_error, last_job_count
       FROM job_sources
       ORDER BY last_success_at DESC, company ASC
       LIMIT 30`,
    )),
    tryAll(env.ANALYTICS_DB.prepare(
      `SELECT company, city, COUNT(*) AS count
       FROM jobs
       WHERE status = 'active'
       GROUP BY company, city
       ORDER BY count DESC
       LIMIT 30`,
    )),
  ]);

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    eventCounts,
    topCompanies,
    topCities,
    topRegions,
    topCareerLinks,
    topSavedCompanies,
    topAppliedCompanies,
    highIntentSessions,
    recentUsers,
    recentUserIntents,
    recentFeedback,
    dailyEvents,
    jobSources,
    jobCityCounts,
  });
};

export const onRequestOptions = async () => new Response(null, { status: 204 });
