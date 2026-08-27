type Env = {
  ANALYTICS_DB: D1Database;
  ADMIN_PASSWORD?: string;
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 验证管理员密码
  const expected = env.ADMIN_PASSWORD;
  const token = readBearerToken(request);
  if (!expected || !token || !timingSafeEqual(token, expected)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { phone?: string; months?: number; action?: string };
  const phone = body.phone?.trim();
  const months = body.months ?? 1;
  const action = body.action ?? 'grant'; // grant | revoke

  if (!phone) {
    return Response.json({ ok: false, error: 'phone required' }, { status: 400 });
  }

  // 查找用户
  const user = await env.ANALYTICS_DB.prepare(
    `SELECT id, phone, member_expires_at FROM app_users WHERE phone = ? LIMIT 1`,
  ).bind(phone).first<{ id: number; phone: string; member_expires_at: string | null }>();

  if (!user) {
    return Response.json({ ok: false, error: 'user-not-found', message: `手机号 ${phone} 未注册` }, { status: 404 });
  }

  if (action === 'revoke') {
    // 撤销会员
    await env.ANALYTICS_DB.prepare(
      `UPDATE app_users SET member_expires_at = NULL WHERE id = ?`,
    ).bind(user.id).run();
    return Response.json({ ok: true, action: 'revoked', phone });
  }

  // 开通会员：从当前时间或已有到期时间往后顺延 N 个月
  const base = user.member_expires_at && user.member_expires_at > new Date().toISOString()
    ? user.member_expires_at  // 已是会员，顺延
    : new Date().toISOString(); // 非会员，从现在开始

  const expires = new Date(base);
  expires.setMonth(expires.getMonth() + months);
  const expiresAt = expires.toISOString();

  await env.ANALYTICS_DB.prepare(
    `UPDATE app_users SET member_expires_at = ? WHERE id = ?`,
  ).bind(expiresAt, user.id).run();

  return Response.json({
    ok: true,
    action: 'granted',
    phone,
    months,
    member_expires_at: expiresAt,
    message: `已为 ${phone} 开通 ${months} 个月会员，到期：${expiresAt.slice(0, 10)}`,
  });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
