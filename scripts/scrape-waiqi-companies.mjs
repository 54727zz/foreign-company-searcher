import fs from 'node:fs/promises';

const API_URL = 'https://backservice.offerxiansheng.com/api/position-service/company/foreign/search';
const OUT_DIR = 'work/waiqi/companies';
const PAGE_SIZE = Number(process.env.WAIQI_PAGE_SIZE ?? 21);
const MAX_PAGES = Number(process.env.WAIQI_MAX_PAGES ?? 0);
const DELAY_MS = Number(process.env.WAIQI_DELAY_MS ?? 650);
const RETRIES = Number(process.env.WAIQI_RETRIES ?? 4);
const STOP_AFTER_EMPTY_PAGES = Number(process.env.WAIQI_STOP_AFTER_EMPTY_PAGES ?? 3);

const basePayload = {
  businessDictIdList: [],
  companyTypeList: [],
  posInfoIdList: [],
  workExpList: [],
  educationList: [],
  page: 1,
  size: PAGE_SIZE,
  needAd: 1,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvValue(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function cleanText(value) {
  return value == null ? '' : String(value).replace(/\u00a0/g, ' ').trim();
}

function normalizeRecord(record) {
  return {
    waiqiId: record.id ?? '',
    name: cleanText(record.name),
    abbreviation: cleanText(record.abbreviation),
    companyType: cleanText(record.companyType),
    industry: cleanText(record.businessDictName),
    scale: cleanText(record.scaleName),
    cities: cleanText(record.cityNameList),
    cityIds: cleanText(record.cityIdList),
    welfare: cleanText(record.welfareStr),
    positionCount: record.positionCount ?? 0,
    browseCount: record.browseCount ?? 0,
    favoriteCount: record.favoriteCount ?? 0,
    certified: record.companyCertifiedFlag ?? '',
    logoUrl: cleanText(record.logoUrl),
    source: 'waiqi.com',
    sourceUrl: record.id ? `https://www.waiqi.com/company/detail?id=${record.id}` : 'https://www.waiqi.com/company',
  };
}

async function fetchPageOnce(page) {
  const payload = { ...basePayload, page };
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      source: '24',
      origin: 'https://www.waiqi.com',
      referer: 'https://www.waiqi.com/company',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Page ${page} returned non-JSON response: ${text.slice(0, 120)}`);
  }

  if (!response.ok || json.code !== 1000 || !json.data?.page) {
    throw new Error(`Page ${page} failed: HTTP ${response.status}, code ${json.code}, message ${json.message}`);
  }

  return json;
}

async function fetchPage(page) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      return await fetchPageOnce(page);
    } catch (error) {
      lastError = error;
      const waitMs = DELAY_MS * attempt * 3;
      console.warn(`page ${page} attempt ${attempt}/${RETRIES} failed: ${error.message}. retrying in ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

async function readExistingPage(page) {
  try {
    const text = await fs.readFile(`${OUT_DIR}/page-${page}.json`, 'utf8');
    const json = JSON.parse(text);
    if (json?.data?.page?.records) return json;
  } catch {
    return null;
  }
  return null;
}

await fs.mkdir(OUT_DIR, { recursive: true });

const startedAt = new Date().toISOString();
const first = (await readExistingPage(1)) ?? await fetchPage(1);
const firstPage = first.data.page;
const inferredPages = Math.ceil(firstPage.total / Math.max(firstPage.records?.length || PAGE_SIZE, 1));
const pageCount = MAX_PAGES > 0 ? Math.min(MAX_PAGES, inferredPages) : inferredPages;
const rawPages = [];

await fs.writeFile(`${OUT_DIR}/page-1.json`, JSON.stringify(first, null, 2));
console.log(`page 1/${pageCount}: ${firstPage.records.length} records, total=${firstPage.total}`);

let emptyPageStreak = 0;
for (let page = 1; page <= pageCount; page += 1) {
  let json = await readExistingPage(page);
  if (json) {
    const cachedRecords = json.data.page.records ?? [];
    rawPages.push(json);
    if (page > 1) console.log(`page ${page}/${pageCount}: cached ${cachedRecords.length} records`);
    emptyPageStreak = cachedRecords.length === 0 ? emptyPageStreak + 1 : 0;
    if (emptyPageStreak >= STOP_AFTER_EMPTY_PAGES) break;
    continue;
  }

  await sleep(DELAY_MS);
  json = await fetchPage(page);
  rawPages.push(json);
  await fs.writeFile(`${OUT_DIR}/page-${page}.json`, JSON.stringify(json, null, 2));
  const records = json.data.page.records ?? [];
  console.log(`page ${page}/${pageCount}: ${records.length} records`);
  emptyPageStreak = records.length === 0 ? emptyPageStreak + 1 : 0;
  if (emptyPageStreak >= STOP_AFTER_EMPTY_PAGES) break;
}

const seen = new Map();
const rawRecords = rawPages.flatMap((page) => page.data.page.records ?? []);
for (const record of rawRecords) {
  if (!record?.id && !record?.name) continue;
  const key = record.id ? `id:${record.id}` : `name:${record.name}`;
  if (!seen.has(key)) seen.set(key, normalizeRecord(record));
}

const companies = Array.from(seen.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
const industries = companies.reduce((acc, company) => {
  const key = company.industry || '未分类';
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});
const cityCounts = new Map();
for (const company of companies) {
  for (const city of String(company.cities).split(',').map((item) => item.trim()).filter(Boolean)) {
    cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
  }
}

const report = {
  source: 'https://www.waiqi.com/company',
  apiUrl: API_URL,
  startedAt,
  finishedAt: new Date().toISOString(),
  requestedPages: pageCount,
  reportedTotal: firstPage.total,
  rawRecordCount: rawRecords.length,
  uniqueCompanyCount: companies.length,
  note: 'Only public company list/search data was collected. Position detail pages were not crawled.',
  topIndustries: Object.entries(industries).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, count]) => ({ name, count })),
  topCities: Array.from(cityCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([name, count]) => ({ name, count })),
};

const headers = ['waiqiId', 'name', 'abbreviation', 'companyType', 'industry', 'scale', 'cities', 'welfare', 'positionCount', 'browseCount', 'favoriteCount', 'certified', 'logoUrl', 'sourceUrl'];
const csv = [headers.join(','), ...companies.map((company) => headers.map((header) => csvValue(company[header])).join(','))].join('\n');

await fs.writeFile(`${OUT_DIR}/waiqi-companies-raw-pages.json`, JSON.stringify(rawPages, null, 2));
await fs.writeFile(`${OUT_DIR}/waiqi-companies.json`, JSON.stringify(companies, null, 2));
await fs.writeFile(`${OUT_DIR}/waiqi-companies.csv`, csv);
await fs.writeFile(`${OUT_DIR}/waiqi-companies-report.json`, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
