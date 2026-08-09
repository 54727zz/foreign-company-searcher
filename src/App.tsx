import { useEffect, useMemo, useState } from 'react';
import { loadCompanies } from './lib/csv';
import { trackEvent } from './lib/analytics';
import { chinaRegions, companyMatchesRegion, jobMatchesRegion, topCitiesForRegion } from './lib/locations';
import type { Company, JobFeed } from './types';

const benefitFilters = ['五险一金', '商业保险', '补充', '股票', '混合办公', '员工折扣', '奖金', '培训'];
const quickSearches = ['宠物', '家具', '半导体', '补充', '股票'];
const freeCompanyViewLimit = 3;
const proDurationMs = 7 * 24 * 60 * 60 * 1000;
const viewStorageKey = 'foreignRadarViewedCompanies';
const proStorageKey = 'foreignRadarProUntil';

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

export default function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState('全部');
  const [benefits, setBenefits] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Company | null>(null);
  const [sortBy, setSortBy] = useState('company');
  const [error, setError] = useState<string | null>(null);
  const [sapJobs, setSapJobs] = useState<JobFeed | null>(null);
  const [selectedRegion, setSelectedRegion] = useState('全部');
  const [selectedRegionCity, setSelectedRegionCity] = useState<string | null>(null);
  const [wechatOpen, setWechatOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [viewedCompanies, setViewedCompanies] = useState<string[]>([]);
  const [proUntil, setProUntil] = useState(0);

  useEffect(() => {
    loadCompanies().then(setCompanies).catch(() => setError('公司数据加载失败，请检查 CSV 文件。'));
    fetch('/jobs/sap-china.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((feed: JobFeed | null) => setSapJobs(feed))
      .catch(() => setSapJobs(null));
  }, []);

  useEffect(() => {
    try {
      setViewedCompanies(JSON.parse(localStorage.getItem(viewStorageKey) ?? '[]'));
      setProUntil(Number(localStorage.getItem(proStorageKey) ?? '0'));
    } catch {
      setViewedCompanies([]);
      setProUntil(0);
    }
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
  const activeRegion = regionStats.find((region) => region.id === selectedRegion) ?? null;
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

  const hasProAccess = proUntil > Date.now();
  const remainingFreeViews = Math.max(0, freeCompanyViewLimit - viewedCompanies.length);

  function openCompany(company: Company) {
    if (hasProAccess || viewedCompanies.includes(company.company) || viewedCompanies.length < freeCompanyViewLimit) {
      trackEvent('company_detail_click', { company: company.company });
      setSelected(company);
      if (!hasProAccess && !viewedCompanies.includes(company.company)) {
        const next = [...viewedCompanies, company.company];
        setViewedCompanies(next);
        localStorage.setItem(viewStorageKey, JSON.stringify(next));
      }
      return;
    }
    trackEvent('paywall_view', { company: company.company });
    setPaywallOpen(true);
  }

  function unlockProTrial() {
    trackEvent('paywall_unlock_click');
    const until = Date.now() + proDurationMs;
    setProUntil(until);
    localStorage.setItem(proStorageKey, String(until));
    setPaywallOpen(false);
    setWechatOpen(true);
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

          <section className="panel proStatus">
            <strong>{hasProAccess ? 'Pro 已解锁' : `免费查看 ${remainingFreeViews} 家`}</strong>
            <span>{hasProAccess ? '7 天内不限查看公司详情' : '第 4 家开始提示解锁完整外企库'}</span>
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
            <section className="panel featured" id="job-radar">
              <div className="featuredCopy">
                <div className="eyebrow">今日推荐</div>
                <h3>SAP 中国正在招聘</h3>
                <p>官网当前抓取到 {sapJobs.count} 个中国范围岗位，覆盖上海、北京、大连、深圳、广州、西安、成都等城市。</p>
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
              <h3>先看区域，再进城市</h3>
              <p>点击地图区域，快速查看当地外企公司和 SAP 在招岗位。</p>
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
                  <span>{activeRegion.companyCount} 家公司 · {activeRegion.jobCount} 个 SAP 岗位</span>
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
      <button className="wechatDock" aria-label="加入外企求职微信群" onClick={() => {
        trackEvent('wechat_qr_open');
        setWechatOpen(true);
      }} onMouseEnter={() => setWechatOpen(true)}>
        <img className="wechatQr" src="/assets/wechat-group-qr.png" alt="外企雷达求职交流群二维码" />
        <div>
          <strong>加入外企求职群</strong>
          <span>扫码交流城市岗位和福利线索</span>
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
      {paywallOpen ? (
        <div className="paywallModal" role="dialog" aria-modal="true" aria-label="解锁外企雷达 Pro">
          <button className="wechatShade" onClick={() => setPaywallOpen(false)} aria-label="关闭解锁弹窗" />
          <section className="paywallCard">
            <button className="closeButton" onClick={() => setPaywallOpen(false)} aria-label="关闭">×</button>
            <div className="eyebrow">FOREIGN RADAR PRO</div>
            <h2>你今天已经查看 3 家外企</h2>
            <p>解锁完整外企库，继续查看公司详情、招聘入口、城市名单、岗位更新和福利避坑线索。</p>
            <div className="priceBox">
              <strong>9.9 元</strong>
              <span>解锁 7 天 · 当前为转化验证版</span>
            </div>
            <div className="paywallBenefits">
              <span>不限查看公司详情</span>
              <span>解锁多个招聘入口</span>
              <span>查看城市外企名单</span>
              <span>加入外企求职群</span>
            </div>
            <div className="paywallActions">
              <button className="primaryButton" onClick={unlockProTrial}>扫码/进群后临时解锁</button>
              <button className="ghostButton" onClick={() => {
                trackEvent('wechat_qr_open');
                setWechatOpen(true);
              }}>查看微信群二维码</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
