import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const SEARCH_URL = 'https://jobs.sap.com/search/?q=&locationsearch=China';
const PAGE_SIZE = 25;
const MAX_PAGES = 10;
const BASE_URL = 'https://jobs.sap.com';
const COMPANY = 'SAP';
const SOURCE_PLATFORM = 'SAP Careers';

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractJobId(url) {
  const match = url.match(/\/(\d+)\/?$/);
  return match ? match[1] : url;
}

function normalizeCity(location) {
  const first = location.split(',')[0]?.trim() || '';
  return first
    .replace(/\bChina\b/gi, '')
    .replace(/\s+Shaanxi$/i, '')
    .replace(/\s+\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'China';
}

function hashJob(job) {
  return crypto.createHash('sha256').update(`${job.company}|${job.title}|${job.location}|${job.sourceUrl}`).digest('hex');
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseRows(html, scrapedAt) {
  const rowMatches = [...html.matchAll(/<tr class="data-row">([\s\S]*?)<\/tr>/g)];
  const seen = new Set();
  const jobs = [];

  for (const [, row] of rowMatches) {
    const titleMatch = row.match(/<a href="([^"]+)" class="jobTitle-link">([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const relativeUrl = decodeHtml(titleMatch[1]);
    const sourceUrl = new URL(relativeUrl, BASE_URL).toString();
    const id = extractJobId(sourceUrl);
    if (seen.has(id)) continue;
    seen.add(id);

    const locationMatch = row.match(/<td class="colLocation hidden-phone"[\s\S]*?<span class="jobLocation">([\s\S]*?)<\/span>/);
    const location = locationMatch ? stripTags(locationMatch[1]) : 'China';
    const title = stripTags(titleMatch[2]);
    const city = normalizeCity(location);
    const job = {
      id,
      jobKey: `${COMPANY.toLowerCase()}-${id}`,
      company: COMPANY,
      title,
      city,
      location,
      rawLocation: location,
      sourcePlatform: SOURCE_PLATFORM,
      sourceUrl,
      searchUrl: SEARCH_URL,
      scrapedAt,
      status: 'active',
    };
    job.jobHash = hashJob(job);
    jobs.push(job);
  }

  return jobs;
}

async function fetchPage(startrow) {
  const url = startrow === 0 ? SEARCH_URL : `${SEARCH_URL}&startrow=${startrow}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 foreign-company-searcher/0.1',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) throw new Error(`SAP search failed: ${response.status} ${response.statusText}`);
  return { url, html: await response.text() };
}

function buildImportSql(feed) {
  const lines = [
    'CREATE TABLE IF NOT EXISTS job_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL UNIQUE, source_url TEXT NOT NULL, source_platform TEXT NOT NULL, parser TEXT NOT NULL, scope TEXT, status TEXT NOT NULL DEFAULT \'active\', last_scraped_at TEXT, last_success_at TEXT, last_error TEXT, last_job_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);',
    'CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_key TEXT NOT NULL UNIQUE, company TEXT NOT NULL, title TEXT NOT NULL, city TEXT, location TEXT, source_platform TEXT, source_url TEXT NOT NULL, search_url TEXT, status TEXT NOT NULL DEFAULT \'active\', first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, scraped_at TEXT NOT NULL, raw_location TEXT, job_hash TEXT);',
    'CREATE INDEX IF NOT EXISTS idx_job_sources_company ON job_sources(company);',
    'CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);',
    'CREATE INDEX IF NOT EXISTS idx_jobs_city ON jobs(city);',
    'CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);',
    'BEGIN TRANSACTION;',
    `INSERT INTO job_sources (company, source_url, source_platform, parser, scope, status, last_scraped_at, last_success_at, last_error, last_job_count, updated_at) VALUES (${sqlString(feed.company)}, ${sqlString(feed.sourceUrl)}, ${sqlString(SOURCE_PLATFORM)}, 'sap-successfactors-html', ${sqlString(feed.scope)}, 'active', ${sqlString(feed.scrapedAt)}, ${sqlString(feed.scrapedAt)}, NULL, ${feed.count}, CURRENT_TIMESTAMP) ON CONFLICT(company) DO UPDATE SET source_url=excluded.source_url, source_platform=excluded.source_platform, parser=excluded.parser, scope=excluded.scope, status='active', last_scraped_at=excluded.last_scraped_at, last_success_at=excluded.last_success_at, last_error=NULL, last_job_count=excluded.last_job_count, updated_at=CURRENT_TIMESTAMP;`,
    `UPDATE jobs SET status='closed' WHERE company=${sqlString(feed.company)} AND status='active';`,
  ];

  for (const job of feed.jobs) {
    lines.push(`INSERT INTO jobs (job_key, company, title, city, location, source_platform, source_url, search_url, status, first_seen_at, last_seen_at, scraped_at, raw_location, job_hash) VALUES (${sqlString(job.jobKey)}, ${sqlString(job.company)}, ${sqlString(job.title)}, ${sqlString(job.city)}, ${sqlString(job.location)}, ${sqlString(job.sourcePlatform)}, ${sqlString(job.sourceUrl)}, ${sqlString(job.searchUrl)}, 'active', ${sqlString(job.scrapedAt)}, ${sqlString(job.scrapedAt)}, ${sqlString(job.scrapedAt)}, ${sqlString(job.rawLocation)}, ${sqlString(job.jobHash)}) ON CONFLICT(job_key) DO UPDATE SET title=excluded.title, city=excluded.city, location=excluded.location, source_platform=excluded.source_platform, source_url=excluded.source_url, search_url=excluded.search_url, status='active', last_seen_at=excluded.last_seen_at, scraped_at=excluded.scraped_at, raw_location=excluded.raw_location, job_hash=excluded.job_hash;`);
  }

  lines.push('COMMIT;');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const allJobs = [];
  const seen = new Set();
  const fetchedPages = [];
  const scrapedAt = new Date().toISOString();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const startrow = page * PAGE_SIZE;
    const { url, html } = await fetchPage(startrow);
    const pageJobs = parseRows(html, scrapedAt);
    fetchedPages.push(url);

    let newJobs = 0;
    for (const job of pageJobs) {
      if (seen.has(job.jobKey)) continue;
      seen.add(job.jobKey);
      allJobs.push(job);
      newJobs += 1;
    }

    if (pageJobs.length === 0 || newJobs === 0 || pageJobs.length < PAGE_SIZE) break;
  }

  const cityCounts = allJobs.reduce((acc, job) => {
    acc[job.city] = (acc[job.city] ?? 0) + 1;
    return acc;
  }, {});

  const output = {
    company: COMPANY,
    sourceUrl: SEARCH_URL,
    sourcePlatform: SOURCE_PLATFORM,
    scope: 'China',
    scrapedAt,
    fetchedPages,
    count: allJobs.length,
    cityCounts,
    jobs: allJobs,
  };

  await fs.mkdir('data/jobs', { recursive: true });
  await fs.mkdir('public/jobs', { recursive: true });
  await fs.mkdir('work/jobs', { recursive: true });
  await fs.writeFile('data/jobs/sap-china.json', JSON.stringify(output, null, 2));
  await fs.writeFile('public/jobs/sap-china.json', JSON.stringify(output, null, 2));
  await fs.writeFile('work/jobs/sap-china-import.sql', buildImportSql(output));

  console.log(`SAP China jobs scraped: ${allJobs.length}`);
  console.log('City counts:', JSON.stringify(cityCounts));
  console.log('Import SQL:', 'work/jobs/sap-china-import.sql');
  console.log(allJobs.slice(0, 5).map((job) => `- ${job.title} | ${job.location}`).join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
