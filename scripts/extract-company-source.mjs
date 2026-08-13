import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const workbookPath = process.argv[2] ?? 'foreign_companies_by_industry.xlsx';
const outputPath = process.argv[3] ?? 'work/company-source-from-xlsx.json';

function readZipEntry(path) {
  return execFileSync('unzip', ['-p', workbookPath, path], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 });
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function columnToIndex(column) {
  let value = 0;
  for (const char of column) value = value * 26 + char.charCodeAt(0) - 64;
  return value - 1;
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) => {
    return [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, text]) => decodeXml(text)).join('');
  });
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  for (const [, rowXml] of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const [, ref, attrs, value] of rowXml.matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>(?:[\s\S]*?<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>/g)) {
      const index = columnToIndex(ref);
      const raw = value ?? '';
      row[index] = attrs.includes('t="s"') ? sharedStrings[Number(raw)] ?? '' : decodeXml(raw);
    }
    if (row.some(Boolean)) rows.push(row.map((item) => item ?? ''));
  }
  return rows;
}

const sharedStrings = parseSharedStrings(readZipEntry('xl/sharedStrings.xml'));
const sheet = parseSheet(readZipEntry('xl/worksheets/sheet1.xml'), sharedStrings);
const [headers, ...rows] = sheet;
const companies = rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
await fs.mkdir('work', { recursive: true });
await fs.writeFile(outputPath, JSON.stringify({ headers, companies }, null, 2));
console.log(`Extracted ${companies.length} companies to ${outputPath}`);
