# SAP 岗位抓取设计方案

## 目标

先用 SAP 中国岗位作为第一个岗位抓取 PoC，验证从公司官网 Careers 抓取真实岗位、去重、落库/落文件、前端展示的完整链路。

## 数据源

- 搜索页：https://jobs.sap.com/search/?q=&locationsearch=China
- 来源类型：SAP Careers 官网
- 页面特点：服务端渲染 HTML 表格，岗位标题、链接、地点直接在页面源码中，不需要登录，不需要浏览器渲染。

## 第一版抓取策略

1. 使用 HTTP GET 请求 SAP 搜索页。
2. 解析 `<tr class="data-row">` 岗位行。
3. 从 `.jobTitle-link` 提取岗位标题和详情链接。
4. 从 `colLocation` 提取地点。
5. 从详情 URL 末尾数字提取岗位 ID。
6. 用岗位 ID 去重。
7. 输出到 `data/jobs/sap-china.json`。

## 当前输出字段

```ts
type ScrapedJob = {
  id: string;
  company: 'SAP';
  title: string;
  city: string;
  location: string;
  sourcePlatform: 'SAP Careers';
  sourceUrl: string;
  searchUrl: string;
  scrapedAt: string;
  status: 'active';
};
```

## 已实现文件

- `scripts/scrape-sap.mjs`：SAP 岗位抓取脚本。
- `data/jobs/sap-china.json`：抓取结果。
- `package.json`：新增 `npm run scrape:sap`。

## 运行方式

```bash
npm run scrape:sap
```

## 下一步实现建议

### 阶段 1：展示 SAP 岗位

把 `data/jobs/sap-china.json` 复制或生成到 `public/jobs/sap-shanghai.json`，前端公司详情面板读取该 JSON，在 SAP 公司详情里显示“当前官网在招岗位”。

### 阶段 2：扩展分页

当前脚本已按 `startrow` 分页抓取中国范围岗位，默认最多 10 页，直到无新增岗位或不足一页停止，并保留 `page` 和 `rank` 字段。

### 阶段 3：详情页增强

对每个岗位详情页进行二次抓取，补充：

- 岗位描述摘要
- 职能分类
- 工作模式
- 福利关键词
- 合同类型风险关键词
- 发布时间，如果页面提供

### 阶段 4：统一抓取器接口

抽象为统一接口：

```ts
type Crawler = {
  company: string;
  sourcePlatform: string;
  searchUrl: string;
  scrape(): Promise<ScrapedJob[]>;
};
```

后续为 Microsoft、Amazon、Tesla、Siemens 等公司各写一个 adapter。

### 阶段 5：入库和定时任务

正式版本不要只写 JSON，应写入 `jobs` 表：

- `company_id`
- `external_id`
- `title`
- `city`
- `location`
- `source_platform`
- `source_url`
- `scraped_at`
- `status`
- `content_hash`

定时任务建议：热门公司每天一次，小众公司每周一次。

## 风险和注意事项

- 不复制完整 JD，只保存摘要和原始链接，降低版权风险。
- 尊重官网访问频率，SAP 当前 PoC 只请求搜索页一次。
- 如果 SAP 页面结构变化，解析器需要更新。
- 抓取结果必须显示来源和抓取时间，避免用户误以为是实时岗位。
