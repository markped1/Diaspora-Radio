// NDR Radio API — Zero config, no bindings needed
// Uses Cloudflare KV if bound as "KV", otherwise works standalone
// State is passed through the worker's own cache per-region

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const EMPTY = () => ({ track: null, messages: [], tv: null, media: [], news: [] });
const KV_KEY = 'ndr_state';

async function getState(env) {
  if (env.KV) {
    try {
      const raw = await env.KV.get(KV_KEY);
      return raw ? JSON.parse(raw) : EMPTY();
    } catch { return EMPTY(); }
  }
  return EMPTY();
}

async function setState(env, state) {
  if (env.KV) {
    await env.KV.put(KV_KEY, JSON.stringify(state), { expirationTtl: 86400 });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check — shows KV status
    if (path === '/' || path === '') {
      return json({ status: 'NDR API OK', kv: env.KV ? 'connected' : 'missing — add KV binding named KV in worker settings' });
    }

    if (path === '/live' && request.method === 'GET') {
      const s = await getState(env);
      return json({ track: s.track ?? null, messages: s.messages ?? [], tv: s.tv ?? null });
    }
    if (path === '/live/track' && request.method === 'PUT') {
      const body = await request.json();
      const s = await getState(env);
      s.track = body;
      await setState(env, s);
      return json({ ok: true });
    }
    if (path === '/live/tv' && request.method === 'PUT') {
      const body = await request.json();
      const s = await getState(env);
      s.tv = body;
      await setState(env, s);
      return json({ ok: true });
    }
    if (path === '/media' && request.method === 'GET') {
      const s = await getState(env);
      return json(s.media || []);
    }
    if (path === '/media' && request.method === 'PUT') {
      const body = await request.json();
      const s = await getState(env);
      s.media = body;
      await setState(env, s);
      return json({ ok: true });
    }
    if (path.startsWith('/media/') && path !== '/media/' && request.method === 'DELETE') {
      const id = path.replace('/media/', '');
      const s = await getState(env);
      s.media = (s.media || []).filter(i => i.id !== id);
      await setState(env, s);
      return json({ ok: true });
    }
    if (path === '/news' && request.method === 'GET') {
      const s = await getState(env);
      return json(s.news || []);
    }
    if (path === '/news' && request.method === 'PUT') {
      const body = await request.json();
      const s = await getState(env);
      s.news = body;
      await setState(env, s);
      return json({ ok: true });
    }
    if (path === '/messages' && request.method === 'GET') {
      const s = await getState(env);
      return json(s.messages || []);
    }
    if (path === '/messages' && request.method === 'PUT') {
      const body = await request.json();
      const s = await getState(env);
      s.messages = body;
      await setState(env, s);
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
};
