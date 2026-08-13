type Env = {
  ANALYTICS_DB: D1Database;
};

type JobRow = {
  job_key: string;
  company: string;
  title: string;
  city: string | null;
  location: string | null;
  source_platform: string | null;
  source_url: string;
  search_url: string | null;
  scraped_at: string;
  status: string;
};

type SourceRow = {
  company: string;
  source_url: string;
  source_platform: string;
  scope: string | null;
  last_success_at: string | null;
  last_scraped_at: string | null;
  last_job_count: number;
};

type CountRow = { count: number };

function clean(value: string | null, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function displayLocation(city: string | null, location: string | null): string {
  const value = clean(city, clean(location, '地点待确认'));
  const lower = value.toLowerCase();
  const knownCities = [
    'Shanghai', 'Beijing', 'Shenzhen', 'Dalian', 'Suzhou', 'Hangzhou', 'Nanjing', 'Guangzhou',
    'Chengdu', 'XiAn', 'Wuhan', 'Tianjin', 'Wuxi', 'Xiamen', 'Shenyang', 'Hefei', 'Taipei',
    '上海', '北京', '深圳', '大连', '苏州', '杭州', '南京', '广州', '成都', '西安', '武汉', '天津', '无锡', '厦门', '沈阳', '合肥', '台北',
  ];
  const matched = knownCities.find((item) => lower.includes(item.toLowerCase()));
  return matched ?? '地点待确认';
}

function isDisplayableJob(job: JobRow): boolean {
  const title = clean(job.title, '');
  const sourceUrl = clean(job.source_url, '').toLowerCase();
  if (title.length < 6 || title.length > 140) return false;
  if (/learn more|life at|locations article|privacy|cookie|talent community|sign up|job alert|saved jobs|搜索职位|查看职位/i.test(title)) return false;
  if (job.company === 'SAP') return true;
  return sourceUrl.includes('/job/')
    || sourceUrl.includes('/jobs/jobdetail')
    || sourceUrl.includes('jobdetail')
    || sourceUrl.includes('requisition')
    || sourceUrl.includes('requisitions')
    || sourceUrl.includes('jobid')
    || sourceUrl.includes('/careers/jobs/');
}

async function all<T = unknown>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const company = clean(url.searchParams.get('company'), 'SAP').slice(0, 80);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 120), 1), 300);

  const source = await env.ANALYTICS_DB.prepare(
    `SELECT company, source_url, source_platform, scope, last_success_at, last_scraped_at, last_job_count
     FROM job_sources
     WHERE company = ?`,
  ).bind(company).first<SourceRow>();

  const rows = (await all<JobRow>(env.ANALYTICS_DB.prepare(
    `SELECT job_key, company, title, city, location, source_platform, source_url, search_url, scraped_at, status
     FROM jobs
     WHERE company = ? AND status = 'active'
     ORDER BY scraped_at DESC, title ASC
     LIMIT 300`,
  ).bind(company))).filter(isDisplayableJob).slice(0, limit);

  const cityCounts = rows.reduce<Record<string, number>>((acc, job) => {
    const city = displayLocation(job.city, job.location);
    acc[city] = (acc[city] ?? 0) + 1;
    return acc;
  }, {});

  return Response.json({
    ok: true,
    company,
    sourceUrl: source?.source_url ?? rows[0]?.search_url ?? '',
    sourcePlatform: source?.source_platform ?? rows[0]?.source_platform ?? '',
    scope: source?.scope ?? 'China',
    scrapedAt: source?.last_success_at ?? source?.last_scraped_at ?? rows[0]?.scraped_at ?? new Date().toISOString(),
    count: rows.length,
    cityCounts,
    jobs: rows.map((job) => ({
      id: job.job_key,
      jobKey: job.job_key,
      company: job.company,
      title: job.title,
      city: displayLocation(job.city, job.location),
      location: displayLocation(job.city, job.location),
      sourcePlatform: clean(job.source_platform, 'Company Careers'),
      sourceUrl: job.source_url,
      searchUrl: clean(job.search_url, source?.source_url ?? job.source_url),
      scrapedAt: job.scraped_at,
      status: job.status,
    })),
  }, {
    headers: { 'cache-control': 'no-store' },
  });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
