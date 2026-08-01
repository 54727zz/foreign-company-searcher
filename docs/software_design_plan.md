# 外企信息集合网站软件设计计划

## 产品定位

当前原型里的“MVP”“这版原型”“下一步可以接”等表达只适合团队内部，不适合终端用户。真实产品应表达为一个可信的外企求职工具。

用户侧定位：外企岗位，不再靠碰运气找。

用户侧副标题：按行业、城市、福利和合同类型筛选真实外企机会，发现科技、药企、宠物食品、家具家居、半导体设备等值得关注的公司。

## 第一版目标

第一版做“可用的公司情报库”，先不做全自动岗位抓取。

必须完成：

- 真实用户文案，不出现 MVP、原型、下一步等内部措辞。
- 从现有 CSV 加载公司数据。
- 支持公司、城市、赛道、福利关键词搜索。
- 支持行业筛选。
- 支持福利标签筛选。
- 支持公司详情面板。
- 支持打开官网招聘入口。
- 支持热门入口：全部外企、小众赛道、年假/福利、半导体、宠物、家具家居。

## 技术选型

第一版使用 Vite + React + TypeScript。

原因：

- 本地启动快，适合快速迭代产品形态。
- 代码结构比单个 HTML 更接近真实产品。
- 数据可以先从 CSV 加载，后续替换为 API/数据库。
- 未来可以平滑迁移到 Next.js。

第一版技术栈：Vite、React、TypeScript、普通 CSS、本地 CSV 数据文件。

后续正式版本建议：Next.js、PostgreSQL、Prisma、Meilisearch/Typesense、定时抓取服务、管理后台。

## 目录结构

```text
foreign-company searcher/
  package.json
  index.html
  public/
    foreign_companies_by_industry.csv
  src/
    App.tsx
    main.tsx
    styles.css
    lib/
      csv.ts
    types.ts
  foreign_companies_by_industry.csv
  implementation_plan.md
  software_design_plan.md
```

## 前端模块设计

### 数据层

`src/lib/csv.ts` 负责加载 CSV、解析带引号字段、转换为 Company 类型、拆分福利标签。后续替换 API 时，只需要把 `loadCompanies()` 改为请求后端。

### 类型层

`src/types.ts` 定义 `Company`。后续扩展 `Job`、`BenefitEvidence`、`Source`、`Submission`。

### UI 层

`App.tsx` 负责第一版交互：搜索输入、行业筛选、福利筛选、统计卡片、公司列表、公司详情抽屉。

第一版不拆太碎，避免过早工程化。第二版可以拆成 Header、FilterSidebar、CompanyCard、CompanyDrawer、IndustryOverview。

## 数据模型

```ts
type Company = {
  industry: string;
  subSector: string;
  company: string;
  brandOrCnName: string;
  countryOrRegion: string;
  primaryChinaCityFocus: string;
  recruitingUrl: string;
  rolesToWatch: string;
  benefitOrFilterTags: string;
  notes: string;
  benefits: string[];
};
```

第二版数据库建议：companies、industries、jobs、benefits、sources、submissions。

## 真实产品文案原则

不要使用：MVP、原型、这版、下一步可以接、给团队看的描述。

使用：外企岗位，不再靠碰运气找；按行业、城市、福利和合同类型筛选真实外企机会；发现小众但高质量的外企赛道；查看官网招聘入口；关注补充公积金、商业保险、员工股票、混合办公等高价值福利。

## 第一版验收标准

- 页面能通过 `npm run dev` 启动。
- 数据从 CSV 加载，不再硬编码在 HTML 中。
- 搜索 SAP、宠物、家具、半导体、商业保险有结果。
- 点击公司卡片能打开详情抽屉。
- 官网招聘按钮能跳转原始招聘链接。
- 页面在桌面和手机宽度下不明显错位。
- 页面不出现内部开发措辞。

## 后续实施顺序

1. 第一版：静态数据产品化页面。
2. 第二版：公司详情独立路由、行业专题页、福利专题页。
3. 第三版：接 PostgreSQL 和管理后台。
4. 第四版：抓取官网岗位。
5. 第五版：福利证据库和外包风险识别。
6. 第六版：岗位订阅、用户投稿、会员筛选。
