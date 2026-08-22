import fs from 'node:fs/promises';

const INPUT_CSV = process.env.CAREER_LINK_INPUT ?? 'public/foreign_companies_by_industry.csv';
const OUT_DIR = process.env.CAREER_LINK_OUT_DIR ?? 'work/career-links';
const TIMEOUT_MS = Number(process.env.CAREER_LINK_TIMEOUT_MS ?? 12000);
const CONCURRENCY = Number(process.env.CAREER_LINK_CONCURRENCY ?? 10);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(cell); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function csvValue(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function splitUrls(value) {
  return String(value ?? '')
    .split(/;|；|\n|\s+https?:\/\//i)
    .map((part, index) => {
      const text = part.trim();
      if (!text) return '';
      if (index > 0 && !/^https?:\/\//i.test(text)) return `https://${text}`.replace('https://https://', 'https://');
      return text;
    })
    .map((url) => url.replace(/^https:\/([^/])/, 'https://$1').replace(/^http:\/([^/])/, 'http://$1'))
    .filter((url) => /^https?:\/\//i.test(url));
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    const ok = response.status >= 200 && response.status < 400;
    return { url, ok, status: response.status, finalUrl: response.url, error: '' };
  } catch (error) {
    return { url, ok: false, status: 'ERR', finalUrl: '', error: error?.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

const text = await fs.readFile(INPUT_CSV, 'utf8');
const [headers, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
const companyIndex = headers.indexOf('company');
const brandIndex = headers.indexOf('brand_or_cn_name');
const urlIndex = headers.indexOf('recruiting_url');

const items = rows.map((row) => ({
  company: row[companyIndex] || row[brandIndex],
  rawUrl: row[urlIndex],
  urls: splitUrls(row[urlIndex]),
})).filter((item) => item.urls.length > 0);

const companyResults = [];
let cursor = 0;
async function worker() {
  while (cursor < items.length) {
    const item = items[cursor];
    cursor += 1;
    const linkChecks = [];
    for (const url of item.urls) {
      linkChecks.push(await checkUrl(url));
    }
    const best = linkChecks.find((result) => result.ok) ?? linkChecks[0];
    const result = {
      company: item.company,
      rawUrl: item.rawUrl,
      urlCount: item.urls.length,
      ok: Boolean(best?.ok),
      recommendedUrl: best?.ok ? best.finalUrl || best.url : '',
      bestStatus: best?.status ?? '',
      checks: linkChecks,
    };
    companyResults.push(result);
    console.log(`${result.ok ? 'OK' : 'BAD'}\t${result.bestStatus}\t${result.company}\t${result.recommendedUrl || item.rawUrl}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
companyResults.sort((a, b) => a.company.localeCompare(b.company));

const summary = {
  generatedAt: new Date().toISOString(),
  inputCsv: INPUT_CSV,
  companyCount: companyResults.length,
  okCompanyCount: companyResults.filter((result) => result.ok).length,
  badCompanyCount: companyResults.filter((result) => !result.ok).length,
  multiUrlCompanyCount: companyResults.filter((result) => result.urlCount > 1).length,
  badCompanies: companyResults.filter((result) => !result.ok).map((result) => ({ company: result.company, rawUrl: result.rawUrl, checks: result.checks })),
};

const csvHeaders = ['company', 'ok', 'recommendedUrl', 'bestStatus', 'urlCount', 'rawUrl'];
const csv = [csvHeaders.join(','), ...companyResults.map((row) => csvHeaders.map((header) => csvValue(row[header])).join(','))].join('\n');

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(`${OUT_DIR}/career-link-check-detailed.json`, JSON.stringify(companyResults, null, 2));
await fs.writeFile(`${OUT_DIR}/career-link-check-summary.json`, JSON.stringify(summary, null, 2));
await fs.writeFile(`${OUT_DIR}/career-link-check-summary.csv`, '\uFEFF' + csv);
console.log(JSON.stringify(summary, null, 2));
