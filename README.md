<p align="right">
  <strong>中文</strong> | <a href="README.en.md">English</a>
</p>

# 外企雷达

一个使用 React + TypeScript 构建的外企公司与岗位信息展示网站。项目提供公司筛选、地区发现、岗位推荐、招聘入口聚合和求职社群引导等功能。

线上示例：[https://foreign-company-searcher.pages.dev](https://foreign-company-searcher.pages.dev)

![外企雷达首页](docs/assets/homepage.png)

## 功能

- 浏览外企公司列表
- 按行业筛选公司
- 按福利标签筛选公司
- 搜索公司、城市、岗位方向和福利关键词
- 在首页输入城市，快速查看该城市收录的外企数量、行业方向和公司名单
- 查看公司详情、适合关注岗位、福利标签和重点城市
- 展示公司招聘入口，并支持同一家公司多个入口，例如官网、国内站、全球招聘系统和备用入口
- 展示 SAP 中国岗位推荐，包括岗位标题、地点、来源链接和更新时间
- 使用中国区域地图按地区发现外企，点击区域后直接显示该地区公司名单
- 地区筛选会同步影响下方公司列表，方便从区域继续查看公司详情
- 右下角提供外企求职群入口，点击或划过后弹出放大的微信群二维码
- 提供用户反馈表单，收集用户希望补充的城市、岗位方向和功能需求
- 通过 Cloudflare D1 记录公司详情、招聘入口、城市、地区和反馈提交等轻量事件
- 适配桌面和移动端浏览

## 技术栈

- React
- TypeScript
- Vite
- CSS
- Cloudflare Pages
- Cloudflare D1
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

## 项目结构

```text
.
├── docs/assets/homepage.png   # README 截图
├── public/                    # 本地静态资源
├── scripts/scrape-sap.mjs     # SAP 岗位抓取脚本
├── src/                       # React 前端代码
├── package.json
└── vite.config.ts
```
