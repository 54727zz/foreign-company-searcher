import fs from 'node:fs/promises';

const LOCAL_CSV = 'foreign_companies_by_industry.csv';
const WAIQI_JSON = 'work/waiqi/companies/waiqi-companies.json';
const OUT_DIR = 'work/waiqi/merge';

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

function cleanText(value) {
  return value == null ? '' : String(value).replace(/\u00a0/g, ' ').trim();
}

function normalizeCompanyName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[()（）\[\]【】]/g, '')
    .replace(/[·•・]/g, '')
    .replace(/有限公司|股份公司|股份有限公司|中国有限公司|中国投资有限公司|投资有限公司|分公司|代表处/g, '')
    .replace(/公司$/g, '');
}

function mapIndustry(waiqiIndustry) {
  const value = cleanText(waiqiIndustry);
  const rules = [
    [/IT|互联网|游戏|人工智能|数字工业/i, '科技/软件/云计算'],
    [/通信|电子|半导体|智能硬件/i, '半导体/芯片/硬件'],
    [/医疗|医药|生物/i, '医疗健康/生命科学'],
    [/金融/i, '金融/保险/咨询'],
    [/咨询|商务服务|人力资源|法律|财务|审计|税务/i, '专业服务/咨询/人力资源'],
    [/快速消费|贸易|批发|零售/i, '消费品/零售/FMCG'],
    [/汽车/i, '汽车/出行/工业制造'],
    [/机械|制造/i, '工业制造/自动化/材料'],
    [/能源|化工|环保|新能源/i, '能源/化工/环保'],
    [/交通|物流|仓储/i, '物流/供应链/航运'],
    [/房地产|建筑/i, '地产/建筑/设施服务'],
    [/耐用消费品/i, '家具家居/耐用消费品'],
    [/农林牧渔/i, '宠物/农业/食品链'],
    [/检测|认证/i, '检测认证/质量服务'],
  ];
  return (rules.find(([pattern]) => pattern.test(value))?.[1] ?? value) || '未分类';
}

function rowToObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, cleanText(row[index])]));
}

await fs.mkdir(OUT_DIR, { recursive: true });

const localRows = parseCsv((await fs.readFile(LOCAL_CSV, 'utf8')).replace(/^\uFEFF/, ''));
const [headers, ...rows] = localRows;
const localCompanies = rows.map((row) => rowToObject(headers, row));
const waiqiCompanies = JSON.parse(await fs.readFile(WAIQI_JSON, 'utf8'));

const outputHeaders = [
  ...headers,
  'data_source',
  'waiqi_id',
  'waiqi_industry',
  'waiqi_scale',
  'waiqi_cities',
  'waiqi_welfare',
  'waiqi_position_count',
  'waiqi_source_url',
  'merge_status',
];

const seen = new Map();
const output = [];
const duplicates = [];

for (const company of localCompanies) {
  const key = normalizeCompanyName(company.company || company.brand_or_cn_name);
  seen.set(key, company.company || company.brand_or_cn_name);
  output.push({
    ...company,
    data_source: 'local_verified_seed',
    waiqi_id: '',
    waiqi_industry: '',
    waiqi_scale: '',
    waiqi_cities: '',
    waiqi_welfare: '',
    waiqi_position_count: '',
    waiqi_source_url: '',
    merge_status: 'kept_local',
  });
}

for (const company of waiqiCompanies) {
  const key = normalizeCompanyName(company.name || company.abbreviation);
  if (!key) continue;
  if (seen.has(key)) {
    duplicates.push({ localCompany: seen.get(key), waiqiCompany: company.name, waiqiId: company.waiqiId, sourceUrl: company.sourceUrl });
    continue;
  }
  seen.set(key, company.name);
  output.push({
    industry: mapIndustry(company.industry),
    sub_sector: cleanText(company.industry),
    company: cleanText(company.name),
    brand_or_cn_name: cleanText(company.abbreviation || company.name),
    country_or_region: '',
    primary_china_city_focus: cleanText(company.cities),
    recruiting_url: '',
    roles_to_watch: '',
    benefit_or_filter_tags: cleanText(company.welfare),
    notes: '来自 waiqi 公司目录，仅作为候选公司线索；官网招聘入口待验证。',
    data_source: 'waiqi_candidate',
    waiqi_id: company.waiqiId,
    waiqi_industry: cleanText(company.industry),
    waiqi_scale: cleanText(company.scale),
    waiqi_cities: cleanText(company.cities),
    waiqi_welfare: cleanText(company.welfare),
    waiqi_position_count: company.positionCount ?? 0,
    waiqi_source_url: company.sourceUrl,
    merge_status: 'added_from_waiqi',
  });
}

const csv = [outputHeaders.join(','), ...output.map((row) => outputHeaders.map((header) => csvValue(row[header])).join(','))].join('\n');
const report = {
  generatedAt: new Date().toISOString(),
  localSeedCount: localCompanies.length,
  waiqiInputCount: waiqiCompanies.length,
  mergedCount: output.length,
  addedFromWaiqi: output.filter((row) => row.data_source === 'waiqi_candidate').length,
  duplicateCount: duplicates.length,
  caveat: 'Waiqi rows are company leads only. recruiting_url is intentionally blank until official career links are independently verified.',
};

await fs.writeFile(`${OUT_DIR}/foreign-companies-merged-with-waiqi.csv`, '\uFEFF' + csv);
await fs.writeFile(`${OUT_DIR}/foreign-companies-merged-with-waiqi.json`, JSON.stringify(output, null, 2));
await fs.writeFile(`${OUT_DIR}/waiqi-merge-duplicates.json`, JSON.stringify(duplicates, null, 2));
await fs.writeFile(`${OUT_DIR}/waiqi-merge-report.json`, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
