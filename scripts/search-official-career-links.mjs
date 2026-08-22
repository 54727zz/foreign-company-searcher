import fs from 'node:fs/promises';

const INPUT_CSV = process.env.OFFICIAL_SEARCH_INPUT ?? 'public/foreign_companies_by_industry.csv';
const OUT_DIR = 'work/official-career-search';
const RESULTS_PATH = `${OUT_DIR}/official-career-search-results.json`;
const MAX_COMPANIES = Number(process.env.OFFICIAL_SEARCH_MAX ?? 120);
const DELAY_MS = Number(process.env.OFFICIAL_SEARCH_DELAY_MS ?? 1800);
const TIMEOUT_MS = Number(process.env.OFFICIAL_SEARCH_TIMEOUT_MS ?? 9000);

const blockedHosts = [
  'waiqi.com', 'zhaopin.com', '51job.com', 'liepin.com', 'bosszhipin.com', 'kanzhun.com', 'linkedin.com', 'indeed.com',
  'glassdoor.com', 'jobsdb.com', 'lagou.com', 'yingjiesheng.com', 'jobui.com', 'maimai.cn', 'google.com/search', 'baidu.com', 'shengjob.com', 'job1001.com', 'job5156.com', 'cjol.com', 'jobcn.com', 'goodjobs.cn', 'baicai.com', 'job592.com', 'shixiseng.com', 'qcc.com', 'qlrc.com', 'tianyancha.com', 'aiqicha.baidu.com', 'kanzhun.com', 'zhipin.com', 'forums.', 'forum.', 'reddit.com', 'quora.com', 'zhihu.com', 'commentcamarche.net', 'msn.com',
];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function cleanText(value) { return value == null ? '' : String(value).replace(/\u00a0/g, ' ').trim(); }
function normalizeFullWidth(value) {
  return cleanText(value).replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}
