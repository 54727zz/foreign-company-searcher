type PagesContext = {
  request: Request;
  next: () => Promise<Response>;
};

const ALLOWED_EXACT_PATHS = new Set([
  '/',
  '/admin',
  '/me',
  '/api/admin/summary',
  '/api/advisor',
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/me',
  '/api/auth/register',
  '/api/user/intent',
  '/api/user/profile',
  '/api/user/subscriptions',
  '/api/feedback',
  '/api/jobs',
  '/api/job-summary',
  '/api/track',
  '/foreign_companies_by_industry.csv',
  '/company-data-current.csv',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
]);

const ALLOWED_PREFIXES = ['/assets/', '/jobs/'];

const HASH_SCAN_PATH = /^\/[a-f0-9]{24,64}$/i;
const SUSPICIOUS_PATHS = [
  /^\/\.env/i,
  /^\/\.git/i,
  /^\/wp-/i,
  /^\/wordpress/i,
  /^\/phpmyadmin/i,
  /^\/install/i,
  /^\/setup/i,
  /^\/vendor/i,
  /^\/cgi-bin/i,
  /^\/server-status/i,
  /^\/actuator/i,
  /^\/owa/i,
  /^\/config/i,
];

const SUSPICIOUS_USER_AGENTS = [
  'curl',
  'python',
  'python-requests',
  'wget',
  'scrapy',
  'go-http-client',
  'httpclient',
  'libwww',
  'nikto',
  'sqlmap',
  'nmap',
  'masscan',
  'zgrab',
  'dirbuster',
  'acunetix',
  'nessus',
];

const KNOWN_SEARCH_BOTS = [
  'googlebot',
  'bingbot',
  'baiduspider',
  'duckduckbot',
  'yandexbot',
  'slurp',
];

const PROTECTED_DATA_PATHS = [
  '/foreign_companies_by_industry.csv',
  '/company-data-current.csv',
  '/jobs/sap-china.json',
  '/jobs/sap-shanghai.json',
];

const requestHits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const GENERAL_RATE_LIMIT = 180;
const DATA_RATE_LIMIT = 45;

function isAllowedPath(pathname: string): boolean {
  return ALLOWED_EXACT_PATHS.has(pathname) || ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isKnownSearchBot(userAgent: string): boolean {
  const value = userAgent.toLowerCase();
  return KNOWN_SEARCH_BOTS.some((bot) => value.includes(bot));
}

function isSuspiciousUserAgent(userAgent: string): boolean {
  const value = userAgent.toLowerCase();
  if (!value.trim()) return true;
  if (isKnownSearchBot(value)) return false;
  return SUSPICIOUS_USER_AGENTS.some((agent) => value.includes(agent));
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'local';
}

function isProtectedDataPath(pathname: string): boolean {
  return PROTECTED_DATA_PATHS.includes(pathname) || pathname.startsWith('/jobs/');
}

function hasSameOriginFetchMetadata(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  const mode = request.headers.get('sec-fetch-mode');
  if (!site && !mode) return false;
  return (site === 'same-origin' || site === 'same-site' || site === 'none') && mode !== 'navigate';
}

function hasValidDataClientHeader(request: Request): boolean {
  return request.headers.get('x-fr-client') === 'web-app';
}

function overRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const current = requestHits.get(key);
  if (!current || current.resetAt <= now) {
    requestHits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function blocked(reason: string): Response {
  return new Response('Forbidden', {
    status: 403,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-security-rule': reason,
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;
  const host = context.request.headers.get('host') || '';
  const userAgent = context.request.headers.get('user-agent') || '';

  const isLocalPreview = host.startsWith('localhost:') || host.startsWith('127.0.0.1:');
  const ip = clientIp(context.request);
  const protectedDataPath = isProtectedDataPath(pathname);

  if (!isLocalPreview && /:[0-9]+$/.test(host)) {
    return blocked('blocked-host-with-port');
  }

  if (overRateLimit(`${ip}:all`, GENERAL_RATE_LIMIT)) {
    return new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '60', 'x-security-rule': 'rate-limit-general' } });
  }

  if (protectedDataPath) {
    if (overRateLimit(`${ip}:data`, DATA_RATE_LIMIT)) {
      return new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '60', 'x-security-rule': 'rate-limit-data' } });
    }
    if (!hasValidDataClientHeader(context.request) || (!isLocalPreview && !hasSameOriginFetchMetadata(context.request))) {
      return blocked('blocked-direct-data-access');
    }
  }

  if (HASH_SCAN_PATH.test(pathname)) {
    return blocked('blocked-random-hash-path');
  }

  if (!isAllowedPath(pathname) && SUSPICIOUS_PATHS.some((pattern) => pattern.test(pathname))) {
    return blocked('blocked-suspicious-path');
  }

  if (!isAllowedPath(pathname)) {
    return blocked('blocked-non-whitelisted-path');
  }

  if (isSuspiciousUserAgent(userAgent)) {
    return blocked('blocked-suspicious-user-agent');
  }

  const response = await context.next();
  const secured = new Response(response.body, response);
  secured.headers.set('x-content-type-options', 'nosniff');
  secured.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  secured.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if (protectedDataPath) {
    secured.headers.set('cache-control', 'no-store');
    secured.headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  }
  return secured;
};
