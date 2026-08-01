<p align="right">
  <strong>中文</strong> | <a href="README.en.md">English</a>
</p>

# 外企雷达

一个使用 React + TypeScript 构建的外企公司与岗位信息展示网站。项目包含外企公司数据、基础筛选界面，以及一个 SAP 中国岗位抓取示例。

线上示例：[https://foreign-company-searcher.pages.dev](https://foreign-company-searcher.pages.dev)

![外企雷达首页](docs/assets/homepage.png)

## 功能

- 浏览外企公司列表
- 按行业筛选公司
- 按福利标签筛选公司
- 搜索公司、城市、岗位方向和福利关键词
- 查看公司详情和官网招聘入口
- 展示 SAP 中国岗位抓取结果
- 支持 Cloudflare Pages 静态部署

## 技术栈

- React
- TypeScript
- Vite
- CSS
- Cloudflare Pages
- Node.js 抓取脚本

## 本地运行

```bash
npm install
npm run dev
```

默认本地地址：

```text
http://127.0.0.1:5173/
```

## 构建

```bash
npm run build
```

构建产物会生成在 `dist/` 目录。

## 更新 SAP 岗位数据

```bash
npm run scrape:sap
cp data/jobs/sap-china.json public/jobs/sap-china.json
npm run build
```

`scripts/scrape-sap.mjs` 会抓取 SAP Careers 中国范围搜索结果，并输出岗位标题、地点、来源链接和抓取时间。

## 部署到 Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name foreign-company-searcher --branch main
```

## 项目结构

```text
.
├── data/jobs/                 # 抓取脚本输出的岗位数据
├── docs/                      # 项目设计和实现文档
├── docs/assets/homepage.png   # README 截图
├── public/                    # 前端静态数据
├── scripts/scrape-sap.mjs     # SAP 岗位抓取脚本
├── src/                       # React 前端代码
├── foreign_companies_by_industry.csv
├── package.json
└── vite.config.ts
```

## 主要数据文件

- `foreign_companies_by_industry.csv`：原始公司数据
- `public/foreign_companies_by_industry.csv`：前端读取的公司数据
- `data/jobs/sap-china.json`：SAP 抓取脚本输出
- `public/jobs/sap-china.json`：前端读取的 SAP 岗位数据

## 文档

- [实施计划](docs/implementation_plan.md)
- [软件设计计划](docs/software_design_plan.md)
- [SAP 岗位抓取方案](docs/sap_job_crawler_plan.md)
