const SEARCH_URL = 'https://jobs.sap.com/search/?q=&locationsearch=China';
const PAGE_SIZE = 25;
const MAX_PAGES = 10;
const BASE_URL = 'https://jobs.sap.com';

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

function parseRows(html) {
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
    const location = locationMatch ? stripTags(locationMatch[1]) : 'Shanghai, CN';

    jobs.push({
      id,
      company: 'SAP',
      title: stripTags(titleMatch[2]),
      city: location.split(',')[0]?.trim() || 'Shanghai',
      location,
      sourcePlatform: 'SAP Careers',
      sourceUrl,
      searchUrl: SEARCH_URL,
      scrapedAt: new Date().toISOString(),
      status: 'active',
    });
  }

  return jobs;
}

async function fetchPage(startrow) {
  const url = startrow === 0 ? SEARCH_URL : `${SEARCH_URL}&startrow=${startrow}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 foreign-company-searcher/0.1',
      'accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`SAP search failed: ${response.status} ${response.statusText}`);
  }

  return { url, html: await response.text() };
}

async function main() {
  const allJobs = [];
  const seen = new Set();
  const fetchedPages = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const startrow = page * PAGE_SIZE;
    const { url, html } = await fetchPage(startrow);
    const pageJobs = parseRows(html);
    fetchedPages.push(url);

    let newJobs = 0;
    for (const job of pageJobs) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
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
    company: 'SAP',
    sourceUrl: SEARCH_URL,
    scope: 'China',
    scrapedAt: new Date().toISOString(),
    fetchedPages,
    count: allJobs.length,
    cityCounts,
    jobs: allJobs,
  };

  const jobs = allJobs;

  await import('node:fs/promises').then((fs) => fs.mkdir('data/jobs', { recursive: true }).then(() => fs.writeFile('data/jobs/sap-china.json', JSON.stringify(output, null, 2))));
  console.log(`SAP China jobs scraped: ${jobs.length}`);
  console.log('City counts:', JSON.stringify(cityCounts));
  console.log(jobs.slice(0, 5).map((job) => `- ${job.title} | ${job.location}`).join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
