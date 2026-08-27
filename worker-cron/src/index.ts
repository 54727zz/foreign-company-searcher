type Env = {
  ANALYTICS_DB: D1Database;
  RESEND_API_KEY: string;
  REPORT_EMAIL: string;
  ADMIN_PASSWORD: string;
};

interface EventCount { event_name: string; count: number }
interface TopItem { company?: string; city?: string; region?: string; count: number }
interface DailyEvent { day: string; event_name: string; count: number }
interface Feedback { id: number; contact: string; message: string; created_at: string }
interface User { id: number; phone: string; created_at: string }

async function queryAll<T>(db: D1Database, sql: string): Promise<T[]> {
  try {
    const result = await db.prepare(sql).all<T>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

async function sendEmail(apiKey: string, to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'waiqida <onboarding@resend.dev>',
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
  return res.json();
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function badge(label: string, color: string) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${color};color:#fff;font-size:12px;font-weight:600;">${label}</span>`;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const db = env.ANALYTICS_DB;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // ---- 并发拉取所有数据 ----
    const [
      eventCounts,
      dailyEvents,
      topCompanies,
      topCities,
      topRegions,
      topCareerLinks,
      recentFeedback,
      recentUsers,
      paywallEvents,
      yesterdayAiCount,
    ] = await Promise.all([
      queryAll<EventCount>(db,
        `SELECT event_name, COUNT(*) AS count FROM analytics_events GROUP BY event_name ORDER BY count DESC`),
      queryAll<DailyEvent>(db,
        `SELECT date(created_at) AS day, event_name, COUNT(*) AS count
         FROM analytics_events
         WHERE created_at >= datetime('now', '-14 days')
         GROUP BY day, event_name ORDER BY day DESC`),
      queryAll<TopItem>(db,
        `SELECT company, COUNT(*) AS count FROM analytics_events
         WHERE event_name = 'company_detail_click' AND company IS NOT NULL
         GROUP BY company ORDER BY count DESC LIMIT 10`),
      queryAll<TopItem>(db,
        `SELECT city, COUNT(*) AS count FROM analytics_events
         WHERE event_name = 'city_filter_click' AND city IS NOT NULL
         GROUP BY city ORDER BY count DESC LIMIT 10`),
      queryAll<TopItem>(db,
        `SELECT region, COUNT(*) AS count FROM analytics_events
         WHERE event_name = 'region_filter_click' AND region IS NOT NULL
         GROUP BY region ORDER BY count DESC LIMIT 10`),
      queryAll<TopItem>(db,
        `SELECT company, COUNT(*) AS count FROM analytics_events
         WHERE event_name = 'career_link_click' AND company IS NOT NULL
         GROUP BY company ORDER BY count DESC LIMIT 10`),
      queryAll<Feedback>(db,
        `SELECT id, contact, message, created_at FROM user_feedback ORDER BY id DESC LIMIT 50`),
      queryAll<User>(db,
        `SELECT id, phone, created_at FROM app_users ORDER BY id DESC LIMIT 5`),
      queryAll<EventCount>(db,
        `SELECT event_name, COUNT(*) AS count FROM analytics_events
         WHERE event_name LIKE '%paywall%' GROUP BY event_name ORDER BY count DESC`),
      queryAll<{count: number}>(db,
        `SELECT COUNT(*) as count FROM analytics_events
         WHERE event_name = 'job_advisor_submit' AND date(created_at) = '${yesterday}'`),
    ]);

    // ---- 计算关键指标 ----
    const totalPv = eventCounts.find(e => e.event_name === 'page_view')?.count ?? 0;
    const totalCareerClicks = eventCounts.find(e => e.event_name === 'career_link_click')?.count ?? 0;
    const totalAiSubmits = eventCounts.find(e => e.event_name === 'job_advisor_submit')?.count ?? 0;
    const totalPaywallViews = paywallEvents.reduce((s, e) => s + e.count, 0);
    const totalUsers = recentUsers[0]?.id ?? 0;

    // 昨日 PV
    const yesterdayPv = dailyEvents
      .filter(e => e.day === yesterday && e.event_name === 'page_view')
      .reduce((s, e) => s + e.count, 0);

    // 前天 PV（用于对比）
    const dayBeforeYesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const dbfPv = dailyEvents
      .filter(e => e.day === dayBeforeYesterday && e.event_name === 'page_view')
      .reduce((s, e) => s + e.count, 0);

    const pvTrend = dbfPv > 0
      ? (yesterdayPv > dbfPv ? `📈 +${yesterdayPv - dbfPv}（较前天）` : `📉 -${dbfPv - yesterdayPv}（较前天）`)
      : '';

    // 昨日 AI 问答次数
    const aiYesterday = yesterdayAiCount[0]?.count ?? 0;

    // 待开通会员
    const pendingMembers = recentFeedback.filter(f => f.message?.includes('会员'));

    // 近 7 天新用户（注册）
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const newUsersThisWeek = recentUsers.filter(u => u.created_at >= sevenDaysAgo).length;

    // 付费墙转化率
    const conversionRate = totalPaywallViews > 0
      ? ((pendingMembers.length / totalPaywallViews) * 100).toFixed(1)
      : '0';

    // ---- 分析亮点 ----
    const insights: string[] = [];

    if (yesterdayPv === 0) {
      insights.push('⚠️ 昨日 PV 为 0，请检查网站是否正常运行');
    } else if (yesterdayPv > 100) {
      insights.push(`🔥 昨日流量较高（${yesterdayPv} PV），可以看看是否有内容破圈`);
    }

    if (pendingMembers.length > 0) {
      insights.push(`💰 有 ${pendingMembers.length} 个待开通会员，请尽快处理`);
    }

    const topCity = topCities[0];
    if (topCity) {
      insights.push(`📍 最热门城市筛选：${topCity.city}（${topCity.count} 次），可以优先补充该城市公司数据`);
    }

    const topCompany = topCompanies[0];
    if (topCompany) {
      insights.push(`🏢 最受关注公司：${topCompany.company}（${topCompany.count} 次点击）`);
    }

    if (totalPaywallViews > 0 && pendingMembers.length === 0) {
      insights.push(`💡 付费墙已触发 ${totalPaywallViews} 次但无付款，考虑优化会员文案或降低首次触发门槛`);
    }

    if (aiYesterday > 10) {
      insights.push(`🤖 昨日 AI 问答 ${aiYesterday} 次，用户活跃度不错`);
    }

    // ---- 近 7 天每日 PV 趋势 ----
    const last7Days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const pv = dailyEvents.filter(e => e.day === d && e.event_name === 'page_view').reduce((s, e) => s + e.count, 0);
      last7Days.push(`<td style="text-align:center;padding:6px 10px;">${d.slice(5)}</td><td style="text-align:center;padding:6px 10px;font-weight:600;">${pv}</td>`);
    }

    // ---- 组装 HTML 邮件 ----
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, sans-serif; background: #f5f7fa; margin: 0; padding: 20px; }
  .card { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  h1 { font-size: 20px; margin: 0 0 4px; color: #1a202c; }
  h2 { font-size: 15px; margin: 0 0 14px; color: #4a5568; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
  .stat-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
  .stat { background: #f7fafc; border-radius: 8px; padding: 12px 18px; min-width: 100px; }
  .stat-label { font-size: 11px; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-value { font-size: 26px; font-weight: 700; color: #2d3748; }
  .stat-sub { font-size: 11px; color: #a0aec0; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 6px 10px; color: #718096; font-weight: 500; border-bottom: 1px solid #e2e8f0; }
  td { padding: 7px 10px; color: #2d3748; border-bottom: 1px solid #f0f0f0; }
  .insight { padding: 8px 12px; border-left: 3px solid #4299e1; background: #ebf8ff; border-radius: 0 6px 6px 0; margin-bottom: 8px; font-size: 13px; color: #2b6cb0; }
  .urgent { border-left-color: #e53e3e; background: #fff5f5; color: #c53030; }
  .member-row { background: #fffbeb; }
</style></head>
<body>
<div style="max-width:680px;margin:0 auto;">

  <div class="card">
    <h1>⚡ 外企雷达日报</h1>
    <p style="color:#718096;font-size:13px;margin:0;">生成时间：${today} 09:00 · waiqida.cn</p>
  </div>

  ${insights.length > 0 ? `
  <div class="card">
    <h2>🔍 今日重点</h2>
    ${insights.map(i => `<div class="insight${i.includes('待开通') || i.includes('⚠️') ? ' urgent' : ''}">${i}</div>`).join('')}
  </div>` : ''}

  ${pendingMembers.length > 0 ? `
  <div class="card">
    <h2>💰 待开通会员（${pendingMembers.length} 人）</h2>
    <table>
      <tr><th>时间</th><th>联系方式</th><th>备注</th></tr>
      ${pendingMembers.slice(0, 10).map(f => `
        <tr class="member-row">
          <td>${fmt(f.created_at)}</td>
          <td><strong>${f.contact || '—'}</strong></td>
          <td>${f.message?.slice(0, 80) ?? ''}</td>
        </tr>`).join('')}
    </table>
  </div>` : '<div class="card"><h2>💰 待开通会员</h2><p style="color:#a0aec0;font-size:13px;">暂无待处理。</p></div>'}

  <div class="card">
    <h2>📊 核心指标（累计）</h2>
    <div class="stat-grid">
      <div class="stat"><div class="stat-label">昨日 PV</div><div class="stat-value">${yesterdayPv}</div><div class="stat-sub">${pvTrend}</div></div>
      <div class="stat"><div class="stat-label">总页面浏览</div><div class="stat-value">${totalPv.toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">招聘链接点击</div><div class="stat-value">${totalCareerClicks.toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">AI 问答（昨日）</div><div class="stat-value">${aiYesterday}</div><div class="stat-sub">累计 ${totalAiSubmits}</div></div>
      <div class="stat"><div class="stat-label">注册用户</div><div class="stat-value">${totalUsers}</div><div class="stat-sub">近7天新增 ${newUsersThisWeek}</div></div>
      <div class="stat"><div class="stat-label">付费墙触发</div><div class="stat-value">${totalPaywallViews}</div><div class="stat-sub">付款转化 ${conversionRate}%</div></div>
    </div>
  </div>

  <div class="card">
    <h2>📅 近 7 天每日 PV</h2>
    <table>
      <tr>${last7Days.map((_, i) => i % 2 === 0 ? '<th>日期</th><th>PV</th>' : '').join('')}</tr>
      <tr>${last7Days.join('')}</tr>
    </table>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
    <div class="card">
      <h2>🏢 最多点击公司 Top 10</h2>
      <table>
        <tr><th>公司</th><th>点击</th></tr>
        ${topCompanies.map(r => `<tr><td>${r.company ?? '—'}</td><td>${r.count}</td></tr>`).join('')}
      </table>
    </div>
    <div class="card">
      <h2>📍 最多筛选城市 Top 10</h2>
      <table>
        <tr><th>城市</th><th>次数</th></tr>
        ${topCities.map(r => `<tr><td>${r.city ?? '—'}</td><td>${r.count}</td></tr>`).join('')}
      </table>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
    <div class="card">
      <h2>🔗 招聘链接点击 Top 10</h2>
      <table>
        <tr><th>公司</th><th>次数</th></tr>
        ${topCareerLinks.map(r => `<tr><td>${r.company ?? '—'}</td><td>${r.count}</td></tr>`).join('')}
      </table>
    </div>
    <div class="card">
      <h2>🗺️ 最多筛选地区 Top 10</h2>
      <table>
        <tr><th>地区</th><th>次数</th></tr>
        ${topRegions.map(r => `<tr><td>${r.region ?? '—'}</td><td>${r.count}</td></tr>`).join('')}
      </table>
    </div>
  </div>

  <div style="text-align:center;padding:16px;color:#a0aec0;font-size:12px;">
    外企雷达自动日报 · <a href="https://waiqida.cn/admin.html" style="color:#4299e1;">打开后台</a>
  </div>
</div>
</body>
</html>`;

    await sendEmail(
      env.RESEND_API_KEY,
      env.REPORT_EMAIL,
      `外企雷达日报 ${today}${pendingMembers.length > 0 ? ` 🔔 ${pendingMembers.length} 个待开通会员` : ''}`,
      html,
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/trigger' && request.method === 'GET') {
      const token = url.searchParams.get('token');
      if (!token || token !== env.ADMIN_PASSWORD) {
        return new Response('unauthorized', { status: 401 });
      }
      await this.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);
      return new Response('日报已发送，请查收邮件', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  },
};
