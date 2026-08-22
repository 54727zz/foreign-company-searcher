import fs from 'node:fs/promises';

const MERGED_JSON = 'work/waiqi/merge/foreign-companies-merged-with-waiqi.json';
const CACHE_DIR = 'work/waiqi/career-enrichment/career-checks';
const OUT_DIR = 'work/waiqi/career-enrichment';
function cleanText(value) { return value == null ? '' : String(value).replace(/\u00a0/g, ' ').trim(); }
function csvValue(value) { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; }
function careerUrlSignal(value) { return /career|careers|job|jobs|join-us|joinus|recruit|recruitment|talent|workday|oraclecloud|smartrecruiters|greenhouse|lever|eightfold|successfactors|招聘|职位|加入我们|人才/i.test(value || ''); }
function strictCareer(check) { return check?.ok && (careerUrlSignal(check.finalUrl) || careerUrlSignal(check.url) || careerUrlSignal(check.title)); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

const rows = JSON.parse(await fs.readFile(MERGED_JSON, 'utf8'));
const files = (await fs.readdir(CACHE_DIR)).filter((name) => name.endsWith('.json'));
const results = [];
for (const file of files) {
  const cached = JSON.parse(await fs.readFile(`${CACHE_DIR}/${file}`, 'utf8'));
  const career = (cached.checks || []).find(strictCareer);
  const homepage = (cached.checks || []).find((item) => item.ok);
  results.push({
    company: cached.company,
    waiqiId: String(cached.waiqiId || file.replace('.json', '')),
    website: cleanText(cached.website),
    careerUrl: career?.finalUrl || career?.url || '',
    homepageUrl: homepage?.finalUrl || homepage?.url || '',
    status: career ? 'verified_career' : homepage ? 'homepage_only' : cached.website ? 'website_unreachable' : 'no_website',
  });
}
const byId = new Map(results.map((item) => [item.waiqiId, item]));
const enrichedRows = rows.map((row) => {
  if (row.recruiting_url) return { ...row, official_website: '', verified_career_url: row.recruiting_url, career_enrichment_status: 'local_seed_existing_url' };
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
  cachedCompanies: results.length,
  verifiedCareer: results.filter((item) => item.status === 'verified_career').length,
  homepageOnly: results.filter((item) => item.status === 'homepage_only').length,
  websiteUnreachable: results.filter((item) => item.status === 'website_unreachable').length,
  noWebsite: results.filter((item) => item.status === 'no_website').length,
  notChecked: rows.filter((row) => row.data_source === 'waiqi_candidate' && !byId.has(String(row.waiqi_id))).length,
};
await fs.writeFile(`${OUT_DIR}/waiqi-career-cache-strict-results.json`, JSON.stringify(results, null, 2));
await fs.writeFile(`${OUT_DIR}/foreign-companies-local-enriched-strict.csv`, '\uFEFF' + csv);
await fs.writeFile(`${OUT_DIR}/foreign-companies-local-enriched-strict.json`, JSON.stringify(enrichedRows, null, 2));
await fs.writeFile(`${OUT_DIR}/waiqi-career-cache-strict-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
