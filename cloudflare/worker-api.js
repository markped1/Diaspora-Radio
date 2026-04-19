// NDR Radio API - No KV binding needed, uses Cloudflare Cache API
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

// Use Cloudflare Cache API as storage (no bindings needed)
const CACHE_KEY = 'https://ndr-state.internal/';

async function getState() {
  const cache = caches.default;
  const res = await cache.match(CACHE_KEY);
  if (!res) return { track: null, messages: [], tv: null, media: [], news: [] };
  return res.json();
}

async function setState(state) {
  const cache = caches.default;
  await cache.put(CACHE_KEY, new Response(JSON.stringify(state), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' }
  }));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // GET /live
    if (path === '/live' && request.method === 'GET') {
      const state = await getState();
      return json({ track: state.track, messages: state.messages, tv: state.tv });
    }

    // PUT /live/track
    if (path === '/live/track' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState();
      state.track = body;
      await setState(state);
      return json({ ok: true });
    }

    // PUT /live/tv
    if (path === '/live/tv' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState();
      state.tv = body;
      await setState(state);
      return json({ ok: true });
    }

    // GET /media
    if (path === '/media' && request.method === 'GET') {
      const state = await getState();
      return json(state.media || []);
    }

    // PUT /media
    if (path === '/media' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState();
      state.media = body;
      await setState(state);
      return json({ ok: true });
    }

    // DELETE /media/:id
    if (path.startsWith('/media/') && request.method === 'DELETE') {
      const id = path.replace('/media/', '');
      const state = await getState();
      state.media = (state.media || []).filter(i => i.id !== id);
      await setState(state);
      return json({ ok: true });
    }

    // GET /news
    if (path === '/news' && request.method === 'GET') {
      const state = await getState();
      return json(state.news || []);
    }

    // PUT /news
    if (path === '/news' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState();
      state.news = body;
      await setState(state);
      return json({ ok: true });
    }

    // GET /messages
    if (path === '/messages' && request.method === 'GET') {
      const state = await getState();
      return json(state.messages || []);
    }

    // PUT /messages
    if (path === '/messages' && request.method === 'PUT') {
      const body = await request.json();
      const state = await getState();
      state.messages = body;
      await setState(state);
      return json({ ok: true });
    }

    return json({ status: 'NDR API OK' });
  },
};
