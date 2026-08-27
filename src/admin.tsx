import { useEffect, useState, useCallback } from 'react';

type EventCount = { event_name: string; count: number };
type TopItem = { company?: string; city?: string; region?: string; target_url?: string; count: number };
type HighIntent = { count: number };
type User = { id: number; phone: string; created_at: string; last_login_at: string | null };
type UserIntent = { created_at: string; phone: string; intent: string; company: string; city: string };
type Feedback = { id: number; feature_needs: string; target_city: string; contact: string; message: string; created_at: string };
type MemberResult = { ok: boolean; message?: string; error?: string };
type DailyEvent = { day: string; event_name: string; count: number };
type Subscription = { subscription_type: string; value: string; count: number };

type AdminData = {
  ok: boolean;
  generatedAt: string;
  eventCounts: EventCount[];
  topCompanies: TopItem[];
  topCities: TopItem[];
  topRegions: TopItem[];
  topCareerLinks: TopItem[];
  highIntentSessions: HighIntent[];
  recentUsers: User[];
  recentUserIntents: UserIntent[];
  recentFeedback: Feedback[];
  dailyEvents: DailyEvent[];
  topSubscriptions: Subscription[];
};

const STORAGE_KEY = 'admin_token_v1';

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ background: '#1a1f2e', borderRadius: 10, padding: '16px 20px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: '#7b8494', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#e2e8f0' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#7b8494', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Table({ heads, rows }: { heads: string[]; rows: (string | number)[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>{heads.map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#7b8494', borderBottom: '1px solid #2d3447', fontWeight: 500 }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #1e2537' }}>
            {row.map((cell, j) => <td key={j} style={{ padding: '7px 10px', color: '#c9d1e0' }}>{cell}</td>)}
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={heads.length} style={{ padding: '12px 10px', color: '#4a5568', textAlign: 'center' }}>暂无数据</td></tr>}
      </tbody>
    </table>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#111827', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 14, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h3>
      {children}
    </div>
  );
}