function englishNames(row) {
  const fields = [row.brand_or_cn_name, row.company, row.sub_sector].map(normalizeFullWidth);
  const names = [];
  for (const field of fields) {
    const asciiParts = field.match(/[A-Za-z0-9][A-Za-z0-9&+.'’\- ]{0,48}/g) ?? [];
    for (const raw of asciiParts) {
      let text = raw.replace(/\s+/g, ' ').trim();
      text = text.replace(/\b(Shanghai|Beijing|Guangzhou|Shenzhen|Suzhou|Hangzhou|Ltd|Limited|Inc|Corp|Corporation|Company|Group|AB|Co)\b/gi, '').trim();
      text = text.replace(/China$/i, '').trim();
      text = text.replace(/[^A-Za-z0-9&+.'’\- ]/g, '').trim();
      if (text.length < 2) continue;
      if (/^(CN|EN|US|UK|HR|PR|IT|AI|QA|QC|EHS|HSE|B2B|B2C|waiqi|careers|jobs)$/i.test(text)) continue;
      names.push(text);
      const compact = text.replace(/\s+/g, '');
      if (compact !== text && compact.length >= 2) names.push(compact);
    }
  }
  return [...new Set(names)].slice(0, 5);
}
function csvValue(value) { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; }
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]; const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(cell); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i += 1; row.push(cell); if (row.some((value) => value.length > 0)) rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
function toObject(headers, row) { return Object.fromEntries(headers.map((header, index) => [header, cleanText(row[index])])); }
function decodeRedirect(url) {
  try {
    const parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    const u = parsed.searchParams.get('u');
    if (u?.startsWith('a1')) return Buffer.from(u.slice(2), 'base64url').toString('utf8');
    return parsed.toString();
  } catch { return url; }
}
function normalizeUrl(url) {
  try {
    const decoded = decodeRedirect(url.replace(/&amp;/g, '&'));
    const parsed = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded);
    if (parsed.hostname.includes('bing.com') && parsed.pathname.includes('/ck/a')) return '';
    if (parsed.hostname.includes('duckduckgo.com') && parsed.pathname.includes('/l/')) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch { return ''; }
}
function host(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function rootHost(value) {
  const h = /^https?:/i.test(value || '') ? host(value) : String(value || '').replace(/^www\./, '').toLowerCase();
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const twoPartTlds = new Set(['com.cn', 'net.cn', 'org.cn', 'co.uk', 'com.au']);
  const tail = parts.slice(-2).join('.');
  const tail3 = parts.slice(-3).join('.');
  return twoPartTlds.has(tail) && parts.length >= 3 ? tail3 : tail;
}
function isKnownAts(url) { return /workday|oraclecloud|smartrecruiters|greenhouse|lever|eightfold|successfactors|hotjob|wecruit|zhiye.com/i.test(url); }
function sameOfficialDomain(row, url) {
  const official = rootHost(row.official_website || '');
  if (!official) return false;
  return rootHost(url) === official || host(url).endsWith('.' + official);
}
function hostMatchesEnglishName(row, url) {
  const h = rootHost(url).replace(/[^a-z0-9]/g, '');
  if (!h) return false;
  return englishNames(row).some((name) => {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized.length < 3 && !/\d/.test(normalized)) return false;
    return h.includes(normalized) || normalized.includes(h);
  });
}
function isBlockedUrl(url) { const h = host(url); return !h || blockedHosts.some((blocked) => h.includes(blocked) || url.includes(blocked)); }
function careerSignal(value) { return /career|careers|job|jobs|join-us|joinus|recruit|recruitment|talent|workday|oraclecloud|smartrecruiters|greenhouse|lever|eightfold|successfactors|hotjob|wecruit|招聘|职位|加入我们|人才|校园招聘|社会招聘/i.test(value || ''); }
function companyTokens(row) {
  return [row.company, row.brand_or_cn_name, ...englishNames(row)]
    .join(' ')
    .replace(/[（）()【】\[\],，.。·•&]/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !/有限公司|公司|中国|上海|北京|深圳|广州|集团|分公司/.test(item))
    .slice(0, 5);
}
function officialScore(row, url, title = '') {
  const h = host(url); const text = `${url} ${title}`.toLowerCase();
  let score = 0;
  for (const token of companyTokens(row)) {
    const simple = token.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    if (simple && text.includes(simple)) score += 3;
    if (simple && h.includes(simple)) score += 5;
  }
  if (careerSignal(url)) score += 6;
  if (isKnownAts(url)) score += 8;
  if (careerSignal(title)) score += 3;
  
  if (isBlockedUrl(url)) score -= 100;
  return score;
}
function extractBingResults(html) {
  const results = [];
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  for (const block of blocks) {
    const href = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!href) continue;
    const url = normalizeUrl(href[1].replace(/&amp;/g, '&'));
    const title = cleanText(href[2].replace(/<[^>]+>/g, ''));
    if (url && !isBlockedUrl(url)) results.push({ url, title });
  }
  return results;
}
async function searchBing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`;
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' } });
  const html = await response.text();
  if (!response.ok) throw new Error(`bing search ${response.status}`);
  return extractBingResults(html);
}
function extractDuckDuckGoResults(html) {
  const results = [];
  for (const match of html.matchAll(/<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = normalizeUrl(match[1].replace(/&amp;/g, '&'));
    const title = cleanText(match[2].replace(/<[^>]+>/g, ''));
    if (url && !isBlockedUrl(url)) results.push({ url, title });
  }
  return results;
}
async function searchDuckDuckGo(query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' } });
  const html = await response.text();
  if (!response.ok) throw new Error(`duckduckgo search ${response.status}`);
  return extractDuckDuckGoResults(html);
}
async function searchWeb(query) {
  const all = [];
  try { all.push(...await searchDuckDuckGo(query)); } catch {}
  try { all.push(...await searchBing(query)); } catch {}
  return [...new Map(all.map((item) => [item.url, item])).values()];
}
async function checkUrl(url) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36', accept: 'text/html,*/*', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' } });
    const finalUrl = response.url; const ok = response.status >= 200 && response.status < 400;
    let title = ''; let bodySignal = false;
    const contentType = response.headers.get('content-type') ?? '';
    if (ok && /html|text/i.test(contentType)) {
      const text = (await response.text()).slice(0, 100000);
      title = cleanText(text.match(/<title[^>]*>([^<]+)/i)?.[1]);
      bodySignal = /search jobs|job openings|open positions|career opportunities|join our team|招聘职位|社会招聘|校园招聘|加入我们|职位搜索/i.test(text);
    }
    return { url, ok, status: response.status, finalUrl, title, careerSignal: careerSignal(url) || careerSignal(finalUrl) || careerSignal(title) || bodySignal, error: '' };
  } catch (error) {
    return { url, ok: false, status: 'ERR', finalUrl: '', title: '', careerSignal: false, error: error?.name === 'AbortError' ? 'timeout' : error.message };
  } finally { clearTimeout(timeout); }
}
async function readResults() { try { return JSON.parse(await fs.readFile(RESULTS_PATH, 'utf8')); } catch { return []; } }

await fs.mkdir(OUT_DIR, { recursive: true });
const [headers, ...rows] = parseCsv((await fs.readFile(INPUT_CSV, 'utf8')).replace(/^\uFEFF/, ''));
const companies = rows.map((row) => toObject(headers, row));
const existing = await readResults();
const done = new Set(existing.map((item) => item.companyKey));
const targets = companies
  .filter((row) => !row.recruiting_url && row.company)
  .filter((row) => !done.has(`${row.company}|${row.waiqi_id || ''}`))
  .slice(0, MAX_COMPANIES);
const results = [...existing];

for (const row of targets) {
  const companyKey = `${row.company}|${row.waiqi_id || ''}`;
  const names = englishNames(row);
  const primary = names[0] || row.brand_or_cn_name || row.company;
  const queries = names.length ? [
    `${primary} careers China`,
    `${primary} jobs China`,
    `${primary} official careers`,
    `${row.company} ${primary} 招聘`,
  ] : [
    `${row.company} 官方 招聘`,
    `${row.company} careers`,
    `${row.brand_or_cn_name || row.company} 加入我们`,
  ];
  if (row.official_website) queries.unshift(`site:${rootHost(row.official_website)} careers OR jobs`);
  const candidates = [];
  try {
    for (const query of queries) {
      await sleep(DELAY_MS);
      const items = await searchWeb(query);
      for (const item of items) candidates.push({ ...item, query, score: officialScore(row, item.url, item.title) });
    }
    const rankedAll = [...new Map(candidates.sort((a, b) => b.score - a.score).map((item) => [item.url, item])).values()];
    const ranked = rankedAll.filter((item) => {
      if (isBlockedUrl(item.url)) return false;
      if (row.official_website) return sameOfficialDomain(row, item.url) || isKnownAts(item.url);
      return isKnownAts(item.url) || hostMatchesEnglishName(row, item.url);
    }).slice(0, 8);
    const checks = [];
    for (const item of ranked.filter((item) => item.score > 0)) {
      const check = await checkUrl(item.url);
      checks.push({ ...item, ...check });
      if (check.ok && check.careerSignal && officialScore(row, check.finalUrl || check.url, check.title) >= 6) break;
    }
    const verified = checks.find((item) => {
      const final = item.finalUrl || item.url;
      if (!item.ok || !item.careerSignal || isBlockedUrl(final)) return false;
      if (row.official_website && sameOfficialDomain(row, final)) return true;
      if (isKnownAts(final) && officialScore(row, final, item.title) >= 8) return true;
      return !row.official_website && hostMatchesEnglishName(row, final) && officialScore(row, final, item.title) >= 10;
    });
    const result = { companyKey, company: row.company, waiqiId: row.waiqi_id, status: verified ? 'verified_career' : checks.some((item) => item.ok) ? 'searched_no_verified_career' : 'searched_no_reachable_candidate', careerUrl: verified?.finalUrl || verified?.url || '', checkedAt: new Date().toISOString(), candidates: ranked, checks };
    results.push(result);
    await fs.writeFile(RESULTS_PATH, JSON.stringify(results, null, 2));
    console.log(`${result.status}\t${row.company}\t${result.careerUrl || '-'}`);
  } catch (error) {
    const result = { companyKey, company: row.company, waiqiId: row.waiqi_id, status: 'search_error', error: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() };
    results.push(result);
    await fs.writeFile(RESULTS_PATH, JSON.stringify(results, null, 2));
    console.log(`search_error\t${row.company}\t${result.error}`);
  }
}

const byKey = new Map(results.map((item) => [item.companyKey, item]));
const outputRows = companies.map((row) => {
  if (row.recruiting_url) return row;
  const result = byKey.get(`${row.company}|${row.waiqi_id || ''}`);
  if (result?.status === 'verified_career' && result.careerUrl) return { ...row, recruiting_url: result.careerUrl, verified_career_url: result.careerUrl, career_enrichment_status: 'official_search_verified' };
  if (result) return { ...row, career_enrichment_status: result.status };
  return row;
});
const outputHeaders = [...headers];
for (const h of ['verified_career_url', 'career_enrichment_status']) if (!outputHeaders.includes(h)) outputHeaders.push(h);
const csv = [outputHeaders.join(','), ...outputRows.map((row) => outputHeaders.map((header) => csvValue(row[header])).join(','))].join('\n');
await fs.writeFile(`${OUT_DIR}/foreign-companies-official-search-enriched.csv`, '\uFEFF' + csv);
await fs.writeFile(`${OUT_DIR}/official-career-search-summary.json`, JSON.stringify({ generatedAt: new Date().toISOString(), totalResults: results.length, verifiedCareer: results.filter((item) => item.status === 'verified_career').length, searchNoVerified: results.filter((item) => item.status?.startsWith('searched_')).length, searchError: results.filter((item) => item.status === 'search_error').length }, null, 2));
