import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { loadCompanies } from './lib/csv';
import { currentAnalyticsContext, trackEvent } from './lib/analytics';
import { chinaRegions, companyMatchesRegion, jobMatchesRegion, topCitiesForRegion } from './lib/locations';
import type { Company, JobFeed } from './types';

const benefitFilters = ['五险一金', '商业保险', '补充', '股票', '混合办公', '员工折扣', '奖金', '培训'];
const quickSearches = ['宠物', '家具', '半导体', '补充', '股票'];
const popularCities = ['上海', '北京', '苏州', '大连', '成都', '武汉', '南京', '杭州', '长沙', '郑州'];
const subscriptionCityOptions = ['上海', '苏州', '大连', '长沙'];
const subscriptionCompanyOptions = ['SAP', 'Nike', 'IKEA'];
const subscriptionKeywordOptions = ['财务', '供应链', '产品', '管培生'];
const feedbackOptions = ['更多城市外企名单', '实时岗位更新', '福利待遇和年假信息', '外包/正式合同识别', '简历和面试经验', '按岗位推荐公司'];

type AdminRow = Record<string, string | number | null>;
type JobSummaryItem = { company: string; status: string; count: number; updatedAt: string | null };

type AdminSummary = {
  generatedAt: string;
  eventCounts: AdminRow[];
  topCompanies: AdminRow[];
  topCities: AdminRow[];
  topRegions: AdminRow[];
  topCareerLinks: AdminRow[];
  topSavedCompanies: AdminRow[];
  topAppliedCompanies: AdminRow[];
  highIntentSessions: AdminRow[];
  recentUsers: AdminRow[];
  recentUserIntents: AdminRow[];
  recentFeedback: AdminRow[];
  dailyEvents: AdminRow[];
  jobSources: AdminRow[];
  jobCityCounts: AdminRow[];
  topSubscriptions: AdminRow[];
};

const intentMeta = {
  applied: { eventName: 'company_applied_click', label: '我已投递' },
  saved: { eventName: 'company_saved_click', label: '收藏' },
  later: { eventName: 'company_later_click', label: '稍后投' },
} as const;

type CompanyIntent = keyof typeof intentMeta;

type AuthUser = { id: number; phone: string };
type ProfileIntent = { intent: CompanyIntent; company: string; city: string | null; created_at: string };
type UserSubscription = { subscription_type: 'city' | 'company' | 'keyword'; value: string; created_at: string };
type WatchedJob = { job_key: string; company: string; title: string; city: string | null; location: string | null; source_platform: string | null; source_url: string; scraped_at: string };
type UserProfile = { user: AuthUser; intents: ProfileIntent[]; stats: AdminRow[]; subscriptions: UserSubscription[]; watchedJobs: WatchedJob[]; generatedAt: string };

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function passwordHint(): string {
  return '密码 8-20 位，需包含字母和数字，不能使用手机号或常见弱密码。';
}

function splitWords(value: string): string[] {
  return value.split(';').map((item) => item.trim()).filter(Boolean);
}

function initials(value: string): string {
  return value.split(/\s+/).map((item) => item[0]).join('').slice(0, 2).toUpperCase();
}

function colorFor(value: string): string {
  const colors = ['#172033', '#0f766e', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#365314'];
  let seed = 0;
  for (const char of value) seed += char.charCodeAt(0);
  return colors[seed % colors.length];
}

function companyText(company: Company): string {
  return Object.values(company).flat().join(' ').toLowerCase();
}

function splitRecruitingUrls(value: string): string[] {
  return value.split(';').map((item) => item.trim()).filter(Boolean);
}

function linkLabel(url: string, index: number): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return index === 0 ? `主入口 · ${host}` : `备用入口 · ${host}`;
  } catch {
    return index === 0 ? '主入口' : '备用入口';
  }
}

function MePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [subscriptionCities, setSubscriptionCities] = useState<Set<string>>(new Set(subscriptionCityOptions));
  const [subscriptionCompanies, setSubscriptionCompanies] = useState<Set<string>>(new Set(subscriptionCompanyOptions));
  const [subscriptionKeywords, setSubscriptionKeywords] = useState<Set<string>>(new Set(subscriptionKeywordOptions));
  const [subscriptionStatus, setSubscriptionStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  async function loadProfile(token = localStorage.getItem('foreignRadarAuthToken')) {
    if (!token) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      const response = await fetch('/api/user/profile', { headers: { authorization: `Bearer ${token}` } });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'profile-failed');
      setProfile(payload);
      const nextCities = new Set<string>((payload.subscriptions ?? []).filter((item: UserSubscription) => item.subscription_type === 'city').map((item: UserSubscription) => item.value));
      const nextCompanies = new Set<string>((payload.subscriptions ?? []).filter((item: UserSubscription) => item.subscription_type === 'company').map((item: UserSubscription) => item.value));
      const nextKeywords = new Set<string>((payload.subscriptions ?? []).filter((item: UserSubscription) => item.subscription_type === 'keyword').map((item: UserSubscription) => item.value));
      setSubscriptionCities(nextCities.size ? nextCities : new Set(subscriptionCityOptions));
      setSubscriptionCompanies(nextCompanies.size ? nextCompanies : new Set(subscriptionCompanyOptions));
      setSubscriptionKeywords(nextKeywords.size ? nextKeywords : new Set(subscriptionKeywordOptions));
      setStatus('ready');
      setMessage('');
    } catch {
      localStorage.removeItem('foreignRadarAuthToken');
      setProfile(null);
      setStatus('error');
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  async function submitMeAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, password, ...currentAnalyticsContext() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'auth-failed');
      localStorage.setItem('foreignRadarAuthToken', payload.token);
      setPassword('');
      await loadProfile(payload.token);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setStatus('error');
      if (code === 'phone-exists') setMessage('这个手机号已经注册过，请切换到登录。');
      else if (code === 'invalid-password') setMessage(passwordHint());
      else if (code === 'invalid-phone') setMessage('请输入 11 位中国大陆手机号。');
      else setMessage('登录或注册失败，请检查手机号和密码。');
    }
  }

  function logoutMe() {
    localStorage.removeItem('foreignRadarAuthToken');
    setProfile(null);
    setStatus('error');
  }

  const grouped = {
    saved: profile?.intents.filter((item) => item.intent === 'saved') ?? [],
    later: profile?.intents.filter((item) => item.intent === 'later') ?? [],
    applied: profile?.intents.filter((item) => item.intent === 'applied') ?? [],
  };

  function toggleSubscription(type: 'city' | 'company' | 'keyword', value: string) {
    const setter = type === 'city' ? setSubscriptionCities : type === 'company' ? setSubscriptionCompanies : setSubscriptionKeywords;
    setter((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function saveSubscriptions() {
    const token = localStorage.getItem('foreignRadarAuthToken');
    if (!token) return;
    setSubscriptionStatus('saving');
    try {
      const response = await fetch('/api/user/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          cities: [...subscriptionCities],
          companies: [...subscriptionCompanies],
          keywords: [...subscriptionKeywords],
        }),
      });
      if (!response.ok) throw new Error('save-failed');
      trackEvent('subscription_save');
      setSubscriptionStatus('success');
      await loadProfile(token);
    } catch {
      setSubscriptionStatus('error');
    }
  }

  return (
    <main className="mePage">
      <header className="meHeader panel">
        <div>
          <div className="eyebrow">MY RADAR</div>
          <h1>我的外企投递清单</h1>
          <p>{profile ? `${maskPhone(profile.user.phone)} · 已保存 ${profile.intents.length} 条求职记录` : '登录后查看收藏、稍后投和已投递公司。'}</p>
        </div>
        <div className="meHeaderActions">
          <button className="ghostButton" onClick={() => { window.location.href = '/'; }}>返回首页</button>
          {profile ? <button className="ghostButton" onClick={logoutMe}>退出登录</button> : null}
        </div>
      </header>

      {profile ? (
        <>
          <section className="meStats">
            <div className="panel adminStat"><strong>{grouped.saved.length}</strong><span>收藏公司</span></div>
            <div className="panel adminStat"><strong>{grouped.later.length}</strong><span>稍后投</span></div>
            <div className="panel adminStat"><strong>{grouped.applied.length}</strong><span>已投递</span></div>
          </section>
          <section className="panel subscriptionPanel">
            <div className="sectionHead">
              <div>
                <div className="eyebrow">JOB SUBSCRIPTION</div>
                <h2>岗位订阅</h2>
              </div>
              <button className="primaryButton" onClick={saveSubscriptions} disabled={subscriptionStatus === 'saving'}>{subscriptionStatus === 'saving' ? '保存中' : '保存订阅'}</button>
            </div>
            <SubscriptionPicker title="关注城市" options={subscriptionCityOptions} selected={subscriptionCities} onToggle={(value) => toggleSubscription('city', value)} />
            <SubscriptionPicker title="关注公司" options={subscriptionCompanyOptions} selected={subscriptionCompanies} onToggle={(value) => toggleSubscription('company', value)} />
            <SubscriptionPicker title="岗位关键词" options={subscriptionKeywordOptions} selected={subscriptionKeywords} onToggle={(value) => toggleSubscription('keyword', value)} />
            {subscriptionStatus === 'success' ? <span className="inlineSuccess">已保存，会在这里汇总你关注的岗位更新。</span> : null}
            {subscriptionStatus === 'error' ? <span className="leadMessage error">订阅保存失败，请稍后再试。</span> : null}
          </section>
          <section className="panel watchedJobsPanel">
            <div className="sectionHead">
              <div>
                <div className="eyebrow">WATCHED JOBS</div>
                <h2>你关注的岗位更新</h2>
              </div>
              <span>{profile.watchedJobs.length} 条</span>
            </div>
            {profile.watchedJobs.length ? profile.watchedJobs.slice(0, 12).map((job) => (
              <a className="watchedJobItem" href={job.source_url} target="_blank" rel="noreferrer" key={job.job_key}>
                <strong>{job.title}</strong>
                <span>{job.company} · {job.city || job.location || '地点待确认'} · {job.source_platform || 'Company Careers'}</span>
              </a>
            )) : <p>保存订阅后，这里会显示匹配到的岗位。当前岗位池还在扩充中。</p>}
          </section>
          <section className="meGrid">
            <IntentList title="收藏的外企" rows={grouped.saved} empty="还没有收藏公司。" />
            <IntentList title="稍后投" rows={grouped.later} empty="还没有稍后投公司。" />
            <IntentList title="已投递" rows={grouped.applied} empty="还没有已投递记录。" />
          </section>
          <p className="adminUpdated">更新时间：{new Date(profile.generatedAt).toLocaleString('zh-CN')}</p>
        </>
      ) : (
        <section className="panel meAuthPanel">
          <h2>{authMode === 'login' ? '登录账号' : '注册账号'}</h2>
          <p>注册后可以跨设备保存收藏、稍后投和已投递公司。</p>
          <form className="meAuthForm" onSubmit={submitMeAuth}>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="手机号" inputMode="tel" />
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder={authMode === 'register' ? passwordHint() : '输入密码'} type="password" />
            <div className="leadActions">
              <button className="primaryButton" type="submit" disabled={status === 'loading'}>{status === 'loading' ? '处理中' : authMode === 'login' ? '登录' : '注册'}</button>
              <button className="ghostButton" type="button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? '没有账号，去注册' : '已有账号，去登录'}</button>
            </div>
            {message ? <span className="leadMessage error">{message}</span> : null}
          </form>
        </section>
      )}
    </main>
  );
}

