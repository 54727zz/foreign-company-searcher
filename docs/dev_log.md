# 外企雷达开发日志

## 2026-08-26

### 完成的事情

#### 1. 项目现状梳理
- CSV 总行数 3994，线上展示 1065 家，待挖掘 not_checked 2845 家
- 招聘入口和大行业分类完整（0 缺失）
- 城市数据缺失 295 家（27.7%），sub_sector 缺失 90 家（8.5%）

#### 2. 会员表单优化
- 新增微信号输入框（选填），备注里会带上 `微信：xxx`
- 防重复提交：成功后按钮变「已提交」且禁用，输入框锁定
- 成功文案改为「已收到！我们会在 24h 内联系您开通。」
- 当天收到第一笔付款：手机号 19953141913，已人工联系

#### 3. 城市字段标准化
- 新增 `cities` 字段（标准化城市数组，逗号分隔），原始字段 `primary_china_city_focus` 保留
- 清洗规则：去掉"市"后缀、统一分隔符、别名映射（香港特别行政区→香港等）
- 228 个标准城市，2410 家公司有城市数据
- 前端所有筛选逻辑改为读 `cities` 字段，支持一家公司命中多个城市筛选
- 脚本：`scripts/normalize-cities.py`，新增数据后必须重跑

#### 4. 数据安全整理
- `public/company-data-current.csv` 从公开仓库移除，只存 private
- `scripts/` 目录从公开仓库移除，只存 private
- `.gitignore` 更新，CLAUDE.md 更新

#### 5. Cloudflare Worker 每日日报
- 新建 `worker-cron/`，每天北京时间 09:00 自动发邮件到 ddd769903@gmail.com
- 内容：待开通会员、昨日 PV 趋势、核心指标、Top 公司/城市/地区排行
- 使用 Resend 发信（免费账号只能发到注册邮箱 Gmail）
- 已部署：`foreign-radar-cron` Worker，secret 已配置

#### 6. admin 后台
- 修复了管理密码（在 Cloudflare 环境变量 `ADMIN_PASSWORD`）
- 「待开通会员」区块过滤逻辑：`message.includes('会员')`

---

### 未完成 / 遗留问题

#### 🔴 城市数据补充（295 家）
- 尝试了 ATS API（SR / Greenhouse / Lever）自动抓取在招城市
- 结果：只补了 3 家，命中率极低
- 根本原因：
  - 大多数公司（229/295）是自建官网招聘，没有标准 API
  - SR 公司的中国区 slug 和全球 slug 不同，变体枚举猜中率低
  - 很多公司中国区不用主 slug，用独立系统
- **下一步**：用 Gemini AI 批量推断（输入公司名+行业+官网，推断中国主要运营城市）
  - 优点：对知名外企准确率高
  - 缺点：是"公司有哪些城市"而非"现在在招哪些城市"，结果标记 `city_confidence: low`

#### 🟡 sub_sector 补充（90 家）
- 有公司名和大行业，可以用 AI 批量推断细分赛道
- 优先级低于城市补充

#### 🟡 not_checked 挖掘（2845 家）
- 还有 71% 的公司没做 ATS 探测
- 上次做到 Batch 2（1065 家），下次继续
- 优先挖有英文名的：跑 `/tmp/ats-finder-v2.mjs`
- 中文名的：跑 `/tmp/cn-to-ats.mjs`

#### 🟡 Resend 发信域名
- 目前只能发到 Gmail（ddd769903@gmail.com）
- 要发到 QQ 邮箱需要验证 waiqida.cn 域名（在 Resend 加几条 DNS 记录）
- 后续可以改用 `noreply@waiqida.cn` 发到任意邮箱

#### 🟡 Worker Cron 手动测试
- Cloudflare Dashboard 里没找到 Trigger 按钮，未手动验证邮件是否正常发出
- HTTP trigger 端点（`/trigger?token=xxx`）因 workers.dev 域名访问报 1101 错误
- 需要在 Cloudflare Dashboard 确认 Worker 触发器是否正常

#### 🟢 会员开通流程 TODO
- 用户付款数据存储位置未确定（CLAUDE.md 里标了 [TODO]）
- admin.html 目前只有展示，没有一键开通按钮，需要人工操作

---

## 2026-08-27

### 完成的事情

#### 1. 合作入口上线
- 顶部导航加「招聘合作」按钮，样式与其他导航一致
- 底部 footer 加「招聘合作 / 岗位收录」和「联系我们」
- 三处点击均弹出合作说明弹窗（不直接跳邮件），显示邮箱 1963336581@qq.com
- footer 已添加版权信息

#### 2. 公司列表分页
- 默认展示 20 家，底部「加载更多 · 还有 XXX 家」按钮
- 每次加载 20 家，筛选条件变化自动重置到第一页
- 解决了用户面对 1065 家公司不知道从哪里看的问题

### 未完成 / 遗留问题

#### 🔴 会员开通功能（代码已写好，等待部署）
代码已完成，但因 Cloudflare wrangler 登录问题（个人账号 OAuth 认证失败）未能部署：
- D1 需要执行迁移：`ALTER TABLE app_users ADD COLUMN member_expires_at TEXT`
- 新增后端接口：`/api/admin/set-member`（管理员开通/撤销会员）
- 更新 `/api/auth/me`：返回 `isMember` 和 `memberExpiresAt`
- Admin 后台「待开通会员」加了「开通 1 个月」按钮
- **下次登录 Cloudflare 后第一件事：跑迁移 + 部署**

迁移命令：
```bash
npx wrangler d1 execute foreign_radar_analytics --remote --command "ALTER TABLE app_users ADD COLUMN member_expires_at TEXT;"
npx wrangler pages deploy dist --project-name foreign-company-searcher --branch main --commit-dirty=true
```

---

### 当前数据快照（2026-08-26）
| 指标 | 数值 |
|------|------|
| CSV 总行数 | 3,994 |
| 线上展示 | 1,065 |
| verified_career | 791 |
| not_checked | 2,845 |
| 无城市数据（线上） | 295 |
| 无 sub_sector（线上） | 90 |
