<p align="right">
  <a href="README.md">中文</a> | <strong>English</strong>
</p>

# Foreign Company Radar

A React + TypeScript website for browsing multinational-company information and job data in China. The project includes company filtering UI and an example SAP China job crawler.

Live demo: [https://foreign-company-searcher.pages.dev](https://foreign-company-searcher.pages.dev)

![Foreign Company Radar homepage](docs/assets/homepage.png)

## Features

- Browse a directory of multinational companies
- Filter companies by industry
- Filter companies by benefit tags
- Search by company, city, role direction, and benefit keyword
- View company details and official career links
- Display SAP China job feed data
- Deploy as a static site on Cloudflare Pages

## Tech Stack

- React
- TypeScript
- Vite
- CSS
- Cloudflare Pages
- Node.js crawler script

## Run Locally

```bash
npm install
npm run dev
```

Default local URL:

```text
http://127.0.0.1:5173/
```

## Build

```bash
npm run build
```

The production build is generated in `dist/`.

## Update SAP Job Data

```bash
npm run scrape:sap
npm run build
```

`scripts/scrape-sap.mjs` fetches SAP Careers search results for China and outputs job title, location, source URL, and scrape time.
Raw crawler output and frontend data files are kept locally and are not committed to GitHub.

## Deploy to Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name foreign-company-searcher --branch main
```

## Project Structure

```text
.
├── docs/assets/homepage.png   # README screenshot
├── public/                    # Local static assets
├── scripts/scrape-sap.mjs     # SAP job crawler
├── src/                       # React frontend source code
├── package.json
└── vite.config.ts
```
