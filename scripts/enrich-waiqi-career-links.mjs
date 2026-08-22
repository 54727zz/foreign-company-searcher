import fs from 'node:fs/promises';

const MERGED_JSON = 'work/waiqi/merge/foreign-companies-merged-with-waiqi.json';
const OUT_DIR = 'work/waiqi/career-enrichment';
const COMPANY_INFO_DIR = `${OUT_DIR}/company-info`;
const CAREER_CHECK_DIR = `${OUT_DIR}/career-checks`;
const CONCURRENCY = Number(process.env.WAIQI_ENRICH_CONCURRENCY ?? 8);
const INFO_DELAY_MS = Number(process.env.WAIQI_INFO_DELAY_MS ?? 120);
const TIMEOUT_MS = Number(process.env.WAIQI_CAREER_TIMEOUT_MS ?? 8000);
const MAX_COMPANIES = Number(process.env.WAIQI_ENRICH_MAX ?? 0);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function cleanText(value) { return value == null ? '' : String(value).replace(/\u00a0/g, ' ').trim(); }
function csvValue(value) { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; }
function normalizeUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return `https://${text}`;
  return '';
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function likelyCareerUrl(url) { return /career|careers|job|jobs|join|recruit|talent|hcm|workday|oraclecloud|smartrecruiters|greenhouse|lever|eightfold|successfactors|招聘|人才|加入/i.test(url); }

async function fetchJson(url) {
  const response = await fetch(url, { headers: { source: '24', origin: 'https://www.waiqi.com', referer: 'https://www.waiqi.com/company', 'user-agent': 'Mozilla/5.0 foreign-radar-local-enrichment' } });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`non-json ${response.status}`); }
  if (!response.ok || json.code !== 1000) throw new Error(`api ${response.status} ${json.code} ${json.message}`);
  return json;
}

async function readCachedJson(path) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return null; }
}

async function getCompanyInfo(row) {
  if (!row.waiqi_id) return null;
  const path = `${COMPANY_INFO_DIR}/${row.waiqi_id}.json`;
  const cached = await readCachedJson(path);
  if (cached) return cached;
  await sleep(INFO_DELAY_MS);
  const json = await fetchJson(`https://backservice.offerxiansheng.com/api/position-service/company/info?id=${encodeURIComponent(row.waiqi_id)}`);
  await fs.writeFile(path, JSON.stringify(json, null, 2));
  return json;
}

