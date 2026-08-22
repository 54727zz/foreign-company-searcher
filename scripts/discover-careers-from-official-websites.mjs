import fs from 'node:fs/promises';

const INPUT_CSV = process.env.OFFICIAL_SITE_INPUT ?? 'work/waiqi/career-enrichment/foreign-companies-local-enriched-strict.csv';
const OUT_DIR = 'work/official-career-search';
const RESULTS_PATH = `${OUT_DIR}/official-site-career-discovery-results.json`;
const MAX_COMPANIES = Number(process.env.OFFICIAL_SITE_MAX ?? 300);
const CONCURRENCY = Number(process.env.OFFICIAL_SITE_CONCURRENCY ?? 8);
const TIMEOUT_MS = Number(process.env.OFFICIAL_SITE_TIMEOUT_MS ?? 7000);

function cleanText(value) { return value == null ? '' : String(value).replace(/\u00a0/g, ' ').trim(); }
function csvValue(value) { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; }
function parseCsv(text) { const rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&q&&n==='"'){cell+='"';i++;continue}if(c==='"'){q=!q;continue}if(c===','&&!q){row.push(cell);cell='';continue}if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(v=>v.length))rows.push(row);row=[];cell='';continue}cell+=c}if(cell.length||row.length){row.push(cell);rows.push(row)}return rows; }
function toObject(headers,row){return Object.fromEntries(headers.map((h,i)=>[h,cleanText(row[i])]));}
function normalizeUrl(value){const text=cleanText(value); if(!text)return ''; try{return new URL(/^https?:\/\//i.test(text)?text:`https://${text}`).toString()}catch{return ''}}
function host(url){try{return new URL(url).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}}
function rootHost(value){const h=/^https?:/i.test(value||'')?host(value):String(value||'').replace(/^www\./,'').toLowerCase();const parts=h.split('.').filter(Boolean);if(parts.length<=2)return h;const two=new Set(['com.cn','net.cn','org.cn','co.uk','com.au']);const tail=parts.slice(-2).join('.');return two.has(tail)&&parts.length>=3?parts.slice(-3).join('.'):tail;}
function sameDomain(base,url){const official=rootHost(base); return official && (rootHost(url)===official || host(url).endsWith('.'+official));}
function careerSignal(value){return /career|careers|job|jobs|join-us|joinus|recruit|recruitment|talent|workday|oraclecloud|smartrecruiters|greenhouse|lever|eightfold|successfactors|hotjob|wecruit|招聘|职位|加入我们|人才|校园招聘|社会招聘/i.test(value||'')}
function isKnownAts(value){return /workday|oraclecloud|smartrecruiters|greenhouse|lever|eightfold|successfactors|hotjob|wecruit|zhiye\.com/i.test(value||'')}
function isThirdPartyJobBoard(value){return /glasshr\.com|zhaopin\.com|51job\.com|liepin\.com|bosszhipin\.com|zhipin\.com|linkedin\.com|indeed\.com|glassdoor\.com|jobui\.com|kanzhun\.com|shixiseng\.com|yingjiesheng\.com|job1001\.com|job5156\.com|cjol\.com|jobcn\.com/i.test(value||'')}
function badCareerFinalUrl(value,title=''){
  const url=String(value||'').toLowerCase();
  const pageTitle=String(title||'').toLowerCase();
  return isThirdPartyJobBoard(url)
    || /404|not-found|notfound|error|mall|rewards|coupon|login|oauth|signin|customer|customers|case-study|casestudy|stories|story|news|press|blog|services|solutions|talent-organization/i.test(url)
    || /404|not found|页面不存在|找不到|customer story|case study|press release|news|blog|service|solution/i.test(pageTitle);
}
function isVerifiedCareerCandidate(check, officialWebsite){
  const finalUrl=check.finalUrl||check.url;
  if(!check.ok||!sameDomain(officialWebsite,finalUrl)||badCareerFinalUrl(finalUrl,check.title))return false;
  if(isKnownAts(finalUrl))return true;
  if(/career|careers|job|jobs|join-us|joinus|recruit|recruitment|招聘|职位|加入我们|校园招聘|社会招聘/i.test(finalUrl))return true;
  if(/career|careers|job|jobs|recruit|招聘|职位|加入我们|校园招聘|社会招聘/i.test(check.title||''))return true;
  return Boolean(check.bodySignal&&careerSignal(finalUrl));
}
function careerCandidates(website){const normalized=normalizeUrl(website); if(!normalized)return[]; let u; try{u=new URL(normalized)}catch{return[]}; const origin=u.origin; const paths=['/careers','/career','/jobs','/join-us','/joinus','/talent','/recruitment','/recruit','/job-opportunities','/work-with-us','/about/careers','/en/careers','/zh/careers','/cn/careers','/zh-cn/careers','/招聘','/加入我们']; return [...new Set([normalized,...paths.map(p=>origin+p)])];}
async function checkUrl(url, officialWebsite){const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),TIMEOUT_MS);try{const res=await fetch(url,{redirect:'follow',signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',accept:'text/html,*/*','accept-language':'zh-CN,zh;q=0.9,en;q=0.8'}});const finalUrl=res.url;const ok=res.status>=200&&res.status<400;let title='';let bodySignal=false;let links=[];const ct=res.headers.get('content-type')||'';if(ok&&/html|text/i.test(ct)){const text=(await res.text()).slice(0,120000);title=cleanText(text.match(/<title[^>]*>([^<]+)/i)?.[1]);bodySignal=/search jobs|job openings|open positions|career opportunities|join our team|招聘职位|社会招聘|校园招聘|加入我们|职位搜索/i.test(text);links=[...text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>{try{return {url:new URL(m[1],finalUrl).toString(),text:cleanText(m[2].replace(/<[^>]+>/g,''))}}catch{return null}}).filter(Boolean).filter(l=>careerSignal(l.url)||careerSignal(l.text)).slice(0,20)}return{url,ok,status:res.status,finalUrl,title,bodySignal,careerSignal:(careerSignal(url)||careerSignal(finalUrl)||careerSignal(title))&&sameDomain(officialWebsite,finalUrl)&&!badCareerFinalUrl(finalUrl,title),sameDomain:sameDomain(officialWebsite,finalUrl),links,error:''}}catch(e){return{url,ok:false,status:'ERR',finalUrl:'',title:'',careerSignal:false,sameDomain:false,links:[],error:e?.name==='AbortError'?'timeout':e.message}}finally{clearTimeout(timeout)}}
async function readResults(){try{return JSON.parse(await fs.readFile(RESULTS_PATH,'utf8'))}catch{return[]}}

await fs.mkdir(OUT_DIR,{recursive:true});
const [headers,...rows]=parseCsv((await fs.readFile(INPUT_CSV,'utf8')).replace(/^\uFEFF/,''));
const companies=rows.map(r=>toObject(headers,r));
const existing=await readResults(); const done=new Set(existing.map(r=>r.companyKey));
const targets=companies.filter(r=>!r.recruiting_url&&r.official_website&&r.company).filter(r=>!done.has(`${r.company}|${r.waiqi_id||''}`)).slice(0,MAX_COMPANIES);
const results=[...existing]; let cursor=0;
async function processOne(row){const companyKey=`${row.company}|${row.waiqi_id||''}`;const checks=[];for(const url of careerCandidates(row.official_website)){const c=await checkUrl(url,row.official_website);checks.push(c);if(isVerifiedCareerCandidate(c,row.official_website))return {companyKey,company:row.company,waiqiId:row.waiqi_id,status:'verified_career',careerUrl:c.finalUrl||c.url,checkedAt:new Date().toISOString(),checks}; if(c.ok&&c.links?.length){for(const link of c.links.slice(0,8)){const lc=await checkUrl(link.url,row.official_website);checks.push({...lc,discoveredFrom:c.finalUrl,linkText:link.text});if(isVerifiedCareerCandidate(lc,row.official_website))return {companyKey,company:row.company,waiqiId:row.waiqi_id,status:'verified_career',careerUrl:lc.finalUrl||lc.url,checkedAt:new Date().toISOString(),checks};}}}return {companyKey,company:row.company,waiqiId:row.waiqi_id,status:checks.some(c=>c.ok)?'official_site_no_verified_career':'official_site_unreachable',careerUrl:'',checkedAt:new Date().toISOString(),checks};}
async function worker(){while(cursor<targets.length){const row=targets[cursor++];try{const r=await processOne(row);results.push(r);await fs.writeFile(RESULTS_PATH,JSON.stringify(results,null,2));console.log(`${r.status}\t${row.company}\t${r.careerUrl||'-'}`)}catch(e){const r={companyKey:`${row.company}|${row.waiqi_id||''}`,company:row.company,waiqiId:row.waiqi_id,status:'error',error:e instanceof Error?e.message:String(e),checkedAt:new Date().toISOString()};results.push(r);await fs.writeFile(RESULTS_PATH,JSON.stringify(results,null,2));console.log(`error\t${row.company}\t${r.error}`)}}}
await Promise.all(Array.from({length:CONCURRENCY},worker));
const byKey=new Map(results.map(r=>[r.companyKey,r]));
const outputRows=companies.map(row=>{if(row.recruiting_url)return row;const r=byKey.get(`${row.company}|${row.waiqi_id||''}`);if(r?.status==='verified_career'&&r.careerUrl)return{...row,recruiting_url:r.careerUrl,verified_career_url:r.careerUrl,career_enrichment_status:'official_site_verified'};if(r)return{...row,career_enrichment_status:r.status};return row});
const outputHeaders=[...headers];for(const h of ['verified_career_url','career_enrichment_status'])if(!outputHeaders.includes(h))outputHeaders.push(h);
const csv=[outputHeaders.join(','),...outputRows.map(row=>outputHeaders.map(h=>csvValue(row[h])).join(','))].join('\n');
await fs.writeFile(`${OUT_DIR}/foreign-companies-official-site-enriched.csv`,'\uFEFF'+csv);
await fs.writeFile(`${OUT_DIR}/official-site-career-discovery-summary.json`,JSON.stringify({generatedAt:new Date().toISOString(),totalResults:results.length,verifiedCareer:results.filter(r=>r.status==='verified_career').length,noVerified:results.filter(r=>r.status?.startsWith('official_site_')).length,error:results.filter(r=>r.status==='error').length},null,2));
