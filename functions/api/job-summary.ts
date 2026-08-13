type Env = { ANALYTICS_DB: D1Database };

type SourceRow = {
  company: string;
  status: string;
  last_job_count: number;
  last_success_at: string | null;
  last_scraped_at: string | null;
};

async function all<T = unknown>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const rows = await all<SourceRow>(env.ANALYTICS_DB.prepare(
    `SELECT company, status, last_job_count, last_success_at, last_scraped_at
     FROM job_sources
     ORDER BY last_job_count DESC, company ASC`,
  ));

  return Response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    companies: rows.map((row) => ({
      company: row.company,
      status: row.status,
      count: row.last_job_count,
      updatedAt: row.last_success_at ?? row.last_scraped_at,
    })),
  }, { headers: { 'cache-control': 'no-store' } });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
