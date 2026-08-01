# 外企雷达

外企雷达是一个面向中国求职者的外企岗位与福利情报库。它不只是展示“有哪些外企”，而是帮助用户按行业、城市、福利标签和岗位来源发现更值得投递的外企机会。

线上地址：[https://foreign-company-searcher.pages.dev](https://foreign-company-searcher.pages.dev)

![外企雷达首页](docs/assets/homepage.png)

## 核心功能

- 外企公司库：按行业、细分赛道、国家/地区和重点城市整理外企。
- 搜索与筛选：支持搜索公司、城市、岗位方向、福利关键词。
- 高价值福利标签：例如五险一金、商业保险、补充福利、员工股票、混合办公、员工折扣等。
- 今日推荐：突出展示当前值得关注的公司和岗位。
- 官网岗位展示：当前已接入 SAP 中国范围岗位抓取结果。
- 公司详情：点击公司卡片可查看常见岗位、福利标签、招聘入口和备注。
- 设计文档：`docs/` 里包含产品计划、软件设计和 SAP 抓取方案。

## 当前数据

- 公司库：`foreign_companies_by_industry.csv`
- 前端公司数据：`public/foreign_companies_by_industry.csv`
- SAP 岗位数据：`public/jobs/sap-china.json`
- 抓取原始输出：`data/jobs/sap-china.json`

## 本地运行

```bash
npm install
npm run dev
```

打开本地地址：

```text
http://127.0.0.1:5173/
```

## 更新 SAP 岗位

```bash
npm run scrape:sap
cp data/jobs/sap-china.json public/jobs/sap-china.json
npm run build
```

抓取脚本会访问 SAP Careers 中国范围搜索结果，解析岗位标题、城市、来源链接和抓取时间。

## 构建

```bash
npm run build
```

构建产物会生成在 `dist/`。

## 部署

当前项目部署在 Cloudflare Pages。

```bash
npm run build
npx wrangler pages deploy dist --project-name foreign-company-searcher --branch main
```

## 项目结构

```text
.
├── data/jobs/                 # 抓取脚本输出的岗位数据
├── docs/                      # 产品、技术和抓取设计文档
├── docs/assets/homepage.png   # README 截图
├── public/                    # 前端可直接读取的静态数据
├── scripts/scrape-sap.mjs     # SAP 岗位抓取脚本
├── src/                       # React 前端代码
├── foreign_companies_by_industry.csv
├── package.json
└── vite.config.ts
```

## 产品方向

外企雷达的长期目标不是做另一个泛招聘网站，而是做“外企正式岗位 + 福利可信度 + 外包风险识别 + 小众赛道地图”。后续可以继续扩展：

- 更多公司官网岗位抓取。
- 合同类型/外包风险识别。
- 福利证据链和可信度等级。
- 行业专题页，例如宠物、家具家居、半导体设备、检测认证、香精香料。
- 岗位订阅和更新提醒。

## English README

See [README.en.md](README.en.md).
