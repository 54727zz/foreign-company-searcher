import fs from 'node:fs/promises';

const SOURCE_URLS = [
  'https://r.jina.ai/http://r.jina.ai/http://https://www.waiqi.com/info',
  'https://r.jina.ai/http://r.jina.ai/http://https://www.waiqi.com/company',
];

const scrapedAt = new Date().toISOString();

function parseInfoRows(markdown) {
  const rows = [];
  const linePattern = /^(\d{4}\.\d{2}\.\d{2})\s+(.+?)\s+(.+?)\s+(.+?)\s+(.+?市|香港特别行政区|澳门特别行政区|台湾|全国)\s+(.+?)\s+(.+?)\s+(以官方为准|[^\s]+)\s+(.+?)\s+(五险一金|带薪年假|商业保险|[^\s]+)\s+(\d+)\s+(.+?)\[点击投递\]/;
  for (const line of markdown.split('\n').map((item) => item.trim()).filter(Boolean)) {
    const match = line.match(linePattern);
    if (!match) continue;
    rows.push({
      updatedDate: match[1],
      company: match[2],
      title: match[3],
      jobType: match[4],
      city: match[5],
      education: match[6],
      experience: match[7],
      salary: match[8],
      industry: match[9],
      benefit: match[10],
      viewCount: Number(match[11]),
      sourcePlatform: match[12],
    });
  }
  return rows;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 foreign-company-searcher research' },
    });
    const text = await response.text();
    return { url, ok: response.ok, status: response.status, text };
  } catch (error) {
    return { url, ok: false, status: 'ERR', text: '', error: error?.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

await fs.mkdir('work/waiqi', { recursive: true });
const pages = [];
for (const url of SOURCE_URLS) pages.push(await fetchText(url));

const jobs = pages.flatMap((page) => parseInfoRows(page.text));
const companies = [...new Map(jobs.map((job) => [job.company, {
  company: job.company,
  industry: job.industry,
  cities: [...new Set(jobs.filter((item) => item.company === job.company).map((item) => item.city))],
  source: 'waiqi-public-info-page',
}])).values()];

const report = {
  scrapedAt,
  sourceUrls: SOURCE_URLS,
  pages: pages.map((page) => ({ url: page.url, ok: page.ok, status: page.status, error: page.error, bytes: page.text.length })),
  jobCount: jobs.length,
  companyCount: companies.length,
  jobs,
  companies,
};

await fs.writeFile('work/waiqi/public-snapshot.json', JSON.stringify(report, null, 2));
await fs.writeFile('work/waiqi/public-companies.json', JSON.stringify(companies, null, 2));
console.log(JSON.stringify({ pages: report.pages, jobCount: jobs.length, companyCount: companies.length }, null, 2));
