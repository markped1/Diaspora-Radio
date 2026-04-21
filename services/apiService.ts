/**
 * NDR API Service — Supabase backend
 * Real-time sync, no polling needed
 */

const SB_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const hasApi = () => Boolean(SB_URL && SB_KEY);

function h() {
  return {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function sb(path: string, opts: RequestInit = {}): Promise<any> {
  if (!hasApi()) return null;
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...opts,
    headers: { ...h(), ...(opts.headers as any || {}) },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Live State ───────────────────────────────────────────────────────────────

export async function getLiveState(): Promise<{ track: any; messages: any[]; tv: any; stream: string }> {
  if (!hasApi()) return { track: null, messages: [], tv: null, stream: '' };
  try {
    const rows = await sb('/live_state?id=eq.1&select=*');
    if (rows?.length) {
      const r = rows[0];
      return { track: r.track ?? null, messages: r.messages ?? [], tv: r.tv ?? null, stream: r.stream ?? '' };
    }
    return { track: null, messages: [], tv: null, stream: '' };
  } catch { return { track: null, messages: [], tv: null, stream: '' }; }
}

async function patchLive(patch: Record<string, any>): Promise<void> {
  if (!hasApi()) return;
  try {
    await sb('/live_state?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
  } catch (e) { console.warn('patchLive failed:', e); }
}

export async function setLiveTrack(track: { url: string; name: string } | null): Promise<void> {
  await patchLive({ track });
}

export async function setLiveTv(tv: any | null): Promise<void> {
  await patchLive({ tv });
}

export async function setLiveStream(stream: string): Promise<void> {
  await patchLive({ stream });
}

// ─── Media ────────────────────────────────────────────────────────────────────

export async function getSharedMedia(): Promise<any[]> {
  if (!hasApi()) return [];
  try {
    const rows = await sb('/media?select=*&order=created_at.desc');
    return rows || [];
  } catch { return []; }
}

export async function addMediaToCloud(item: { id: string; name: string; url: string; type: string; timestamp: number }): Promise<void> {
  if (!hasApi()) return;
  try {
    await sb('/media', {
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
  } catch (e) { console.warn('addMediaToCloud failed:', e); }
}

export async function deleteSharedMedia(id: string): Promise<void> {
  if (!hasApi()) return;
  try { await sb(`/media?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch {}
}

export async function updateMediaInCloud(id: string, patch: Record<string, any>): Promise<void> {
  if (!hasApi()) return;
  try {
    await sb(`/media?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  } catch {}
}

// ─── News ─────────────────────────────────────────────────────────────────────

export async function setSharedStreamUrl(stream: string): Promise<void> {
  await setLiveStream(stream);
}

export async function getSharedNews(): Promise<any[]> { return []; }
export async function saveSharedNews(_news: any[]): Promise<void> {}
export async function uploadMediaToCloud(_file: File, _type: string): Promise<any> { return null; }