function careerCandidates(website) {
  const normalized = normalizeUrl(website);
  if (!normalized) return [];
  let origin;
  try { origin = new URL(normalized).origin; } catch { return []; }
  const paths = [
    normalized,
    `${origin}/careers`, `${origin}/career`, `${origin}/jobs`, `${origin}/join-us`, `${origin}/joinus`, `${origin}/talent`,
    `${origin}/about/careers`, `${origin}/en/careers`, `${origin}/zh/careers`, `${origin}/cn/careers`, `${origin}/zh-cn/careers`,
    `${origin}/recruitment`, `${origin}/recruit`, `${origin}/job-opportunities`, `${origin}/work-with-us`, `${origin}/加入我们`, `${origin}/招聘`,
  ];
  return unique(paths);
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36', accept: 'text/html,*/*', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    });
    const finalUrl = response.url;
    const ok = response.status >= 200 && response.status < 400;
    let title = '';
    let careerSignal = likelyCareerUrl(finalUrl);
    const contentType = response.headers.get('content-type') ?? '';
    if (ok && /html|text/i.test(contentType)) {
      const text = (await response.text()).slice(0, 120000);
      title = text.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() ?? '';
      careerSignal ||= /career|careers|job openings|search jobs|join us|talent|recruitment|招聘|职位|加入我们|人才/i.test(text);
    }
    return { url, ok, status: response.status, finalUrl, title, careerSignal, error: '' };
  } catch (error) {
    return { url, ok: false, status: 'ERR', finalUrl: '', title: '', careerSignal: false, error: error?.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function findCareerLink(row, website) {
  const key = row.waiqi_id || encodeURIComponent(row.company);
  const path = `${CAREER_CHECK_DIR}/${key}.json`;
  const cached = await readCachedJson(path);
  if (cached) return cached;
  const candidates = careerCandidates(website);
  const checks = [];
  for (const url of candidates) {
    const result = await checkUrl(url);
    checks.push(result);
    if (result.ok && result.careerSignal) break;
  }
  const career = checks.find((item) => item.ok && item.careerSignal) ?? null;
  const homepage = checks.find((item) => item.ok) ?? null;
  const payload = { company: row.company, waiqiId: row.waiqi_id, website: normalizeUrl(website), careerUrl: career?.finalUrl || career?.url || '', homepageUrl: homepage?.finalUrl || homepage?.url || '', status: career ? 'career_found' : homepage ? 'homepage_only' : website ? 'website_unreachable' : 'no_website', checks };
  await fs.writeFile(path, JSON.stringify(payload, null, 2));
  return payload;
}

await fs.mkdir(COMPANY_INFO_DIR, { recursive: true });
await fs.mkdir(CAREER_CHECK_DIR, { recursive: true });

const allRows = JSON.parse(await fs.readFile(MERGED_JSON, 'utf8'));
const rows = allRows.filter((row) => row.data_source === 'waiqi_candidate' && row.waiqi_id).slice(0, MAX_COMPANIES || undefined);
const results = [];
let cursor = 0;

async function worker() {
  while (cursor < rows.length) {
    const row = rows[cursor++];
    try {
      const info = await getCompanyInfo(row);
      const website = normalizeUrl(info?.data?.website);
      const career = await findCareerLink(row, website);
      results.push({ ...career, company: row.company, waiqiId: row.waiqi_id, industry: row.industry, cities: row.primary_china_city_focus });
      console.log(`${career.status}\t${row.company}\t${career.careerUrl || career.homepageUrl || website || '-'}`);
    } catch (error) {
      results.push({ company: row.company, waiqiId: row.waiqi_id, status: 'error', error: error instanceof Error ? error.message : String(error) });
      console.log(`error\t${row.company}\t${error instanceof Error ? error.message : error}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const byId = new Map(results.map((item) => [String(item.waiqiId), item]));
const enrichedRows = allRows.map((row) => {
  if (row.recruiting_url) return { ...row, career_enrichment_status: 'local_seed_existing_url', official_website: '', verified_career_url: row.recruiting_url };
  const result = byId.get(String(row.waiqi_id));
  return {
    ...row,
    recruiting_url: result?.careerUrl || '',
    official_website: result?.website || '',
    verified_career_url: result?.careerUrl || '',
    career_enrichment_status: result?.status || (row.data_source === 'waiqi_candidate' ? 'not_checked' : ''),
  };
});

const headers = unique(Object.keys(enrichedRows[0] ?? {}).concat(['official_website', 'verified_career_url', 'career_enrichment_status']));
const csv = [headers.join(','), ...enrichedRows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\n');
const summary = {
  generatedAt: new Date().toISOString(),
  checkedCount: results.length,
  careerFound: results.filter((item) => item.status === 'career_found').length,
  homepageOnly: results.filter((item) => item.status === 'homepage_only').length,
  websiteUnreachable: results.filter((item) => item.status === 'website_unreachable').length,
  noWebsite: results.filter((item) => item.status === 'no_website').length,
  errorCount: results.filter((item) => item.status === 'error').length,
};

await fs.writeFile(`${OUT_DIR}/waiqi-career-enrichment-results.json`, JSON.stringify(results, null, 2));
await fs.writeFile(`${OUT_DIR}/foreign-companies-local-enriched.csv`, '\uFEFF' + csv);
await fs.writeFile(`${OUT_DIR}/foreign-companies-local-enriched.json`, JSON.stringify(enrichedRows, null, 2));
await fs.writeFile(`${OUT_DIR}/waiqi-career-enrichment-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
