import { getUserFromRequest } from './_shared';
import type { Env } from './_shared';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  // 查会员到期时间
  const row = await env.ANALYTICS_DB.prepare(
    `SELECT member_expires_at FROM app_users WHERE id = ? LIMIT 1`,
  ).bind(user.id).first<{ member_expires_at: string | null }>();

  const memberExpiresAt = row?.member_expires_at ?? null;
  const isMember = !!memberExpiresAt && memberExpiresAt > new Date().toISOString();

  return Response.json({
    ok: true,
    user: {
      ...user,
      isMember,
      memberExpiresAt: isMember ? memberExpiresAt : null,
    },
  });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
