import { getUserFromRequest } from './auth/_shared';

type Env = {
  ANALYTICS_DB: D1Database;
  OPENAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  HAI_PROXY_API_KEY?: string;
  HAI_PROXY_BASE_URL?: string;
};

const dailyFreeLimit = 2;

type CandidateCompany = {
  company?: string;
  industry?: string;
  subSector?: string;
  city?: string;
  roles?: string;
  recruitingUrl?: string;
};

type CandidateJob = {
  title?: string;
  company?: string;
  location?: string;
  sourceUrl?: string;
};

type ChatMessage = { role?: 'user' | 'assistant'; content?: string };

type Payload = {
  question?: string;
  history?: ChatMessage[];
  roles?: string[];
  industries?: string[];
  keywords?: string[];
  companies?: CandidateCompany[];
  jobs?: CandidateJob[];
};

function clean(value: unknown, maxLength = 2000): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function compactList<T>(value: unknown, max = 12): T[] {
  return Array.isArray(value) ? value.slice(0, max) as T[] : [];
}

function textFromOpenAIResponse(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts: string[] = [];
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function textFromChatCompletion(data: any): string {
  return clean(data?.choices?.[0]?.message?.content, 5000);
}

async function ensureAiUsageTable(env: Env) {
  await env.ANALYTICS_DB.prepare(
    `CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      usage_date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, usage_date),
      FOREIGN KEY(user_id) REFERENCES app_users(id)
    )`,
  ).run();
  await env.ANALYTICS_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage(user_id, usage_date)`,
  ).run();
}

async function readDailyUsage(env: Env, userId: number, date: string): Promise<number> {
  const row = await env.ANALYTICS_DB.prepare(
    `SELECT count FROM ai_usage WHERE user_id = ? AND usage_date = ? LIMIT 1`,
  ).bind(userId, date).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function incrementDailyUsage(env: Env, userId: number, date: string) {
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO ai_usage (user_id, usage_date, count, updated_at)
     VALUES (?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, usage_date)
     DO UPDATE SET count = count + 1, updated_at = CURRENT_TIMESTAMP`,
  ).bind(userId, date).run();
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserFromRequest(request, env);
  if (!user) {
    return Response.json({ ok: false, error: 'login-required' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }

  await ensureAiUsageTable(env);
  const usageDate = new Date().toISOString().slice(0, 10);
  const usedCount = await readDailyUsage(env, user.id, usageDate);
  if (usedCount >= dailyFreeLimit) {
    return Response.json({
      ok: false,
      error: 'ai-free-limit-reached',
      usage: { count: usedCount, limit: dailyFreeLimit, date: usageDate },
    }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  if (!env.HAI_PROXY_API_KEY && !env.DEEPSEEK_API_KEY && !env.OPENAI_API_KEY) {
    return Response.json({ ok: false, error: 'ai-api-key-missing' }, { status: 503 });
  }

  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const question = clean(payload.question, 500);
  if (!question) return Response.json({ ok: false, error: 'empty-question' }, { status: 400 });

  const history = compactList<ChatMessage>(payload.history, 8).map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: clean(item.content, 1200),
  })).filter((item) => item.content);

  const companies = compactList<CandidateCompany>(payload.companies, 18).map((item) => ({
    company: clean(item.company, 80),
    industry: clean(item.industry, 80),
    subSector: clean(item.subSector, 80),
    city: clean(item.city, 120),
    roles: clean(item.roles, 200),
    recruitingUrl: clean(item.recruitingUrl, 300),
  }));
  const jobs = compactList<CandidateJob>(payload.jobs, 12).map((item) => ({
    title: clean(item.title, 120),
    company: clean(item.company, 80),
    location: clean(item.location, 120),
    sourceUrl: clean(item.sourceUrl, 300),
  }));

  const prompt = `最近对话 JSON：${JSON.stringify(history)}\n\n用户最新问题：${question}\n\n候选岗位方向：${compactList<string>(payload.roles, 8).join('、')}\n候选行业：${compactList<string>(payload.industries, 8).join('、')}\n候选关键词：${compactList<string>(payload.keywords, 10).join('、')}\n\n候选公司 JSON：${JSON.stringify(companies)}\n\n当前可展示岗位 JSON：${JSON.stringify(jobs)}\n\n请用中文回答，像一个耐心、具体、友好的外企求职顾问。要求：\n1. 先用一句自然的话回应用户，不要像报告。\n2. 给 3-5 个推荐岗位方向，并用简单理由解释为什么适合。\n3. 给 4-6 家推荐公司，必须优先从候选公司 JSON 里选，不要编造不存在的公司。\n4. 如果用户在追问，要承接最近对话，不要重新从头介绍。\n5. 推荐不要只按专业，要同时考虑可迁移能力：数据分析、沟通协调、项目管理、英语、销售、运营、供应链、质量、合规、EHS、客户成功等。\n6. 如果当前可展示岗位 JSON 里有岗位，只用自然语言提醒“我也给你放了几个可直接打开的岗位在回答下方”，不要在正文里写 Markdown 链接、裸 URL、[点这里查看] 或重复列出完整链接；岗位卡片会在回答下方单独展示。只有当当前可展示岗位 JSON 为空时，才说“我建议你先去这些公司的官网用这些关键词搜”。\n7. 语气要像聊天建议，少用生硬术语，不要承诺一定能投中。\n8. 最后用一句话邀请用户继续补充背景，例如简历经历、城市、英语水平、想不想转行。\n9. 给一个很具体的下一步行动建议，例如先准备哪些简历关键词、先打开哪类官网入口。
10. 不要使用 Markdown 链接格式；可以使用少量 **加粗** 标出岗位关键词。`;

  const systemPrompt = '你是外企求职顾问。你可以基于用户背景、可迁移能力、提供的公司库和岗位库做推荐。不要编造招聘事实、薪资或福利；公司推荐优先使用提供的候选公司。若提供了可展示岗位，说明下方会展示岗位卡片，不要在正文里重复生成链接。回答要有对话感，能引导用户继续补充信息。';

  if (env.HAI_PROXY_API_KEY) {
    const baseUrl = clean(env.HAI_PROXY_BASE_URL, 200) || 'http://localhost:6655/litellm/v1';
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.HAI_PROXY_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
          max_tokens: 900,
        }),
      });
    } catch (error) {
      return Response.json({ ok: false, error: 'hai-proxy-fetch-failed', detail: error instanceof Error ? error.message : 'fetch failed' }, { status: 502 });
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return Response.json({ ok: false, error: 'hai-proxy-request-failed', detail: data?.error?.message ?? response.statusText }, { status: 502 });
    }

    await incrementDailyUsage(env, user.id, usageDate);
    return Response.json({ ok: true, provider: 'hai-proxy', answer: textFromChatCompletion(data), generatedAt: new Date().toISOString(), usage: { count: usedCount + 1, limit: dailyFreeLimit, date: usageDate } }, { headers: { 'cache-control': 'no-store' } });
  }

  if (env.DEEPSEEK_API_KEY) {
    let response: Response;
    try {
      response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
          max_tokens: 900,
        }),
      });
    } catch (error) {
      return Response.json({ ok: false, error: 'deepseek-fetch-failed', detail: error instanceof Error ? error.message : 'fetch failed' }, { status: 502 });
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return Response.json({ ok: false, error: 'deepseek-request-failed', detail: data?.error?.message ?? response.statusText }, { status: 502 });
    }

    await incrementDailyUsage(env, user.id, usageDate);
    return Response.json({ ok: true, provider: 'deepseek', answer: textFromChatCompletion(data), generatedAt: new Date().toISOString(), usage: { count: usedCount + 1, limit: dailyFreeLimit, date: usageDate } }, { headers: { 'cache-control': 'no-store' } });
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_output_tokens: 900,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return Response.json({ ok: false, error: 'openai-request-failed', detail: data?.error?.message ?? response.statusText }, { status: 502 });
  }

  await incrementDailyUsage(env, user.id, usageDate);
  return Response.json({ ok: true, provider: 'openai', answer: textFromOpenAIResponse(data), generatedAt: new Date().toISOString(), usage: { count: usedCount + 1, limit: dailyFreeLimit, date: usageDate } }, { headers: { 'cache-control': 'no-store' } });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
