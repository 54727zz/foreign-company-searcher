<p align="right">
  <a href="README.md">中文</a> | <strong>English</strong>
</p>

# Foreign Company Radar · Waiqida

> Live site: **[https://waiqida.cn](https://waiqida.cn)**

A job-search navigation platform for candidates in China who want to work at multinational companies. Landing a job at a foreign company starts with finding the right place to apply.

---

## Why we built this

Finding a job at a foreign company in China is hard — not because of your resume, but because **you can't even tell which companies are hiring or where to apply**.

Most multinationals don't maintain an active presence on domestic platforms like Boss Zhipin or Zhaopin. Their postings are often third-party, outsourced, or simply absent. Job seekers spend hours searching only to find broken links or middlemen.

The goal of Foreign Company Radar is simple: **surface the real, official hiring channels for foreign companies in China, organized and ready to use.**

---

## Features

### Company Directory (free for everyone)
- **283 companies** with manually verified career portals
- Filter by industry, city, and benefit tags
- Keyword search across company name, role direction, city, and benefits
- Click any card to see: recommended roles, benefit tags, and direct career links

### Regional Map
- Interactive China region map — click a province or area to see its foreign companies
- Region filter syncs with the main company grid

### AI Career Advisor
- Enter your major, city, and job goals
- Get AI-matched industry directions, role types, target companies, and application keywords

### Member Benefits
- Unlimited AI advisor queries
- **Export the full 283-company list as CSV** (with industry, city, and career links)
- Daily job lead updates

---

## Changelog

### v3 (current)
- Launched on the official domain [waiqida.cn](https://waiqida.cn)
- Full company directory now free for all visitors — no more preview limits
- Members can export the complete company list as a CSV
- Added AI Career Advisor with major- and city-based matching

### v2
- User account system (register / login / forgot password)
- Job subscriptions: follow companies, cities, or keywords for update alerts
- Company cards now show crawled job leads

### v1
- Company directory with industry, benefit, and keyword filtering
- Interactive regional map
- Lightweight event tracking via Cloudflare D1
- Mobile-responsive layout

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| Styling | Vanilla CSS |
| Deployment | Cloudflare Pages |
| Database | Cloudflare D1 |
| Backend | Cloudflare Pages Functions |
| Data pipeline | Node.js scripts (multi-source merge + manual verification) |

---

## Run Locally

```bash
npm install
npm run dev
```

Local URL: `http://127.0.0.1:5173/`

> Some features (D1 database, AI advisor) require a `.dev.vars` file locally. See `.dev.vars.example` for the required variables.

## Build

```bash
npm run build
```

Output goes to `dist/`, ready for Cloudflare Pages.

---

## Project Structure

```text
.
├── src/                  # React frontend source
│   ├── App.tsx           # Main application logic
│   ├── lib/              # Utilities (CSV parsing, region matching, analytics)
│   ├── types.ts          # TypeScript type definitions
│   └── styles.css        # Global styles
├── functions/            # Cloudflare Pages Functions (API routes)
│   ├── api/advisor.ts    # AI advisor endpoint
│   ├── api/track.ts      # Event tracking endpoint
│   └── _middleware.ts    # Security middleware
├── public/               # Static assets
├── db/schema.sql         # D1 database schema
├── wrangler.toml         # Cloudflare config
└── vite.config.ts
```

---

## License

MIT
