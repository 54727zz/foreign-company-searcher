<p align="right">
  <a href="README.md">中文</a> | <strong>English</strong>
</p>

# Foreign Company Radar

A React + TypeScript website for browsing multinational-company information and job data in China. The project includes company filtering, regional discovery, job recommendations, career-link aggregation, and community conversion features.

Live demo: [https://foreign-company-searcher.pages.dev](https://foreign-company-searcher.pages.dev)

![Foreign Company Radar homepage](docs/assets/homepage.png)

## Features

- Browse a directory of multinational companies
- Filter companies by industry
- Filter companies by benefit tags
- Search by company, city, role direction, and benefit keyword
- View company details, recommended role directions, benefit tags, and key China cities
- Display multiple career links for the same company, such as official sites, China sites, global applicant systems, and backup links
- Show SAP China job recommendations with job title, location, source link, and update time
- Discover companies by region through an interactive China-region map
- Click a region to show its company list directly and sync the main company grid
- Provide a WeChat job-seeker group entry in the bottom-right corner with an enlarged QR-code modal
- Support desktop and mobile browsing

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
