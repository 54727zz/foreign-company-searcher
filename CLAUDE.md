# 外企雷达 (waiqida.cn) — 项目指引

## 项目概览
- 网站：https://waiqida.cn
- 后台：https://waiqida.cn/admin.html
- 私密仓库：https://github.com/54727zz/foreign-company-searcher-private
- 技术栈：React + TypeScript + Vite，部署在 Cloudflare Pages

## 数据文件
`public/company-data-current.csv` — 主数据文件，3994 行（截至 2026-08-24）

### CSV 读写（重要：双 BOM 问题）
文件头有双 BOM（`﻿﻿`），**必须用以下方式读取**，否则 `csv.DictReader` 的 key 会带 BOM 前缀：

```python
import csv
with open('public/company-data-current.csv', 'rb') as f:
    raw = f.read()
content = raw.decode('utf-8')
while content.startswith('﻿'):   # 循环去除所有 BOM
    content = content[1:]
rows = list(csv.DictReader(content.splitlines()))
```

**写回时用 utf-8-sig（单 BOM，Excel 兼容）：**
```python
fieldnames = list(rows[0].keys())
with open('public/company-data-current.csv', 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
```

### 线上公司判定（与前端 isPublicCompany 一致）
```python
VERIFIED = {
    'official_site_verified', 'domain_guess_verified', 'verified_career',
    'official_site_no_verified_career', 'local_seed_existing_url'
}
public_rows = [r for r in rows
               if r.get('career_enrichment_status', '') in VERIFIED
               or r.get('verified_career_url', '').strip()]
```

## 部署流程
```bash
# 必须本地 build，dist/ 在 .gitignore 里
npm run build
npx wrangler pages deploy dist --project-name foreign-company-searcher --branch main --commit-dirty=true

# 同时推送源码（两个 remote）
git push private main   # 私密仓库
git push origin main    # 公开仓库（不含敏感数据）
```

## ATS 探测核心坑点

### SmartRecruiters 假命中问题
- **错误方法**：`GET /api/v1/companies/{slug}/postings` → 任意 slug 均返回 HTTP 200（即使公司不存在）
- **正确方法**：检查页面 `careers.smartrecruiters.com/{slug}` 是否返回 HTTP 200
  - 200 = 公司存在
  - 302 → `jobs.smartrecruiters.com` = 公司不存在

```bash
# 正确检测命令
curl -so /dev/null -w "%{http_code}" --max-redirs 0 https://careers.smartrecruiters.com/{slug}
```

### Greenhouse / Lever / Ashby
- Greenhouse：`GET boards-api.greenhouse.io/v1/boards/{slug}/jobs` → 200=存在，302/404=不存在
- Lever：`GET api.lever.co/v0/postings/{slug}` → 200=存在，302=不存在（**必须** `redirect: 'manual'`）
- Ashby：POST GraphQL，查 `jobBoard.id` 是否非空

### Workable 限流
- `apply.workable.com/api/v1/widget/accounts/{slug}` 会 429
- 解决：降低并发到 **5**，429 时指数退避重试（2s/4s/6s）

### waiqi.com 是 Vue SPA，无法直接 curl 抓数据
- 所有公司详情需要登录 token 才能调 API（`code: 1022, message: "token expired"`）
- not_checked 公司只有 waiqi_source_url，没有 official_website，需另找英文名

## 中文名→英文 slug 转换
`/tmp/cn-to-ats.mjs` 内置 CN_TO_SLUG 大映射表（300+ 词条），处理中文注册名公司。
示例：`安永 → ey`，`毕马威 → kpmg`，`宝马 → bmw`

## 关键脚本
| 文件 | 用途 |
|------|------|
| `/tmp/ats-finder-v2.mjs` | 英文 slug → ATS 探测（已修复 SmartRecruiters 假命中）|
| `/tmp/cn-to-ats.mjs` | 中文名映射 + ATS 探测（含 300+ 词条大表）|
| `/tmp/ats-finder.mjs` | 原版三层递进脚本（层2扫官网HTML/层3暴力探路）|

## 部署验证清单
部署完成后访问 https://waiqida.cn 逐项检查：
- [ ] 首页公司数量显示正确（当前应为 1065）
- [ ] AI 推荐框正常显示，免费用户限 2 次/天
- [ ] 点击公司招聘入口能跳转（抽查 3-5 家）
- [ ] CSV 导出功能需要会员才能使用
- [ ] admin.html 后台可正常打开

## GitHub 双 remote 推送规则
- `private`：推所有内容
- `origin`（公开仓库）：以下内容不推（已在 `.gitignore`）：
  - `docs/`
  - `work/`
  - `scripts/`
  - `public/company-data-current.csv`
  - `.dev.vars`
  - `CLAUDE.md`

推送前用 `git status` 确认没有敏感文件被意外追踪。

## 城市字段维护规范
- 主数据文件新增了 `cities` 字段（标准化城市数组，逗号分隔），原始字段 `primary_china_city_focus` 保留不动
- 前端所有城市筛选逻辑均读 `cities` 字段，不读原始字段
- 新增或更新公司数据后，必须重新跑 `scripts/normalize-cities.py` 刷新 `cities` 字段
- 标准化规则：去掉"市"后缀、统一分隔符为逗号、别名映射（香港特别行政区→香港 等）
- 脚本在 `scripts/normalize-cities.py`，直接 `python3 scripts/normalize-cities.py` 即可

## not_checked 公司挖掘流程
当前 not_checked：2845 家，优先级顺序：
1. 有英文名（`english_name` 非空）→ 跑 `/tmp/ats-finder-v2.mjs`
2. 只有中文名 → 先过 `/tmp/cn-to-ats.mjs`（内置 300+ 词条映射表）
3. 既无英文名也不在映射表 → 暂跳过，人工处理

每批建议 100-200 家，跑完统计新增 verified_career 数量再 commit。
注意：`/tmp/` 下脚本重启后会丢失，用前先确认文件存在。

## 会员人工开通流程（早期阶段）
1. 用户扫码付款后提交手机号/微信
2. 数据存储位置：[TODO]
3. 打开 https://waiqida.cn/admin.html 手动开通
4. 通知用户

当前会员权益：CSV 导出完整公司名单；AI 推荐不限次（免费用户限 2 次/天）。
