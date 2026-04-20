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

    // Health check — shows KV and R2 status
    if (path === '/' || path === '') {
      return json({
        status: 'NDR API OK',
        kv: env.KV ? 'connected' : 'missing — add KV binding named KV',
        r2: env.MEDIA ? 'connected' : 'missing — add R2 binding named MEDIA'
      });
    }

    if (path === '/live' && request.method === 'GET') {
      const s = await getState(env);
      return json({ track: s.track ?? null, messages: s.messages ?? [], tv: s.tv ?? null });
    }
    if (path === '/media/upload' && request.method === 'POST') {
      if (!env.MEDIA) return json({ error: 'R2 not bound' }, 500);
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        const name = formData.get('name');
        const type = formData.get('type');
        if (!file || !name) return json({ error: 'Missing file/name' }, 400);

        const id = Math.random().toString(36).substr(2, 9);
        await env.MEDIA.put(id, file, { httpMetadata: { contentType: (file as File).type } });
        
        const url = `${url.origin}/media/file/${id}`;
        const item = { id, name, url, type, timestamp: Date.now() };
        
        const s = await getState(env);
        s.media = [item, ...(s.media || [])];
        await setState(env, s);

        return json({ ok: true, item });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }
    if (path.startsWith('/media/file/')) {
      if (!env.MEDIA) return json({ error: 'R2 not bound' }, 500);
      const id = path.replace('/media/file/', '');
      const object = await env.MEDIA.get(id);
      if (!object) return json({ error: 'File not found' }, 404);
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.append('Access-Control-Allow-Origin', '*');
      return new Response(object.body, { headers });
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
