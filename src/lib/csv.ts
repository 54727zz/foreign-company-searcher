import type { Company } from '../types';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }

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

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function splitBenefits(value: string): string[] {
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function loadCompanies(): Promise<Company[]> {
  const response = await fetch('/foreign_companies_by_industry.csv');
  if (!response.ok) throw new Error('Unable to load company data');
  const text = await response.text();
  const [headers, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));

  return rows.map((row) => {
    const item = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    return {
      industry: item.industry,
      subSector: item.sub_sector,
      company: item.company,
      brandOrCnName: item.brand_or_cn_name,
      countryOrRegion: item.country_or_region,
      primaryChinaCityFocus: item.primary_china_city_focus,
      recruitingUrl: item.recruiting_url,
      rolesToWatch: item.roles_to_watch,
      benefitOrFilterTags: item.benefit_or_filter_tags,
      notes: item.notes,
      benefits: splitBenefits(item.benefit_or_filter_tags),
    } satisfies Company;
  });
}
