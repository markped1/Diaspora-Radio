// NDR Radio API — uses Cloudflare KV for persistent shared state
// KV binding name: KV  (set in Worker Settings → Bindings → KV Namespace → name: KV)

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

async function getState(env) {
  try {
    const raw = await env.KV.get('ndr_state');
    if (!raw) return { track: null, messages: [], tv: null, media: [], news: [] };
    return JSON.parse(raw);
  } catch {
    return { track: null, messages: [], tv: null, media: [], news: [] };
  }
}

async function setState(env, state) {
  await env.KV.put('ndr_state', JSON.stringify(state), { expirationTtl: 86400 });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // Check KV binding exists
    if (!env.KV) {
      return json({ error: 'KV binding not found. Add KV binding named "KV" in Worker Settings → Bindings.' }, 500);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // GET /live
    if (path === '/live' && request.method === 'GET') {
      const state = await getState(env);
      return json({ track: state.track ?? null, messages: state.messages ?? [], tv: state.tv ?? null });
    }

    // PUT /live/track
    if (path === '/live/track' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState(env);
      state.track = body;
      await setState(env, state);
      return json({ ok: true });
    }

    // PUT /live/tv
    if (path === '/live/tv' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState(env);
      state.tv = body;
      await setState(env, state);
      return json({ ok: true });
    }

    // GET /media
    if (path === '/media' && request.method === 'GET') {
      const state = await getState(env);
      return json(state.media || []);
    }

    // PUT /media
    if (path === '/media' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState(env);
      state.media = body;
      await setState(env, state);
      return json({ ok: true });
    }

    // DELETE /media/:id
    if (path.startsWith('/media/') && path !== '/media/' && request.method === 'DELETE') {
      const id = path.replace('/media/', '');
      const state = await getState(env);
      state.media = (state.media || []).filter(i => i.id !== id);
      await setState(env, state);
      return json({ ok: true });
    }

    // GET /news
    if (path === '/news' && request.method === 'GET') {
      const state = await getState(env);
      return json(state.news || []);
    }

    // PUT /news
    if (path === '/news' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState(env);
      state.news = body;
      await setState(env, state);
      return json({ ok: true });
    }

    // GET /messages
    if (path === '/messages' && request.method === 'GET') {
      const state = await getState(env);
      return json(state.messages || []);
    }

    // PUT /messages
    if (path === '/messages' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState(env);
      state.messages = body;
      await setState(env, state);
      return json({ ok: true });
    }

    // GET / — health check
    return json({ status: 'NDR API OK', kv: 'connected' });
  },
};
