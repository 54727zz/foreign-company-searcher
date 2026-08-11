import { getUserFromRequest } from './_shared';
import type { Env } from './_shared';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserFromRequest(request, env);
  if (!user) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  return Response.json({ ok: true, user });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204 });
