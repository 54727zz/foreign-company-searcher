import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const sourcePath = process.argv[2] ?? 'work/company-source-from-xlsx.json';
const scrapedAt = new Date().toISOString();
const MAX_COMPANIES = Number(process.env.MAX_COMPANIES ?? 0);
const MAX_URLS_PER_COMPANY = Number(process.env.MAX_URLS_PER_COMPANY ?? 3);
const MAX_JOBS_PER_COMPANY = Number(process.env.MAX_JOBS_PER_COMPANY ?? 80);
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 6);
const TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS ?? 14000);
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 foreign-company-searcher/0.1';

function cleanText(value) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function splitUrls(value) {
  return String(value ?? '')
    .split(/[;；\n]+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

function inferPlatform(url) {
  const host = new URL(url).hostname.toLowerCase();
  const full = url.toLowerCase();
  if (host.includes('jobs.sap.com')) return 'SAP SuccessFactors';
  if (host.includes('myworkdayjobs.com')) return 'Workday';
  if (host.includes('smartrecruiters.com')) return 'SmartRecruiters';
  if (host.includes('oraclecloud.com') || full.includes('candidateexperience')) return 'Oracle Cloud Recruiting';
  if (host.includes('greenhouse.io')) return 'Greenhouse';
  if (host.includes('lever.co')) return 'Lever';
  if (host.includes('eightfold.ai')) return 'Eightfold';
  if (host.includes('search-jobs') || full.includes('/search-jobs/')) return 'Phenom/Search Jobs';
  return 'Company Careers';
}

function normalizeCity(location) {
  const raw = String(location ?? '').trim();
  const known = ['Shanghai', 'Beijing', 'Shenzhen', 'Dalian', 'Suzhou', 'Hangzhou', 'Nanjing', 'Guangzhou', 'Chengdu', 'XiAn', 'Xi\'an', 'Wuhan', 'Tianjin', 'Wuxi', 'Xiamen', 'Shenyang', 'Hefei', 'Taipei', 'China'];
  const lower = raw.toLowerCase();
  for (const city of known) {
    if (lower.includes(city.toLowerCase())) return city.replace("Xi'an", 'XiAn');
  }
  const first = raw.split(/[,，/|]/)[0]?.trim();
  return first || 'China';
}

function jobKey(company, url, title) {
  const hash = crypto.createHash('sha1').update(`${company}|${url}|${title}`).digest('hex').slice(0, 16);
  return `${company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${hash}`.slice(0, 120);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    const text = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, finalUrl: response.url, text };
  } catch (error) {
    return { ok: false, status: 'ERR', finalUrl: '', text: '', error: error?.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function parseSapJobs(html, company, searchUrl) {
  const jobs = [];
  for (const [, row] of html.matchAll(/<tr class="data-row">([\s\S]*?)<\/tr>/g)) {
    const titleMatch = row.match(/<a href="([^"]+)" class="jobTitle-link">([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const sourceUrl = new URL(titleMatch[1].replace(/&amp;/g, '&'), 'https://jobs.sap.com').toString();
    const id = sourceUrl.match(/\/(\d+)\/?$/)?.[1];
    const location = cleanText(row.match(/<span class="jobLocation">([\s\S]*?)<\/span>/)?.[1] ?? 'China');
    const title = cleanText(titleMatch[2]);
    const job = makeJob(company, title, location, sourceUrl, searchUrl, 'SAP Careers');
    if (id) {
      job.id = `sap-${id}`;
      job.jobKey = `sap-${id}`;
    }
    jobs.push(job);
  }
  return jobs;
}

function parseGenericJobs(html, company, pageUrl, platform) {
  const jobs = [];
  const seen = new Set();
  const anchorRegex = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  const badTitle = /^(search jobs?|view jobs?|explore jobs?|all jobs?|careers?|job opportunities|learn more|apply|apply now|read more|sign in|privacy|cookie|加入我们|查看职位|搜索职位)$/i;
  const jobHref = /(\/job\/|\/jobs\/|search-jobs|jobid|requisition|requisitions|career.*jobs|jobs\?|job-offers|vacanc|position|candidateexperience|myworkdayjobs|smartrecruiters|oraclecloud|lever\.co|greenhouse)/i;
  for (const match of html.matchAll(anchorRegex)) {
    const href = match[2].replace(/&amp;/g, '&').trim();
    const title = cleanText(match[4]);
    if (!title || title.length < 6 || title.length > 160 || badTitle.test(title)) continue;
    let sourceUrl;
    try { sourceUrl = new URL(href, pageUrl).toString(); } catch { continue; }
    if (!jobHref.test(sourceUrl) && !jobHref.test(title)) continue;
    const key = `${title}|${sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nearby = html.slice(Math.max(0, match.index - 500), Math.min(html.length, match.index + 800));
    const location = cleanText(nearby.match(/(?:location|地点|城市)[^<]{0,40}<[^>]*>([\s\S]{2,80}?)<\/[^>]+>/i)?.[1] ?? '') || '';
    jobs.push(makeJob(company, title, location || normalizeCity(sourceUrl), sourceUrl, pageUrl, platform));
    if (jobs.length >= MAX_JOBS_PER_COMPANY) break;
  }
  return jobs;
}

function makeJob(company, title, location, sourceUrl, searchUrl, sourcePlatform) {
  const city = normalizeCity(`${title} ${location} ${sourceUrl}`);
  const key = jobKey(company, sourceUrl, title);
  return {
    id: key,
    jobKey: key,
    company,
    title,
    city,
    location: location || city,
    rawLocation: location || city,
    sourcePlatform,
    sourceUrl,
    searchUrl,
    scrapedAt,
    status: 'active',
    jobHash: crypto.createHash('sha256').update(`${company}|${title}|${location}|${sourceUrl}`).digest('hex'),
  };
}

async function crawlCompany(company) {
  const urls = splitUrls(company.recruiting_url).slice(0, MAX_URLS_PER_COMPANY);
  const companyName = company.company;
  const report = {
    company: companyName,
    brand: company.brand_or_cn_name,
    industry: company.industry,
    urlsTried: urls.length,
    status: 'not_started',
    parser: 'generic-html',
    jobCount: 0,
    firstSuccessUrl: '',
    finalUrl: '',
    httpStatus: '',
    error: '',
    note: '',
  };
  const jobs = [];
  const sourceResults = [];

  if (urls.length === 0) {
    report.status = 'no_url';
    report.error = 'missing recruiting_url';
    return { report, jobs, sourceResults };
  }

  for (const url of urls) {
    const platform = inferPlatform(url);
    const result = await fetchWithTimeout(url);
    sourceResults.push({ url, platform, status: result.status, ok: result.ok, finalUrl: result.finalUrl, error: result.error ?? '' });
    if (!result.ok) continue;

    const title = cleanText(result.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    if (/not found|404/i.test(title) || /errorPages\/404/i.test(result.finalUrl)) {
      sourceResults[sourceResults.length - 1].ok = false;
      sourceResults[sourceResults.length - 1].error = 'soft_404';
      continue;
    }

    const parsed = platform === 'SAP SuccessFactors'
      ? parseSapJobs(result.text, companyName, result.finalUrl || url)
      : parseGenericJobs(result.text, companyName, result.finalUrl || url, platform);
    jobs.push(...parsed);
    report.firstSuccessUrl ||= url;
    report.finalUrl ||= result.finalUrl;
    report.httpStatus ||= String(result.status);
    report.parser = platform === 'SAP SuccessFactors' ? 'sap-successfactors-html' : 'generic-html';
    if (parsed.length > 0) break;
  }

  const uniqueJobs = [...new Map(jobs.map((job) => [job.jobKey, job])).values()].slice(0, MAX_JOBS_PER_COMPANY);
  report.jobCount = uniqueJobs.length;
  if (uniqueJobs.length > 0) report.status = 'jobs_found';
  else if (sourceResults.some((item) => item.ok)) report.status = 'reachable_no_jobs_parsed';
  else if (sourceResults.some((item) => Number(item.status) === 403)) report.status = 'blocked_403';
  else if (sourceResults.some((item) => String(item.error).includes('soft_404') || Number(item.status) === 404)) report.status = 'not_found';
  else report.status = 'fetch_failed';
  report.error = sourceResults.map((item) => item.error).filter(Boolean).join('; ');
  report.note = sourceResults.map((item) => `${item.status}:${item.platform}`).join(' | ');
  return { report, jobs: uniqueJobs, sourceResults };
}

function buildSql(feeds) {
  const lines = [
    'CREATE TABLE IF NOT EXISTS job_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL UNIQUE, source_url TEXT NOT NULL, source_platform TEXT NOT NULL, parser TEXT NOT NULL, scope TEXT, status TEXT NOT NULL DEFAULT \'active\', last_scraped_at TEXT, last_success_at TEXT, last_error TEXT, last_job_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);',
    'CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_key TEXT NOT NULL UNIQUE, company TEXT NOT NULL, title TEXT NOT NULL, city TEXT, location TEXT, source_platform TEXT, source_url TEXT NOT NULL, search_url TEXT, status TEXT NOT NULL DEFAULT \'active\', first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, scraped_at TEXT NOT NULL, raw_location TEXT, job_hash TEXT);',
    'CREATE INDEX IF NOT EXISTS idx_job_sources_company ON job_sources(company);',
    'CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);',
    'CREATE INDEX IF NOT EXISTS idx_jobs_city ON jobs(city);',
    'CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);',
    'BEGIN TRANSACTION;',
  ];
  for (const feed of feeds) {
    const sourceUrl = feed.report.firstSuccessUrl || feed.sourceResults[0]?.url || '';
    const sourcePlatform = feed.sourceResults.find((item) => item.ok)?.platform || feed.sourceResults[0]?.platform || 'Company Careers';
    lines.push(`INSERT INTO job_sources (company, source_url, source_platform, parser, scope, status, last_scraped_at, last_success_at, last_error, last_job_count, updated_at) VALUES (${sqlString(feed.report.company)}, ${sqlString(sourceUrl)}, ${sqlString(sourcePlatform)}, ${sqlString(feed.report.parser)}, 'China', ${sqlString(feed.report.status)}, ${sqlString(scrapedAt)}, ${feed.jobs.length ? sqlString(scrapedAt) : 'NULL'}, ${sqlString(feed.report.error || feed.report.note)}, ${feed.jobs.length}, CURRENT_TIMESTAMP) ON CONFLICT(company) DO UPDATE SET source_url=excluded.source_url, source_platform=excluded.source_platform, parser=excluded.parser, scope=excluded.scope, status=excluded.status, last_scraped_at=excluded.last_scraped_at, last_success_at=excluded.last_success_at, last_error=excluded.last_error, last_job_count=excluded.last_job_count, updated_at=CURRENT_TIMESTAMP;`);
    for (const job of feed.jobs) {
      lines.push(`INSERT INTO jobs (job_key, company, title, city, location, source_platform, source_url, search_url, status, first_seen_at, last_seen_at, scraped_at, raw_location, job_hash) VALUES (${sqlString(job.jobKey)}, ${sqlString(job.company)}, ${sqlString(job.title)}, ${sqlString(job.city)}, ${sqlString(job.location)}, ${sqlString(job.sourcePlatform)}, ${sqlString(job.sourceUrl)}, ${sqlString(job.searchUrl)}, 'active', ${sqlString(job.scrapedAt)}, ${sqlString(job.scrapedAt)}, ${sqlString(job.scrapedAt)}, ${sqlString(job.rawLocation)}, ${sqlString(job.jobHash)}) ON CONFLICT(job_key) DO UPDATE SET title=excluded.title, city=excluded.city, location=excluded.location, source_platform=excluded.source_platform, source_url=excluded.source_url, search_url=excluded.search_url, status='active', last_seen_at=excluded.last_seen_at, scraped_at=excluded.scraped_at, raw_location=excluded.raw_location, job_hash=excluded.job_hash;`);
    }
  }
  lines.push('COMMIT;');
  return `${lines.join('\n')}\n`;
}

function toCsv(rows, columns) {
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const companies = (source.companies ?? []).filter((company) => company.company).slice(0, MAX_COMPANIES || undefined);
const feeds = [];
let cursor = 0;

async function worker() {
  while (cursor < companies.length) {
    const company = companies[cursor++];
    const feed = await crawlCompany(company);
    feeds.push(feed);
    console.log(`${feed.report.status}\t${feed.report.jobCount}\t${feed.report.company}\t${feed.report.note}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
feeds.sort((a, b) => a.report.company.localeCompare(b.report.company));
const jobs = feeds.flatMap((feed) => feed.jobs);
const summary = feeds.reduce((acc, feed) => {
  acc[feed.report.status] = (acc[feed.report.status] ?? 0) + 1;
  return acc;
}, {});
const output = { scrapedAt, companyCount: companies.length, jobCount: jobs.length, summary, reports: feeds.map((feed) => feed.report), jobs };

await fs.mkdir('data/jobs', { recursive: true });
await fs.mkdir('work/jobs', { recursive: true });
await fs.writeFile('data/jobs/all-companies-jobs.json', JSON.stringify(output, null, 2));
await fs.writeFile('work/jobs/all-company-crawl-report.json', JSON.stringify(output, null, 2));
await fs.writeFile('work/jobs/all-company-crawl-report.csv', toCsv(output.reports, ['company', 'brand', 'industry', 'status', 'jobCount', 'urlsTried', 'firstSuccessUrl', 'finalUrl', 'httpStatus', 'parser', 'error', 'note']));
await fs.writeFile('work/jobs/all-companies-jobs-import.sql', buildSql(feeds));
console.log('SUMMARY', JSON.stringify(summary));
console.log(`JOBS ${jobs.length}`);
console.log('Report: work/jobs/all-company-crawl-report.csv');
console.log('Import SQL: work/jobs/all-companies-jobs-import.sql');
