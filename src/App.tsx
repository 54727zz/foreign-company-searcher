import { useEffect, useMemo, useState } from 'react';
import { loadCompanies } from './lib/csv';
import type { Company, JobFeed } from './types';

const benefitFilters = ['五险一金', '商业保险', '补充', '股票', '混合办公', '员工折扣', '奖金', '培训'];
const quickSearches = ['宠物', '家具', '半导体', '补充', '股票'];

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

export default function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState('全部');
  const [benefits, setBenefits] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Company | null>(null);
  const [sortBy, setSortBy] = useState('company');
  const [error, setError] = useState<string | null>(null);
  const [sapJobs, setSapJobs] = useState<JobFeed | null>(null);

  useEffect(() => {
    loadCompanies().then(setCompanies).catch(() => setError('公司数据加载失败，请检查 CSV 文件。'));
    fetch('/jobs/sap-china.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((feed: JobFeed | null) => setSapJobs(feed))
      .catch(() => setSapJobs(null));
  }, []);

  const industries = useMemo(() => [...new Set(companies.map((company) => company.industry))].sort(), [companies]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return companies
      .filter((company) => industry === '全部' || company.industry === industry)
      .filter((company) => [...benefits].every((benefit) => company.benefitOrFilterTags.includes(benefit)))
      .filter((company) => !normalized || companyText(company).includes(normalized))
      .sort((a, b) => {
        if (sortBy === 'industry') return a.industry.localeCompare(b.industry, 'zh-Hans-CN');
        if (sortBy === 'city') return a.primaryChinaCityFocus.localeCompare(b.primaryChinaCityFocus, 'zh-Hans-CN');
        return a.company.localeCompare(b.company, 'en');
      });
  }, [companies, industry, benefits, query, sortBy]);

  const topIndustries = useMemo(() => {
    const counts = new Map<string, number>();
    companies.forEach((company) => counts.set(company.industry, (counts.get(company.industry) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [companies]);

  const maxIndustryCount = topIndustries[0]?.[1] ?? 1;

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
          <button>岗位雷达</button>
          <button>福利情报</button>
          <button>投稿</button>
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
                <p>按行业、城市、福利和合同类型筛选真实外企机会，发现科技、药企、宠物食品、家具家居、半导体设备等值得关注的公司。</p>
              </div>
              <div className="heroActions">
                <button className="primaryButton" onClick={resetFilters}>浏览全部外企</button>
                {quickSearches.map((item) => <button key={item} className="ghostButton" onClick={() => setQuery(item)}>{item}赛道</button>)}
              </div>
            </div>
            <div className="panel insightPanel">
              <h3>行业覆盖</h3>
              <div className="bars">
                {topIndustries.map(([name, count]) => (
                  <button key={name} className="barRow" onClick={() => setIndustry(name)}>
                    <span>{name}</span>
                    <i><b style={{ width: `${Math.round((count / maxIndustryCount) * 100)}%` }} /></i>
                    <strong>{count}</strong>
                  </button>
                ))}
              </div>
            </div>
          </section>


          {sapJobs ? (
            <section className="panel featured">
              <div className="featuredCopy">
                <div className="eyebrow">今日推荐</div>
                <h3>SAP 中国正在招聘</h3>
                <p>官网当前抓取到 {sapJobs.count} 个中国范围岗位，覆盖上海、北京、大连、深圳、广州、西安、成都等城市。</p>
                <div className="featuredActions">
                  <button className="primaryButton" onClick={() => {
                    const sap = companies.find((company) => company.company === 'SAP');
                    if (sap) setSelected(sap);
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
              <article className="panel companyCard" key={`${company.company}-${company.recruitingUrl}`} onClick={() => setSelected(company)}>
                <div className="companyHead">
                  <div className="logo" style={{ background: colorFor(company.industry) }}>{initials(company.company)}</div>
                  <div>
                    <h3>{company.company}</h3>
                    <p>{company.brandOrCnName} · {company.countryOrRegion}</p>
                  </div>
                  <span className="sourceTag">官网</span>
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
            {selected.company === 'SAP' && sapJobs ? (
              <section className="detailSection">
                <div className="sectionHead">
                  <div>
                    <h3>当前官网在招岗位</h3>
                    <p>{sapJobs.count} 个中国范围岗位 · 更新于 {new Date(sapJobs.scrapedAt).toLocaleString('zh-CN')}</p>
                  </div>
                  <a className="textLink" href={sapJobs.sourceUrl} target="_blank" rel="noreferrer">查看全部</a>
                </div>
                {sapJobs.cityCounts ? (
                  <div className="citySummary">
                    {Object.entries(sapJobs.cityCounts).map(([city, count]) => (
                      <span key={city}>{city} {count}</span>
                    ))}
                  </div>
                ) : null}
                <div className="jobList">
                  {sapJobs.jobs.slice(0, 12).map((job) => (
                    <a className="jobItem" href={job.sourceUrl} target="_blank" rel="noreferrer" key={job.id}>
                      <strong>{job.title}</strong>
                      <span>{job.location} · {job.sourcePlatform}</span>
                    </a>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="detailSection">
              <h3>招聘入口</h3>
              <a className="primaryButton linkButton" href={selected.recruitingUrl} target="_blank" rel="noreferrer">打开官网招聘</a>
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
