/**
 * NDR Supabase Service
 * Replaces Cloudflare Worker API with Supabase real-time database
 * Free tier: 500MB database, real-time subscriptions, no credit card
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const hasSupabase = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function headers() {
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function sbFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers as any) },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${path} failed: ${res.status} ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Live State ───────────────────────────────────────────────────────────────
// Uses a single row in `live_state` table with id=1

export async function getLiveState(): Promise<{ track: any; messages: any[]; tv: any; stream: string }> {
  if (!hasSupabase()) return { track: null, messages: [], tv: null, stream: '' };
  try {
    const rows = await sbFetch('/live_state?id=eq.1&select=*');
    if (rows && rows.length > 0) {
      const row = rows[0];
      return {
        track: row.track || null,
        messages: row.messages || [],
        tv: row.tv || null,
        stream: row.stream || '',
      };
    }
    return { track: null, messages: [], tv: null, stream: '' };
  } catch {
    return { track: null, messages: [], tv: null, stream: '' };
  }
}

async function upsertLiveState(patch: Record<string, any>): Promise<void> {
  if (!hasSupabase()) return;
  try {
    await sbFetch('/live_state?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  } catch {
    // Row might not exist — try insert
    try {
      await sbFetch('/live_state', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' } as any,
        body: JSON.stringify({ id: 1, ...patch }),
      });
    } catch (e) {
      console.warn('upsertLiveState failed:', e);
    }
  }
}

export async function setLiveTrack(track: { url: string; name: string } | null): Promise<void> {
  await upsertLiveState({ track });
}

export async function setLiveTv(tv: any | null): Promise<void> {
  await upsertLiveState({ tv });
}

export async function setLiveStream(stream: string): Promise<void> {
  await upsertLiveState({ stream });
}

// ─── Media ────────────────────────────────────────────────────────────────────

export async function getSharedMedia(): Promise<any[]> {
  if (!hasSupabase()) return [];
  try {
    const rows = await sbFetch('/media?select=*&order=created_at.desc');
    return rows || [];
  } catch {
    return [];
  }
}

export async function addMediaToCloud(item: { id: string; name: string; url: string; type: string; timestamp: number }): Promise<void> {
  if (!hasSupabase()) return;
  try {
    await sbFetch('/media', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=ignore-duplicates' } as any,
      body: JSON.stringify({
        id: item.id,
        name: item.name,
        url: item.url,
        type: item.type,
        created_at: new Date(item.timestamp).toISOString(),
      }),
    });
  } catch (e) {
    console.warn('addMediaToCloud failed:', e);
  }
}

export async function deleteSharedMedia(id: string): Promise<void> {
  if (!hasSupabase()) return;
  try {
    await sbFetch(`/media?id=eq.${id}`, { method: 'DELETE' });
  } catch {}
}

export async function updateMediaInCloud(id: string, patch: Record<string, any>): Promise<void> {
  if (!hasSupabase()) return;
  try {
    await sbFetch(`/media?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  } catch {}
}

// ─── Real-time subscription ───────────────────────────────────────────────────
// Supabase real-time via WebSocket — instant updates instead of polling

let realtimeWs: WebSocket | null = null;

export function subscribeToLiveState(onUpdate: (state: any) => void): () => void {
  if (!hasSupabase()) return () => {};

  const wsUrl = SUPABASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');
  const ws = new WebSocket(`${wsUrl}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`);
  realtimeWs = ws;

  ws.onopen = () => {
    // Join the live_state channel
    ws.send(JSON.stringify({
      topic: 'realtime:public:live_state',
      event: 'phx_join',
      payload: {},
      ref: '1',
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.event === 'UPDATE' || msg.event === 'INSERT') {
        const record = msg.payload?.record;
        if (record) {
          onUpdate({
            track: record.track || null,
            messages: record.messages || [],
            tv: record.tv || null,
            stream: record.stream || '',
          });
        }
      }
    } catch {}
  };

  ws.onerror = () => {};
  ws.onclose = () => {};

  return () => {
    ws.close();
    realtimeWs = null;
  };
}

export { hasSupabase };
