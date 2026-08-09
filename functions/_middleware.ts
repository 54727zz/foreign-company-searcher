type PagesContext = {
  request: Request;
  next: () => Promise<Response>;
};

const ALLOWED_EXACT_PATHS = new Set([
  '/',
  '/api/feedback',
  '/api/track',
  '/foreign_companies_by_industry.csv',
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
  /^\/admin/i,
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
  if (!isLocalPreview && /:[0-9]+$/.test(host)) {
    return blocked('blocked-host-with-port');
  }

  if (HASH_SCAN_PATH.test(pathname)) {
    return blocked('blocked-random-hash-path');
  }

  if (SUSPICIOUS_PATHS.some((pattern) => pattern.test(pathname))) {
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
  return secured;
};