export default function Admin() {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const [input, setInput] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [memberResults, setMemberResults] = useState<Record<string, string>>({});

  async function load(t: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/summary', {
        headers: { authorization: `Bearer ${t}`, 'x-fr-client': 'web-app' },
      });
      const json = await res.json() as AdminData;
      if (!json.ok) { setError('密码错误或未配置'); setLoading(false); return; }
      setData(json);
      setToken(t);
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      setError('请求失败，请检查网络');
    }
    setLoading(false);
  }

  useEffect(() => { if (token) load(token); }, []); // eslint-disable-line

  const grantMember = useCallback(async (phone: string, months = 1) => {
    setMemberResults(prev => ({ ...prev, [phone]: '开通中…' }));
    try {
      const res = await fetch('/api/admin/set-member', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-fr-client': 'web-app' },
        body: JSON.stringify({ phone, months }),
      });
      const json = await res.json() as MemberResult;
      setMemberResults(prev => ({ ...prev, [phone]: json.message ?? json.error ?? '完成' }));
    } catch {
      setMemberResults(prev => ({ ...prev, [phone]: '请求失败' }));
    }
  }, [token]);

  // ---- 登录界面 ----
  if (!data) {
    return (
      <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#111827', borderRadius: 14, padding: '40px 48px', width: 360, textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🛡️</div>
          <h2 style={{ margin: '0 0 24px', color: '#e2e8f0', fontSize: 20 }}>外企雷达后台</h2>
          <input
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(input)}
            placeholder="管理员密码"
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #2d3447', background: '#1a1f2e', color: '#e2e8f0', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
          />
          <button
            onClick={() => load(input)}
            disabled={loading}
            style={{ width: '100%', padding: '10px', borderRadius: 8, background: '#3b82f6', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            {loading ? '登录中…' : '进入后台'}
          </button>
          {error && <p style={{ color: '#f87171', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      </div>
    );
  }

  // ---- 统计摘要 ----
  const totalEvents = data.eventCounts.reduce((s, e) => s + e.count, 0);
  const pageViews = data.eventCounts.find(e => e.event_name === 'page_view')?.count ?? 0;
  const careerClicks = data.eventCounts.find(e => e.event_name === 'career_link_click')?.count ?? 0;
  const paywallViews = data.eventCounts.find(e => e.event_name === 'member_paywall_view')?.count ?? 0;
  const highIntent = data.highIntentSessions[0]?.count ?? 0;

  // 过去 14 天每日 PV
  const dailyPv: Record<string, number> = {};
  data.dailyEvents.forEach(e => {
    if (e.event_name === 'page_view') dailyPv[e.day] = (dailyPv[e.day] ?? 0) + e.count;
  });
  const pvDays = Object.entries(dailyPv).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);

  // 付款提交 feedback
  const payFeedback = data.recentFeedback.filter(f => f.message?.includes('会员'));

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', padding: '24px 32px' }}>
      {/* 顶部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>外企雷达 · 后台</h1>
          <span style={{ fontSize: 12, color: '#4a5568' }}>更新于 {fmt(data.generatedAt)}</span>
        </div>
        <button onClick={() => { setData(null); setToken(''); localStorage.removeItem(STORAGE_KEY); }}
          style={{ padding: '6px 14px', borderRadius: 8, background: '#1a1f2e', color: '#94a3b8', border: '1px solid #2d3447', cursor: 'pointer', fontSize: 13 }}>
          退出
        </button>
      </div>

      {/* 核心指标 */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard label="总事件数" value={totalEvents.toLocaleString()} />
        <StatCard label="页面浏览" value={pageViews.toLocaleString()} />
        <StatCard label="招聘链接点击" value={careerClicks.toLocaleString()} />
        <StatCard label="付费墙触发" value={paywallViews.toLocaleString()} />
        <StatCard label="高意向会话" value={highIntent} sub="筛选+点击+招聘链接" />
        <StatCard label="注册用户" value={data.recentUsers.length > 0 ? `${data.recentUsers[data.recentUsers.length - 1]?.id ?? '?'}+` : '0'} />
        <StatCard label="付款提交" value={payFeedback.length} sub="待人工开通" />
      </div>

      {/* 近 7 天 PV 趋势 */}
      <Section title="近 7 天每日页面浏览">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 80 }}>
          {pvDays.length === 0 && <span style={{ color: '#4a5568', fontSize: 13 }}>暂无数据</span>}
          {pvDays.map(([day, cnt]) => {
            const max = Math.max(...pvDays.map(d => d[1]), 1);
            const h = Math.max(8, Math.round((cnt / max) * 72));
            return (
              <div key={day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{cnt}</span>
                <div style={{ width: '100%', height: h, background: '#3b82f6', borderRadius: 4, opacity: 0.85 }} />
                <span style={{ fontSize: 10, color: '#4a5568' }}>{day.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 热门公司 */}
        <Section title="最多点击公司 Top 10">
          <Table
            heads={['公司', '点击']}
            rows={data.topCompanies.slice(0, 10).map(r => [r.company ?? '—', r.count])}
          />
        </Section>

        {/* 热门城市 */}
        <Section title="最多筛选城市 Top 10">
          <Table
            heads={['城市', '次数']}
            rows={data.topCities.slice(0, 10).map(r => [r.city ?? '—', r.count])}
          />
        </Section>

        {/* 热门招聘链接 */}
        <Section title="招聘链接点击 Top 10">
          <Table
            heads={['公司', '次数']}
            rows={data.topCareerLinks.slice(0, 10).map(r => [r.company ?? '—', r.count])}
          />
        </Section>

        {/* 事件总览 */}
        <Section title="所有事件类型">
          <Table
            heads={['事件', '总计']}
            rows={data.eventCounts.slice(0, 15).map(r => [r.event_name, r.count])}
          />
        </Section>
      </div>

      {/* 付款待处理 */}
      {payFeedback.length > 0 && (
        <Section title={`💰 待开通会员 (${payFeedback.length})`}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['时间', '联系方式', '备注', '操作'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#7b8494', borderBottom: '1px solid #2d3447', fontWeight: 500 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {payFeedback.map((r, i) => {
                const phone = r.contact?.match(/^1[3-9]\d{9}$/)?.[0] ?? r.contact;
                const result = memberResults[phone];
                const isDone = result && result.includes('已为');
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #1e2537' }}>
                    <td style={{ padding: '7px 10px', color: '#c9d1e0' }}>{fmt(r.created_at)}</td>
                    <td style={{ padding: '7px 10px', color: '#c9d1e0' }}><strong>{r.contact || '—'}</strong></td>
                    <td style={{ padding: '7px 10px', color: '#c9d1e0' }}>{r.message?.slice(0, 60) ?? ''}</td>
                    <td style={{ padding: '7px 10px' }}>
                      {result ? (
                        <span style={{ fontSize: 12, color: isDone ? '#68d391' : '#f6ad55' }}>{result}</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => grantMember(phone, 1)}
                            style={{ padding: '4px 10px', borderRadius: 6, background: '#3b82f6', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                          >开通 1 个月</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}

      {/* 最近注册用户 */}
      <Section title="最近注册用户">
        <Table
          heads={['ID', '手机号', '注册时间', '最后登录']}
          rows={data.recentUsers.slice(0, 15).map(r => [r.id, r.phone, fmt(r.created_at), fmt(r.last_login_at)])}
        />
      </Section>

      {/* 用户操作记录 */}
      <Section title="最近用户投递行为">
        <Table
          heads={['时间', '手机号', '操作', '公司', '城市']}
          rows={data.recentUserIntents.slice(0, 15).map(r => [fmt(r.created_at), r.phone, r.intent, r.company, r.city ?? '—'])}
        />
      </Section>

      {/* 所有反馈 */}
      <Section title="最近用户反馈">
        <Table
          heads={['时间', '联系', '需求', '留言']}
          rows={data.recentFeedback.slice(0, 15).map(r => [fmt(r.created_at), r.contact || '—', r.feature_needs?.slice(0, 20) ?? '', r.message?.slice(0, 50) ?? ''])}
        />
      </Section>

      {/* 订阅分布 */}
      {data.topSubscriptions.length > 0 && (
        <Section title="订阅分布">
          <Table
            heads={['类型', '值', '人数']}
            rows={data.topSubscriptions.map(r => [r.subscription_type, r.value, r.count])}
          />
        </Section>
      )}
    </div>
  );
}