function IntentList({ title, rows, empty }: { title: string; rows: ProfileIntent[]; empty: string }) {
  return (
    <section className="panel intentList">
      <h2>{title}</h2>
      {rows.length ? rows.map((row, index) => (
        <div key={`${row.intent}-${row.company}-${row.created_at}-${index}`} className="intentItem">
          <strong>{row.company}</strong>
          <span>{row.city || '城市待补充'} · {new Date(row.created_at).toLocaleString('zh-CN')}</span>
        </div>
      )) : <p>{empty}</p>}
    </section>
  );
}

function SubscriptionPicker({ title, options, selected, onToggle }: { title: string; options: string[]; selected: Set<string>; onToggle: (value: string) => void }) {
  return (
    <div className="subscriptionGroup">
      <strong>{title}</strong>
      <div>
        {options.map((option) => (
          <button type="button" className={selected.has(option) ? 'active' : ''} onClick={() => onToggle(option)} key={option}>{option}</button>
        ))}
      </div>
    </div>
  );
}

function AdminDashboard() {
  const [password, setPassword] = useState(() => localStorage.getItem('foreignRadarAdminPassword') ?? '');
  const [data, setData] = useState<AdminSummary | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');

  async function loadAdminData(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!password.trim()) {
      setError('请输入管理员密码。');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setError('');
    try {
      const response = await fetch('/api/admin/summary', {
        headers: { authorization: `Bearer ${password.trim()}` },
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'load-failed');
      localStorage.setItem('foreignRadarAdminPassword', password.trim());
      setData(payload);
      setStatus('ready');
    } catch (adminError) {
      setData(null);
      setStatus('error');
      setError(adminError instanceof Error && adminError.message === 'unauthorized' ? '密码不正确。' : '数据加载失败，请稍后再试。');
    }
  }

  useEffect(() => {
    if (password) loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalEvents = data?.eventCounts.reduce((sum, row) => sum + Number(row.count ?? 0), 0) ?? 0;

  return (
    <main className="adminPage">
      <section className="adminHero">
        <div>
          <div className="eyebrow">ADMIN DASHBOARD</div>
          <h1>外企雷达数据后台</h1>
          <p>查看用户反馈、热门城市、热门公司、招聘入口点击和最近事件趋势。</p>
        </div>
        <form className="adminLogin" onSubmit={loadAdminData}>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="管理员密码" />
          <button className="primaryButton" type="submit" disabled={status === 'loading'}>{status === 'loading' ? '加载中' : '刷新数据'}</button>
          {error ? <span>{error}</span> : null}
        </form>
      </section>

      {data ? (
        <>
          <section className="adminStats">
            <div className="panel adminStat"><strong>{totalEvents}</strong><span>累计事件</span></div>
            <div className="panel adminStat"><strong>{data.recentFeedback.length}</strong><span>最近反馈</span></div>
            <div className="panel adminStat"><strong>{data.topCompanies.length}</strong><span>被点击公司</span></div>
            <div className="panel adminStat"><strong>{data.topCities.length}</strong><span>被查询城市</span></div>
          </section>

          <section className="adminGrid">
            <AdminTable title="用户反馈" rows={data.recentFeedback} columns={['created_at', 'feature_needs', 'target_city', 'target_role', 'contact', 'message']} empty="还没有用户反馈。" />
            <AdminTable title="热门城市" rows={data.topCities} columns={['city', 'count']} empty="还没有城市点击。" />
            <AdminTable title="热门公司" rows={data.topCompanies} columns={['company', 'count']} empty="还没有公司点击。" />
            <AdminTable title="地区筛选" rows={data.topRegions} columns={['region', 'count']} empty="还没有地区点击。" />
            <AdminTable title="招聘入口点击排行榜" rows={data.topCareerLinks} columns={['company', 'target_url', 'count']} empty="还没有招聘入口点击。" />
            <AdminTable title="岗位抓取来源" rows={data.jobSources} columns={['company', 'source_platform', 'scope', 'status', 'last_success_at', 'last_job_count', 'last_error']} empty="还没有岗位抓取来源。" />
            <AdminTable title="岗位城市分布" rows={data.jobCityCounts} columns={['company', 'city', 'count']} empty="还没有岗位城市数据。" />
            <AdminTable title="订阅排行榜" rows={data.topSubscriptions} columns={['subscription_type', 'value', 'count']} empty="还没有用户订阅。" />
            <AdminTable title="收藏排行榜" rows={data.topSavedCompanies} columns={['company', 'count']} empty="还没有收藏点击。" />
            <AdminTable title="已投递排行榜" rows={data.topAppliedCompanies} columns={['company', 'count']} empty="还没有已投递点击。" />
            <AdminTable title="注册用户" rows={data.recentUsers} columns={['id', 'phone', 'created_at', 'last_login_at']} empty="还没有注册用户。" />
            <AdminTable title="用户投递清单动作" rows={data.recentUserIntents} columns={['created_at', 'phone', 'intent', 'company', 'city']} empty="还没有账号绑定的投递动作。" />
            <AdminTable title="高意向 session 数" rows={data.highIntentSessions} columns={['count']} empty="还没有高意向 session。" />
            <AdminTable title="事件总览" rows={data.eventCounts} columns={['event_name', 'count']} empty="还没有事件。" />
            <AdminTable title="最近 14 天事件" rows={data.dailyEvents} columns={['day', 'event_name', 'count']} empty="还没有趋势数据。" />
          </section>
          <p className="adminUpdated">更新时间：{new Date(data.generatedAt).toLocaleString('zh-CN')}</p>
        </>
      ) : null}
    </main>
  );
}

function AdminTable({ title, rows, columns, empty }: { title: string; rows: AdminRow[]; columns: string[]; empty: string }) {
  return (
    <section className="panel adminTableCard">
      <h2>{title}</h2>
      {rows.length > 0 ? (
        <div className="adminTableWrap">
          <table>
            <thead>
              <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${title}-${index}`}>
                  {columns.map((column) => <td key={column}>{row[column] ?? '-'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p>{empty}</p>}
    </section>
  );
}

export default function App() {
  if (window.location.pathname === '/admin') return <AdminDashboard />;
  if (window.location.pathname === '/me') return <MePage />;

  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState('全部');
  const [benefits, setBenefits] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Company | null>(null);
  const [selectedJobs, setSelectedJobs] = useState<JobFeed | null>(null);
  const [selectedJobsStatus, setSelectedJobsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [sortBy, setSortBy] = useState('company');
  const [error, setError] = useState<string | null>(null);
  const [sapJobs, setSapJobs] = useState<JobFeed | null>(null);
  const [jobSummary, setJobSummary] = useState<Record<string, JobSummaryItem>>({});
  const [selectedRegion, setSelectedRegion] = useState('全部');
  const [selectedRegionCity, setSelectedRegionCity] = useState<string | null>(null);
  const [cityQuery, setCityQuery] = useState('');
  const [wechatOpen, setWechatOpen] = useState(false);
  const [feedbackNeeds, setFeedbackNeeds] = useState<Set<string>>(new Set());
  const [feedbackCity, setFeedbackCity] = useState('');
  const [feedbackRole, setFeedbackRole] = useState('');
  const [feedbackContact, setFeedbackContact] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authPhone, setAuthPhone] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authStatus, setAuthStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [authMessage, setAuthMessage] = useState('');
  const [pendingIntent, setPendingIntent] = useState<{ intent: CompanyIntent; company: Company } | null>(null);

  useEffect(() => {
    loadCompanies().then(setCompanies).catch(() => setError('公司数据加载失败，请检查 CSV 文件。'));
    fetch('/api/job-summary')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { companies?: JobSummaryItem[] } | null) => {
        const next = Object.fromEntries((payload?.companies ?? []).map((item) => [item.company, item]));
        setJobSummary(next);
      })
      .catch(() => setJobSummary({}));

    fetch('/api/jobs?company=SAP')
      .then((response) => (response.ok ? response.json() : null))
      .then((feed: (JobFeed & { ok?: boolean }) | null) => {
        if (feed?.jobs?.length) return setSapJobs(feed);
        return fetch('/jobs/sap-china.json')
          .then((response) => (response.ok ? response.json() : null))
          .then((fallback: JobFeed | null) => setSapJobs(fallback));
      })
      .catch(() => fetch('/jobs/sap-china.json')
        .then((response) => (response.ok ? response.json() : null))
        .then((feed: JobFeed | null) => setSapJobs(feed))
        .catch(() => setSapJobs(null)));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('foreignRadarAuthToken');
    if (!token) return;
    fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.ok) setAuthUser(payload.user);
        else localStorage.removeItem('foreignRadarAuthToken');
      })
      .catch(() => undefined);
  }, []);

  const industries = useMemo(() => [...new Set(companies.map((company) => company.industry))].sort(), [companies]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return companies
      .filter((company) => industry === '全部' || company.industry === industry)
      .filter((company) => selectedRegion === '全部' || companyMatchesRegion(company, selectedRegion))
      .filter((company) => [...benefits].every((benefit) => company.benefitOrFilterTags.includes(benefit)))
      .filter((company) => !normalized || companyText(company).includes(normalized))
      .sort((a, b) => {
        if (sortBy === 'industry') return a.industry.localeCompare(b.industry, 'zh-Hans-CN');
        if (sortBy === 'city') return a.primaryChinaCityFocus.localeCompare(b.primaryChinaCityFocus, 'zh-Hans-CN');
        return a.company.localeCompare(b.company, 'en');
      });
  }, [companies, industry, benefits, query, selectedRegion, sortBy]);

  const topIndustries = useMemo(() => {
    const counts = new Map<string, number>();
    companies.forEach((company) => counts.set(company.industry, (counts.get(company.industry) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [companies]);

  const maxIndustryCount = topIndustries[0]?.[1] ?? 1;

  const regionStats = useMemo(() => chinaRegions.map((region) => {
    const companyCount = companies.filter((company) => companyMatchesRegion(company, region.id)).length;
    const jobCount = sapJobs?.jobs.filter((job) => jobMatchesRegion(job, region.id)).length ?? 0;
    return {
      ...region,
      companyCount,
      jobCount,
      total: companyCount + jobCount,
      topCities: topCitiesForRegion(companies, sapJobs?.jobs ?? [], region.id).slice(0, 5),
    };
  }), [companies, sapJobs]);

  const maxRegionTotal = Math.max(1, ...regionStats.map((region) => region.total));
  const cityAnswerCompanies = useMemo(() => {
    const city = cityQuery.trim();
    if (!city) return [];
    return companies.filter((company) => company.primaryChinaCityFocus.includes(city));
  }, [cityQuery, companies]);

  const cityAnswerIndustries = useMemo(() => {
    const counts = new Map<string, number>();
    cityAnswerCompanies.forEach((company) => counts.set(company.industry, (counts.get(company.industry) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [cityAnswerCompanies]);

  const activeRegion = regionStats.find((region) => region.id === selectedRegion) ?? null;
  const selectedJobSummary = selected ? jobSummary[selected.company] : null;
  const activeRegionCompanies = useMemo(() => {
    if (selectedRegion === '全部') return [];
    return companies
      .filter((company) => companyMatchesRegion(company, selectedRegion))
      .filter((company) => !selectedRegionCity || company.primaryChinaCityFocus.includes(selectedRegionCity))
      .slice(0, 20);
  }, [companies, selectedRegion, selectedRegionCity]);

  function selectRegion(regionId: string) {
    setSelectedRegion(regionId);
    setSelectedRegionCity(null);
    if (regionId !== '全部') {
      const region = chinaRegions.find((item) => item.id === regionId);
      trackEvent('region_filter_click', { region: region?.name ?? regionId });
    }
  }

  function toggleBenefit(value: string) {
    setBenefits((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function resetFilters() {
    setIndustry('全部');
    setBenefits(new Set());
    setQuery('');
    selectRegion('全部');
  }

  function searchCity(city: string) {
    setCityQuery(city);
    setQuery(city);
    trackEvent('city_filter_click', { city });
    document.getElementById('city-answer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function loadJobsForCompany(company: Company) {
    setSelectedJobs(null);
    setSelectedJobsStatus('loading');
    try {
      const response = await fetch(`/api/jobs?company=${encodeURIComponent(company.company)}&limit=120`);
      const feed = response.ok ? await response.json() : null;
      if (feed?.jobs?.length) {
        setSelectedJobs(feed);
        setSelectedJobsStatus('ready');
      } else {
        setSelectedJobs(null);
        setSelectedJobsStatus('idle');
      }
    } catch {
      setSelectedJobs(null);
      setSelectedJobsStatus('error');
    }
  }

  function openCompany(company: Company) {
    trackEvent('company_detail_click', { company: company.company });
    setSelected(company);
    void loadJobsForCompany(company);
  }

  function toggleFeedbackNeed(value: string) {
    setFeedbackNeeds((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function saveCompanyIntent(intent: CompanyIntent, company: Company, token = localStorage.getItem('foreignRadarAuthToken')) {
    if (!token) throw new Error('missing-token');
    const response = await fetch('/api/user/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        intent,
        company: company.company,
        city: company.primaryChinaCityFocus,
        ...currentAnalyticsContext(),
      }),
    });
    if (!response.ok) throw new Error('intent-save-failed');
  }

  async function openAuthForIntent(intent: CompanyIntent, company: Company) {
    setPendingIntent({ intent, company });
    setAuthMessage('');
    setAuthStatus('idle');
    if (!authUser) {
      setAuthMode('register');
      setAuthOpen(true);
      return;
    }
    try {
      await saveCompanyIntent(intent, company);
      setAuthMessage(`${intentMeta[intent].label}已保存到你的投递清单。`);
      setAuthStatus('success');
    } catch {
      setAuthOpen(true);
      setAuthStatus('error');
      setAuthMessage('登录状态已过期，请重新登录后保存。');
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthStatus('submitting');
    setAuthMessage('');
    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: authPhone, password: authPassword, ...currentAnalyticsContext() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'auth-failed');
      localStorage.setItem('foreignRadarAuthToken', payload.token);
      setAuthUser(payload.user);
      if (pendingIntent) await saveCompanyIntent(pendingIntent.intent, pendingIntent.company, payload.token);
      setAuthStatus('success');
      setAuthMessage(pendingIntent ? `${intentMeta[pendingIntent.intent].label}已保存到你的投递清单。` : '登录成功。');
      setAuthPassword('');
      setTimeout(() => setAuthOpen(false), 900);
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : '';
      setAuthStatus('error');
      if (message === 'phone-exists') setAuthMessage('这个手机号已经注册过，请切换到登录。');
      else if (message === 'invalid-phone') setAuthMessage('请输入 11 位中国大陆手机号。');
      else if (message === 'invalid-password') setAuthMessage(passwordHint());
      else setAuthMessage('登录或注册失败，请检查手机号和密码。');
    }
  }

  function logout() {
    localStorage.removeItem('foreignRadarAuthToken');
    setAuthUser(null);
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (feedbackNeeds.size === 0 && !feedbackMessage.trim()) {
      setFeedbackStatus('error');
      return;
    }
    setFeedbackStatus('submitting');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureNeeds: [...feedbackNeeds],
          targetCity: feedbackCity,
          targetRole: feedbackRole,
          contact: feedbackContact,
          message: feedbackMessage,
          ...currentAnalyticsContext(),
        }),
      });
      if (!response.ok) throw new Error('feedback-submit-failed');
      setFeedbackStatus('success');
      setFeedbackNeeds(new Set());
      setFeedbackCity('');
      setFeedbackRole('');
      setFeedbackContact('');
      setFeedbackMessage('');
    } catch {
      setFeedbackStatus('error');
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark">FR</div>
          <div>
            <h1>外企雷达</h1>
            <span>真实外企岗位与福利情报库</span>
          </div>
        </div>
        <nav className="nav" aria-label="产品导航">
          <button className="active">公司库</button>
          <button onClick={() => document.getElementById('job-radar')?.scrollIntoView({ behavior: 'smooth' })}>岗位雷达</button>
          <button>福利情报</button>
          <button>投稿</button>
          {authUser ? <button onClick={() => { window.location.href = '/me'; }}>{maskPhone(authUser.phone)}</button> : <button onClick={() => {
            setPendingIntent(null);
            setAuthMode('register');
            setAuthOpen(true);
          }}>登录</button>}
        </nav>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <section className="panel searchPanel">
            <label htmlFor="search">搜索公司、岗位、福利</label>
            <div className="searchBox">
              <span>⌕</span>
              <input id="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SAP、宠物、补充公积金、上海" />
            </div>
          </section>

          <section className="panel filterPanel">
            <div className="filterTitle"><h2>行业</h2><span>{industries.length} 类</span></div>
            <div className="chips">
              {['全部', ...industries].map((item) => (
                <button key={item} className={`chip ${industry === item ? 'active' : ''}`} onClick={() => setIndustry(item)}>{item}</button>
              ))}
            </div>
          </section>

          <section className="panel filterPanel">
                <div className="filterTitle"><h2>高价值福利</h2><span>可叠加</span></div>
            <div className="chips">
              {benefitFilters.map((item) => (
                <button key={item} className={`chip ${benefits.has(item) ? 'active' : ''}`} onClick={() => toggleBenefit(item)}>{item}</button>
              ))}
            </div>
          </section>

          <section className="stats">
            <div className="panel stat"><strong>{companies.length}</strong><span>外企公司</span></div>
            <div className="panel stat"><strong>{industries.length}</strong><span>行业分类</span></div>
            <div className="panel stat"><strong>{filtered.length}</strong><span>当前匹配</span></div>
          </section>

        </aside>

        <main className="main">
          <section className="hero">
            <div className="panel heroCopy">
              <div>
                <div className="eyebrow">FOREIGN COMPANY RADAR</div>
                <h2>找外企岗位，不再靠碰运气</h2>
                <p>输入你的城市，先看身边有哪些外企、适合投什么岗位、官网招聘入口在哪里。</p>
              </div>
              <div className="citySearchHero" id="city-answer">
                <label htmlFor="city-search">你想查哪个城市？</label>
                <div className="citySearchBox">
                  <input id="city-search" value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} onKeyDown={(event) => {
                    if (event.key === 'Enter') searchCity(cityQuery);
                  }} placeholder="输入城市，例如南京、大连、长沙" />
                  <button className="primaryButton" onClick={() => searchCity(cityQuery)}>查我的外企机会</button>
                </div>
                <div className="cityQuickLinks">
                  {popularCities.map((city) => <button key={city} onClick={() => searchCity(city)}>{city}</button>)}
                </div>
              </div>
              <div className="heroActions">
                <button className="primaryButton" onClick={resetFilters}>浏览全部外企</button>
                {quickSearches.map((item) => <button key={item} className="ghostButton" onClick={() => setQuery(item)}>{item}赛道</button>)}
              </div>
            </div>
            <div className="panel cityAnswerPanel">
              {cityQuery.trim() ? (
                <>
                  <div className="eyebrow">城市答案</div>
                  <h3>{cityQuery.trim()}外企机会</h3>
                  <p>已收录 {cityAnswerCompanies.length} 家相关外企{cityAnswerIndustries.length > 0 ? `，覆盖 ${cityAnswerIndustries.map(([name]) => name).join('、')}` : ''}。</p>
                  <div className="previewCompanies">
                    {cityAnswerCompanies.slice(0, 3).map((company) => (
                      <button key={`preview-${company.company}`} onClick={() => openCompany(company)}>
                        <strong>{company.company}</strong>
                        <span>{company.industry}</span>
                      </button>
                    ))}
                    {cityAnswerCompanies.length === 0 ? <span className="emptyHint">这个城市还在补充中，可以先进群催更。</span> : null}
                  </div>
                  {cityAnswerCompanies.length > 3 ? <div className="moreHint">下方列表已同步筛选，可继续查看全部 {cityAnswerCompanies.length} 家公司。</div> : null}
                </>
              ) : (
                <>
                  <h3>先查城市，再看公司</h3>
                  <p>直接查看城市是否有收录、公司数量、行业方向和已整理的外企名单。</p>
                  <div className="valueList">
                    <span>138 家外企种子库</span>
                    <span>30 个城市覆盖</span>
                    <span>招聘入口已核验</span>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="panel trustStrip">
            <div><strong>全部可查</strong><span>城市数量、行业方向、公司详情和招聘入口</span></div>
            <div><strong>持续完善</strong><span>你反馈的城市和功能会优先补充</span></div>
            <div><strong>进群更新</strong><span>新增城市和岗位优先同步</span></div>
          </section>

          <section className="panel feedbackPanel" id="feedback">
            <div className="feedbackIntro">
              <div className="eyebrow">用户反馈</div>
              <h3>你希望我们的外企雷达网站还提供什么？</h3>
              <p>告诉我们你最想要的功能、城市和岗位方向，我们会优先补充高需求内容。</p>
            </div>
            <form className="feedbackForm" onSubmit={submitFeedback}>
              <div className="feedbackOptions">
                {feedbackOptions.map((item) => (
                  <label key={item} className={feedbackNeeds.has(item) ? 'active' : ''}>
                    <input type="checkbox" checked={feedbackNeeds.has(item)} onChange={() => toggleFeedbackNeed(item)} />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
              <div className="feedbackFields">
                <input value={feedbackCity} onChange={(event) => setFeedbackCity(event.target.value)} placeholder="你关注的城市，例如长沙/郑州/大连" />
                <input value={feedbackRole} onChange={(event) => setFeedbackRole(event.target.value)} placeholder="你想找的岗位，例如产品/财务/供应链" />
                <input value={feedbackContact} onChange={(event) => setFeedbackContact(event.target.value)} placeholder="微信或邮箱，可选" />
              </div>
              <textarea value={feedbackMessage} onChange={(event) => setFeedbackMessage(event.target.value)} placeholder="还有什么想法？比如希望增加公司评价、薪资、外包识别、简历模板等。" />
              <div className="feedbackActions">
                <button className="primaryButton" type="submit" disabled={feedbackStatus === 'submitting'}>{feedbackStatus === 'submitting' ? '提交中' : '提交反馈'}</button>
                {feedbackStatus === 'success' ? <span>已收到，感谢你的建议。</span> : null}
                {feedbackStatus === 'error' ? <span>请选择一个功能或写下你的想法。</span> : null}
              </div>
            </form>
          </section>


          {sapJobs ? (
            <section className="panel featured" id="job-radar">
              <div className="featuredCopy">
                <div className="eyebrow">今日推荐</div>
                <h3>SAP 中国正在招聘</h3>
                <p>官网当前同步到 {sapJobs.count} 个中国范围岗位，覆盖多个城市。</p>
                <div className="featuredActions">
                  <button className="primaryButton" onClick={() => {
                    const sap = companies.find((company) => company.company === 'SAP');
                    if (sap) openCompany(sap);
                  }}>查看 SAP 岗位</button>
                  <a className="ghostButton" href={sapJobs.sourceUrl} target="_blank" rel="noreferrer">打开 SAP 官网</a>
                </div>
              </div>
              <div className="featuredJobs">
                {sapJobs.jobs.slice(0, 3).map((job) => (
                  <a className="miniJob" href={job.sourceUrl} target="_blank" rel="noreferrer" key={job.id}>
                    <strong>{job.title}</strong>
                    <span>{job.location}</span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <section className="panel regionExplorer">
            <div className="regionCopy">
              <div className="eyebrow">按地区找外企</div>
              <h3>地图只是入口，答案落到城市</h3>
              <p>点击区域后选择城市，直接查看该城市外企名单和岗位线索。</p>
              <div className="regionActions">
                <button className={`chip ${selectedRegion === '全部' ? 'active' : ''}`} onClick={() => selectRegion('全部')}>全国</button>
                {regionStats.map((region) => (
                  <button key={region.id} className={`chip ${selectedRegion === region.id ? 'active' : ''}`} onClick={() => selectRegion(region.id)}>
                    {region.name} {region.total}
                  </button>
                ))}
              </div>
              {activeRegion ? (
                <div className="regionDetail">
                  <strong>{activeRegion.name}</strong>
                  <span>{activeRegion.companyCount} 家公司 · {activeRegion.jobCount} 个同步岗位</span>
                  <div>
                    {activeRegion.topCities.length > 0 ? activeRegion.topCities.map(([city, count]) => (
                      <button key={city} className={selectedRegionCity === city ? 'active' : ''} onClick={() => {
                        setSelectedRegionCity(selectedRegionCity === city ? null : city);
                        trackEvent('city_filter_click', { region: activeRegion.name, city });
                      }}>{city} {count}</button>
                    )) : <b>等待补充城市数据</b>}
                  </div>
                </div>
              ) : null}
              {activeRegion ? (
                <div className="regionCompanies">
                  <div className="regionCompaniesHead">
                    <strong>{selectedRegionCity ? `${selectedRegionCity}外企名单` : `${activeRegion.name}外企名单`}</strong>
                    <span>{activeRegionCompanies.length} / {activeRegion.companyCount}</span>
                  </div>
                  {activeRegionCompanies.length > 0 ? activeRegionCompanies.map((company) => (
                    <button key={`${activeRegion.id}-${company.company}`} onClick={() => openCompany(company)}>
                      <span>{company.company}</span>
                      <small>{company.industry} · {company.primaryChinaCityFocus}</small>
                    </button>
                  )) : <p>这个区域还没有结构化公司数据，可以先订阅地区更新。</p>}
                </div>
              ) : null}
            </div>
            <div className="chinaMap" aria-label="中国区域外企分布图">
              <svg viewBox="0 0 680 660" role="img">
                {regionStats.map((region) => {
                  const intensity = 0.18 + (region.total / maxRegionTotal) * 0.72;
                  const isActive = selectedRegion === region.id;
                  return (
                    <g key={region.id}>
                      <path
                        d={region.shape}
                        className={isActive ? 'active' : ''}
                        fill={`rgba(15, 118, 110, ${intensity})`}
                        onClick={() => selectRegion(region.id)}
                      />
                    </g>
                  );
                })}
                {regionStats.map((region) => {
                  const match = region.shape.match(/M(\d+) (\d+)/);
                  const x = match ? Number(match[1]) + 54 : 100;
                  const y = match ? Number(match[2]) + 72 : 100;
                  return (
                    <g key={`${region.id}-label`} className="mapLabel" onClick={() => selectRegion(region.id)}>
                      <text x={x} y={y}>{region.name}</text>
                      <text x={x} y={y + 24}>{region.companyCount} 公司 / {region.jobCount} 岗</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </section>

          <section className="panel toolbar">
            <div><strong>{filtered.length}</strong> 家公司匹配当前筛选</div>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="company">按公司名</option>
              <option value="industry">按行业</option>
              <option value="city">按城市</option>
            </select>
          </section>

          {error ? <section className="panel empty">{error}</section> : null}
          {!error && filtered.length === 0 ? <section className="panel empty">没有匹配的公司，换个关键词或清空筛选试试。</section> : null}

          <section className="companyGrid">
            {filtered.map((company) => (
              <article className="panel companyCard" key={`${company.company}-${company.recruitingUrl}`} onClick={() => openCompany(company)}>
                <div className="companyHead">
                  <div className="logo" style={{ background: colorFor(company.industry) }}>{initials(company.company)}</div>
                  <div>
                    <h3>{company.company}</h3>
                    <p>{company.brandOrCnName} · {company.countryOrRegion}</p>
                  </div>
                  <span className="sourceTag">{jobSummary[company.company]?.count ? `岗位 ${jobSummary[company.company].count}` : '官网'}</span>
                </div>
                <div className="metaRows">
                  <div><b>行业</b><span>{company.industry}</span></div>
                  <div><b>城市</b><span>{company.primaryChinaCityFocus}</span></div>
                  <div><b>赛道</b><span>{company.subSector}</span></div>
                </div>
                <div className="benefitTags">
                  {company.benefits.slice(0, 4).map((benefit) => <span key={benefit}>{benefit}</span>)}
                </div>
              </article>
            ))}
          </section>
        </main>
      </div>

      {selected ? (
        <div className="drawer" role="dialog" aria-modal="true">
          <button className="shade" onClick={() => setSelected(null)} aria-label="关闭详情" />
          <aside className="drawerPanel">
            <div className="drawerTop">
              <div>
                <div className="eyebrow">{selected.industry} / {selected.subSector}</div>
                <h2>{selected.company}</h2>
                <p>{selected.brandOrCnName} · {selected.countryOrRegion} · {selected.primaryChinaCityFocus}</p>
              </div>
              <button className="closeButton" onClick={() => setSelected(null)} aria-label="关闭">×</button>
            </div>
            <section className="detailSection">
              <h3>适合关注岗位</h3>
              <p>{selected.rolesToWatch}</p>
            </section>
            <section className="detailSection">
              <h3>福利与筛选标签</h3>
              <div className="benefitTags wide">{selected.benefits.map((benefit) => <span key={benefit}>{benefit}</span>)}</div>
            </section>
            <section className="detailSection">
              <h3>公司信息</h3>
              <dl>
                <div><dt>行业</dt><dd>{selected.industry}</dd></div>
                <div><dt>细分赛道</dt><dd>{selected.subSector}</dd></div>
                <div><dt>重点城市</dt><dd>{selected.primaryChinaCityFocus}</dd></div>
                <div><dt>备注</dt><dd>{selected.notes}</dd></div>
              </dl>
            </section>
            <section className="detailSection">
              <h3>投递记录</h3>
              <p>{authUser ? '记录你的求职动作，后续可以继续完善投递清单。' : '登录后可以保存收藏、稍后投和已投递公司。'}</p>
              <div className="intentActions">
                <button onClick={() => openAuthForIntent('applied', selected)}>我已投递</button>
                <button onClick={() => openAuthForIntent('saved', selected)}>收藏</button>
                <button onClick={() => openAuthForIntent('later', selected)}>稍后投</button>
              </div>
              {authStatus === 'success' && authMessage && !authOpen ? <span className="inlineSuccess">{authMessage}</span> : null}
            </section>
            {selectedJobs?.jobs.length ? (
              <section className="detailSection">
                <div className="sectionHead">
                  <div>
                    <h3>{selected.company === 'SAP' ? '当前官网在招岗位' : '试抓到的官网岗位'}</h3>
                    <p>{selectedJobs.count} 个岗位线索 · 更新于 {new Date(selectedJobs.scrapedAt).toLocaleString('zh-CN')}{selected.company === 'SAP' ? '' : ' · 通用抓取结果需以官网为准'}</p>
                  </div>
                  <a className="textLink" href={selectedJobs.sourceUrl || selected.recruitingUrl.split(';')[0]} target="_blank" rel="noreferrer">查看全部</a>
                </div>
                {selectedJobs.cityCounts ? (
                  <div className="citySummary">
                    {Object.entries(selectedJobs.cityCounts).map(([city, count]) => (
                      <span key={city}>{city} {count}</span>
                    ))}
                  </div>
                ) : null}
                <div className="jobList">
                  {selectedJobs.jobs.slice(0, 12).map((job) => (
                    <a className="jobItem" href={job.sourceUrl} target="_blank" rel="noreferrer" key={job.id}>
                      <strong>{job.title}</strong>
                      <span>{job.location} · {job.sourcePlatform}</span>
                    </a>
                  ))}
                </div>
              </section>
            ) : selectedJobsStatus === 'loading' ? (
              <section className="detailSection"><h3>岗位同步中</h3><p>正在读取该公司的官网岗位线索。</p></section>
            ) : selectedJobSummary?.count ? (
              <section className="detailSection">
                <h3>官网岗位线索</h3>
                <p>已抓到 {selectedJobSummary.count} 条岗位线索，正在做链接和地区复核。当前详情页只展示高可信岗位，完整结果请以官网入口为准。</p>
                <a className="textLink" href={splitRecruitingUrls(selected.recruitingUrl)[0]} target="_blank" rel="noreferrer">打开官网招聘入口</a>
              </section>
            ) : null}
            <section className="detailSection">
              <h3>招聘入口</h3>
              <div className="careerLinks">
                {splitRecruitingUrls(selected.recruitingUrl).map((url, index) => (
                  <a className={index === 0 ? 'primaryButton linkButton' : 'ghostButton linkButton'} href={url} target="_blank" rel="noreferrer" key={url} onClick={() => trackEvent('career_link_click', { company: selected.company, targetUrl: url })}>
                    {linkLabel(url, index)}
                  </a>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
      {authOpen ? (
        <div className="leadModal" role="dialog" aria-modal="true" aria-label="登录保存投递记录">
          <button className="wechatShade" onClick={() => setAuthOpen(false)} aria-label="关闭登录弹窗" />
          <form className="leadCard authCard" onSubmit={submitAuth}>
            <button className="closeButton" type="button" onClick={() => setAuthOpen(false)} aria-label="关闭">×</button>
            <div className="eyebrow">{authMode === 'register' ? '创建账号' : '账号登录'}</div>
            <h2>{pendingIntent ? `${intentMeta[pendingIntent.intent].label} · ${pendingIntent.company.company}` : '登录外企雷达'}</h2>
            <p>用手机号和密码登录后，可以保存收藏、稍后投、已投递公司，后续也能继续查看自己的外企投递清单。</p>
            <input value={authPhone} onChange={(event) => setAuthPhone(event.target.value)} placeholder="手机号" inputMode="tel" />
            <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder={authMode === 'register' ? passwordHint() : '输入密码'} type="password" />
            <div className="leadActions">
              <button className="primaryButton" type="submit" disabled={authStatus === 'submitting'}>{authStatus === 'submitting' ? '处理中' : authMode === 'register' ? '注册并保存' : '登录并保存'}</button>
              <button className="ghostButton" type="button" onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}>{authMode === 'register' ? '已有账号，去登录' : '没有账号，去注册'}</button>
            </div>
            {authMessage ? <span className={`leadMessage ${authStatus === 'error' ? 'error' : ''}`}>{authMessage}</span> : null}
          </form>
        </div>
      ) : null}
      <button className="wechatDock" aria-label="加入外企求职微信群" onClick={() => {
        trackEvent('wechat_qr_open');
        setWechatOpen(true);
      }} onMouseEnter={() => setWechatOpen(true)}>
        <img className="wechatQr" src="/assets/wechat-group-qr.png" alt="外企雷达求职交流群二维码" />
        <div>
          <strong>加入外企求职群</strong>
          <span>获取城市清单更新、岗位提醒和福利避坑线索</span>
        </div>
      </button>
      {wechatOpen ? (
        <div className="wechatModal" role="dialog" aria-modal="true" aria-label="外企雷达求职交流群二维码">
          <button className="wechatShade" onClick={() => setWechatOpen(false)} aria-label="关闭微信群二维码" />
          <div className="wechatModalCard">
            <button className="closeButton" onClick={() => setWechatOpen(false)} aria-label="关闭">×</button>
            <img src="/assets/wechat-group-qr.png" alt="外企雷达求职交流群二维码" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
