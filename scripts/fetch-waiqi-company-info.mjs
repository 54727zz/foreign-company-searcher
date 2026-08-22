import fs from 'node:fs/promises';

const MERGED_JSON = 'work/waiqi/merge/foreign-companies-merged-with-waiqi.json';
const OUT_DIR = 'work/waiqi/career-enrichment/company-info';
const REPORT_PATH = 'work/waiqi/career-enrichment/waiqi-company-info-summary.json';
const CONCURRENCY = Number(process.env.WAIQI_INFO_CONCURRENCY ?? 1);
const DELAY_MS = Number(process.env.WAIQI_INFO_DELAY_MS ?? 2000);
const MAX_RETRIES = Number(process.env.WAIQI_INFO_RETRIES ?? 3);
const MAX_COMPANIES = Number(process.env.WAIQI_INFO_MAX ?? 0);
let shouldStop = false;
let stopReason = "";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function cleanText(value) { return value == null ? '' : String(value).replace(/\u00a0/g, ' ').trim(); }
function normalizeUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return `https://${text}`;
  return '';
}
async function readJson(path) { try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return null; } }
async function fetchInfo(id) {
  const url = `https://backservice.offerxiansheng.com/api/position-service/company/info?id=${encodeURIComponent(id)}`;
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { source: '24', origin: 'https://www.waiqi.com', referer: 'https://www.waiqi.com/company', 'user-agent': 'Mozilla/5.0 foreign-radar-company-info' } });
      const text = await response.text();
      const json = JSON.parse(text);
      if (response.ok && json.code === 1000) return json;
      lastError = `api ${response.status} ${json.code} ${json.message}`;
      if (response.status === 429 || json.code === 429) {
        const error = new Error(lastError);
        error.rateLimited = true;
        throw error;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(DELAY_MS * attempt * 6);
  }
  throw new Error(lastError || 'fetch failed');
}

await fs.mkdir(OUT_DIR, { recursive: true });
const allRows = JSON.parse(await fs.readFile(MERGED_JSON, 'utf8'));
const rows = allRows.filter((row) => row.data_source === 'waiqi_candidate' && row.waiqi_id).slice(0, MAX_COMPANIES || undefined);
let cursor = 0;
const results = [];

async function worker() {
  while (cursor < rows.length && !shouldStop) {
    const row = rows[cursor++];
    const id = row.waiqi_id;
    const path = `${OUT_DIR}/${id}.json`;
    const cached = await readJson(path);
    if (cached?.data) {
      const website = normalizeUrl(cached.data.website);
      results.push({ company: row.company, waiqiId: id, status: 'cached', website, hasWebsite: Boolean(website) });
      continue;
    }
    await sleep(DELAY_MS);
    try {
      const json = await fetchInfo(id);
      await fs.writeFile(path, JSON.stringify(json, null, 2));
      const website = normalizeUrl(json.data?.website);
      results.push({ company: row.company, waiqiId: id, status: 'fetched', website, hasWebsite: Boolean(website) });
      console.log(`${website ? 'website' : 'no_website'}\t${row.company}\t${website || '-'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('429') || error?.rateLimited) {
        shouldStop = true;
        stopReason = message;
        results.push({ company: row.company, waiqiId: id, status: 'rate_limited', website: '', hasWebsite: false, error: message });
        console.log(`rate_limited\t${row.company}\t${message}`);
        break;
      }
      results.push({ company: row.company, waiqiId: id, status: 'error', website: '', hasWebsite: false, error: message });
      console.log(`error\t${row.company}\t${message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const summary = {
  generatedAt: new Date().toISOString(),
  targetCount: rows.length,
  processedCount: results.length,
  withWebsite: results.filter((item) => item.hasWebsite).length,
  noWebsite: results.filter((item) => !item.hasWebsite && item.status !== 'error').length,
  errorCount: results.filter((item) => item.status === 'error').length,
  rateLimited: shouldStop,
  stopReason,
};
await fs.writeFile(REPORT_PATH, JSON.stringify({ ...summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
