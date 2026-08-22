import fs from 'node:fs/promises';

const MERGED_JSON = 'work/waiqi/merge/foreign-companies-merged-with-waiqi.json';
const INFO_DIR = 'work/waiqi/career-enrichment/company-info';
const CHECK_DIR = 'work/waiqi/career-enrichment/career-checks';
const OUT_DIR = 'work/waiqi/career-enrichment';
const CONCURRENCY = Number(process.env.WAIQI_CAREER_CONCURRENCY ?? 6);
const TIMEOUT_MS = Number(process.env.WAIQI_CAREER_TIMEOUT_MS ?? 7000);
const MAX_COMPANIES = Number(process.env.WAIQI_CAREER_MAX ?? 0);

function cleanText(value) { return value == null ? '' : String(value).replace(/\u00a0/g, ' ').trim(); }
function normalizeUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return `https://${text}`;
  return '';
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function csvValue(value) { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; }
function careerUrlSignal(value) { return /career|careers|job|jobs|join-us|joinus|recruit|recruitment|talent|workday|oraclecloud|smartrecruiters|greenhouse|lever|eightfold|successfactors|招聘|职位|加入我们|人才/i.test(value || ''); }
function strictCareer(check) { return check?.ok && (careerUrlSignal(check.finalUrl) || careerUrlSignal(check.url) || careerUrlSignal(check.title)); }
function careerCandidates(website) {
  const normalized = normalizeUrl(website);
  if (!normalized) return [];
  let url;
  try { url = new URL(normalized); } catch { return []; }
  const origin = url.origin;
  const candidates = [normalized];
  if (!careerUrlSignal(normalized)) {
    candidates.push(
      `${origin}/careers`, `${origin}/career`, `${origin}/jobs`, `${origin}/join-us`, `${origin}/joinus`, `${origin}/talent`,
      `${origin}/about/careers`, `${origin}/en/careers`, `${origin}/zh/careers`, `${origin}/cn/careers`, `${origin}/zh-cn/careers`,
      `${origin}/recruitment`, `${origin}/recruit`, `${origin}/job-opportunities`, `${origin}/work-with-us`, `${origin}/招聘`, `${origin}/加入我们`,
    );
  }
  return unique(candidates);
}
async function readJson(path) { try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return null; } }
async function checkUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36', accept: 'text/html,*/*', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' } });
    const finalUrl = response.url;
    const ok = response.status >= 200 && response.status < 400;
    let title = '';
    let bodySignal = false;
    const contentType = response.headers.get('content-type') ?? '';
    if (ok && /html|text/i.test(contentType)) {
      const text = (await response.text()).slice(0, 80000);
      title = cleanText(text.match(/<title[^>]*>([^<]+)/i)?.[1]);
      bodySignal = /search jobs|job openings|open positions|career opportunities|join our team|招聘职位|社会招聘|校园招聘|加入我们|职位搜索/i.test(text);
    }
    return { url, ok, status: response.status, finalUrl, title, careerSignal: careerUrlSignal(url) || careerUrlSignal(finalUrl) || careerUrlSignal(title) || bodySignal, error: '' };
  } catch (error) {
    return { url, ok: false, status: 'ERR', finalUrl: '', title: '', careerSignal: false, error: error?.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}
async function verify(row, website) {
  const key = row.waiqi_id;
  const path = `${CHECK_DIR}/${key}.json`;
  const cached = await readJson(path);
  if (cached?.checks?.length) return cached;
  const checks = [];
  for (const url of careerCandidates(website)) {
    const result = await checkUrl(url);
    checks.push(result);
    if (strictCareer(result)) break;
  }
  const career = checks.find(strictCareer);
  const homepage = checks.find((item) => item.ok);
  const payload = { company: row.company, waiqiId: key, website, careerUrl: career?.finalUrl || career?.url || '', homepageUrl: homepage?.finalUrl || homepage?.url || '', status: career ? 'verified_career' : homepage ? 'homepage_only' : 'website_unreachable', checks };
  await fs.writeFile(path, JSON.stringify(payload, null, 2));
  return payload;
}

await fs.mkdir(CHECK_DIR, { recursive: true });
const rows = JSON.parse(await fs.readFile(MERGED_JSON, 'utf8')).filter((row) => row.data_source === 'waiqi_candidate' && row.waiqi_id);
const targets = [];
for (const row of rows) {
  const info = await readJson(`${INFO_DIR}/${row.waiqi_id}.json`);
  const website = normalizeUrl(info?.data?.website);
  if (website) targets.push({ row, website });
}
const selected = targets.slice(0, MAX_COMPANIES || undefined);
let cursor = 0;
const results = [];
async function worker() {
  while (cursor < selected.length) {
    const item = selected[cursor++];
    try {
      const result = await verify(item.row, item.website);
      results.push({ ...result, company: item.row.company, waiqiId: item.row.waiqi_id });
      console.log(`${result.status}\t${item.row.company}\t${result.careerUrl || result.homepageUrl || item.website}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ company: item.row.company, waiqiId: item.row.waiqi_id, status: 'error', error: message });
      console.log(`error\t${item.row.company}\t${message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const allCheckFiles = (await fs.readdir(CHECK_DIR)).filter((file) => file.endsWith('.json'));
const allChecks = [];
for (const file of allCheckFiles) allChecks.push(JSON.parse(await fs.readFile(`${CHECK_DIR}/${file}`, 'utf8')));
const byId = new Map(allChecks.map((item) => [String(item.waiqiId), item]));
const allRows = JSON.parse(await fs.readFile(MERGED_JSON, 'utf8'));
const enrichedRows = allRows.map((row) => {
  if (row.recruiting_url) return { ...row, official_website: '', verified_career_url: row.recruiting_url, career_enrichment_status: 'local_seed_existing_url' };
  const check = byId.get(String(row.waiqi_id));
  const info = row.waiqi_id ? allChecks.find((item) => String(item.waiqiId) === String(row.waiqi_id)) : null;
  return { ...row, recruiting_url: check?.status === 'verified_career' ? check.careerUrl : '', official_website: check?.website || '', verified_career_url: check?.status === 'verified_career' ? check.careerUrl : '', career_enrichment_status: check?.status || (row.data_source === 'waiqi_candidate' ? 'not_checked' : '') };
});
const headers = unique(Object.keys(enrichedRows[0] ?? {}).concat(['official_website', 'verified_career_url', 'career_enrichment_status']));
const csv = [headers.join(','), ...enrichedRows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\n');
const summary = { generatedAt: new Date().toISOString(), infoCacheWithWebsite: targets.length, verifiedChecks: allChecks.length, verifiedCareer: allChecks.filter((item) => item.status === 'verified_career').length, homepageOnly: allChecks.filter((item) => item.status === 'homepage_only').length, websiteUnreachable: allChecks.filter((item) => item.status === 'website_unreachable').length };
await fs.writeFile(`${OUT_DIR}/waiqi-career-cache-strict-summary.json`, JSON.stringify(summary, null, 2));
await fs.writeFile(`${OUT_DIR}/foreign-companies-local-enriched-strict.csv`, '\uFEFF' + csv);
await fs.writeFile(`${OUT_DIR}/foreign-companies-local-enriched-strict.json`, JSON.stringify(enrichedRows, null, 2));
console.log(JSON.stringify(summary, null, 2));
