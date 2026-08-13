---
name: foreign-jobs-crawler
description: Use when working on the 外企雷达 / foreign-company-searcher project to crawl foreign-company career pages, extract job postings, record crawl status, inspect crawl quality, import trusted job data into Cloudflare D1, or operate/extend the company jobs crawler.
---

# Foreign Jobs Crawler

## Scope

Use this skill only for the local project at:

`/Users/I778291/Documents/foreign-company searcher`

The crawler works from the private local company dataset. Do not commit or expose private data files:

- `foreign_companies_by_industry.xlsx`
- `foreign_companies_by_industry.csv`
- `public/foreign_companies_by_industry.csv`
- `data/jobs/`
- `public/jobs/`
- `work/`
- `docs/*.md`

## Core Principle

Do not claim that every scraped item is production-quality. Treat crawl output in three tiers:

- **Trusted parser output**: company-specific or platform-specific parser results, suitable for product display after spot-checking.
- **Generic parser output**: useful for discovery and internal triage, but requires sampling before public display.
- **Crawl status only**: entrance is reachable, blocked, failed, or parse-not-supported.

Prefer recording crawl status over pretending a dynamic site was successfully parsed.

## Standard Workflow

1. Go to the project directory:

```bash
cd "/Users/I778291/Documents/foreign-company searcher"
```

2. Check the worktree before changing anything:

```bash
git status --short
```

3. For SAP-only trusted refresh:

```bash
npm run scrape:sap
npm run jobs:import:remote
```

This updates:

- `data/jobs/sap-china.json`
- `public/jobs/sap-china.json`
- `work/jobs/sap-china-import.sql`
- D1 `job_sources` and `jobs` tables when import succeeds

4. For full-company crawl trial:

```bash
npm run jobs:crawl
```

This reads the local Excel file, crawls all company recruiting URLs, and writes:

- `work/company-source-from-xlsx.json`
- `data/jobs/all-companies-jobs.json`
- `work/jobs/all-company-crawl-report.json`
- `work/jobs/all-company-crawl-report.csv`
- `work/jobs/all-companies-jobs-import.sql`

5. Build after script/code changes:

```bash
npm run build
```

6. Verify outputs before importing or deploying:

```bash
node -e "const r=require('./work/jobs/all-company-crawl-report.json'); console.log(r.summary, r.jobCount)"
```

For SAP API verification after remote import/deploy:

```bash
curl -s -A 'Mozilla/5.0' 'https://foreign-company-searcher.pages.dev/api/jobs?company=SAP' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(j.count,j.cityCounts)})"
```

## Import Rules

Use remote import only for trusted or deliberately selected data.

- SAP trusted path: `npm run jobs:import:remote`
- Full generic crawl import exists, but do not run it blindly for production display:

```bash
npm run jobs:import:all:remote
```

Before importing generic crawl results, inspect at least:

- Top companies by `jobCount`
- A few sample `sourceUrl` values per high-volume company
- Whether the URLs point to real job postings rather than broad search/category pages
- Whether city/location is credible enough for user-facing display

If Cloudflare `wrangler d1 execute --remote --file=...` fails with an import authentication error, use the project script that imports SQL statements one by one:

```bash
node scripts/import-jobs-d1.mjs foreign_radar_analytics work/jobs/sap-china-import.sql --remote
```

## Crawl Status Meanings

- `jobs_found`: parser found at least one job-like URL/title.
- `reachable_no_jobs_parsed`: page loaded, but current parser did not extract jobs. Usually dynamic rendering, Workday/Oracle/Eightfold APIs, or needs a platform parser.
- `blocked_403`: site blocked script access; may still work in a normal browser.
- `fetch_failed`: network/TLS/timeout failure.
- `not_found`: clear 404 or soft 404.
- `no_url`: company row lacks a usable recruiting URL.

## Parser Priority

When improving coverage, prioritize platform parsers in this order:

1. SAP SuccessFactors / `jobs.sap.com`
2. Workday / `myworkdayjobs.com`
3. Oracle Cloud Recruiting / `oraclecloud.com` CandidateExperience
4. Phenom/Search Jobs pages with `/search-jobs/`
5. SmartRecruiters
6. Lever
7. Greenhouse
8. Eightfold

Do not spend too much time on LinkedIn scraping. It has high anti-bot and compliance risk.

## Reporting To The User

Summaries should include:

- Number of companies attempted
- Number of companies with parsed jobs
- Number of companies reachable but not parsed
- Blocked/failed/not-found counts
- Total job-like records found
- Report file paths
- Whether anything was imported to D1 or only saved locally
- Clear caveat if results are generic parser output

Use local file links for important outputs, for example:

- `/Users/I778291/Documents/foreign-company searcher/work/jobs/all-company-crawl-report.csv`
- `/Users/I778291/Documents/foreign-company searcher/docs/job_crawl_trial_report.md`

## Safety

- Do not commit private job/company data.
- Do not push generic crawl output to production without spot-checking.
- Do not delete user data or reset D1 tables unless explicitly asked.
- Do not run destructive git commands.
- Keep internal reports under `docs/` or `work/`, both ignored by Git.
