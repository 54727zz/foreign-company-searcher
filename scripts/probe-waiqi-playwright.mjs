import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const targetUrl = process.argv[2] ?? 'https://www.waiqi.com/company';
const outDir = 'work/waiqi/playwright-probe';

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
});

const requests = [];
page.on('request', (request) => {
  const url = request.url();
  if (/waiqi|offerxiansheng|foreign|company|position|info|api|list|search/i.test(url)) {
    requests.push({
      method: request.method(),
      url,
      resourceType: request.resourceType(),
      headers: request.headers(),
      postData: request.postData(),
    });
  }
});

const responses = [];
page.on('response', async (response) => {
  const url = response.url();
  if (!/waiqi|offerxiansheng|foreign|company|position|info|api|list|search/i.test(url)) return;
  const item = { url, status: response.status(), contentType: response.headers()['content-type'] ?? '' };
  responses.push(item);
  if (/json|text|javascript/.test(item.contentType) && responses.length < 80) {
    try {
      const text = await response.text();
      const safeName = Buffer.from(url).toString('base64url').slice(0, 120);
      await fs.writeFile(`${outDir}/${safeName}.txt`, text.slice(0, 500000));
    } catch {
      // Some responses cannot be read after navigation; ignore.
    }
  }
});

let error = '';
try {
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
}

await page.waitForTimeout(5000).catch(() => undefined);

const snapshot = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  bodyText: document.body.innerText.slice(0, 200000),
  links: Array.from(document.querySelectorAll('a')).slice(0, 500).map((a) => ({ text: a.textContent?.trim() ?? '', href: a.href })),
  buttons: Array.from(document.querySelectorAll('button')).slice(0, 300).map((b) => b.textContent?.trim() ?? ''),
})).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));

await page.screenshot({ path: `${outDir}/screenshot.png`, fullPage: true }).catch(() => undefined);
await fs.writeFile(`${outDir}/snapshot.json`, JSON.stringify({ targetUrl, error, snapshot, requests, responses }, null, 2));
await browser.close();

console.log(JSON.stringify({ targetUrl, error, title: snapshot.title, finalUrl: snapshot.url, requestCount: requests.length, responseCount: responses.length, outDir }, null, 2));
