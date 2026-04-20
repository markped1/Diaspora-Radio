/**
 * NDR API Service
 *
 * Replaces localStorage with Cloudflare Worker API calls.
 * All devices share the same data — admin uploads music, all listeners see it.
 *
 * Set VITE_API_URL in .env.local after deploying the Cloudflare Worker.
 */

const API_URL = import.meta.env.VITE_API_URL || '';

// Falls back to localStorage if API not configured
const hasApi = () => Boolean(API_URL);

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(3000), // 3 second timeout — never block the UI
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// ─── Media ────────────────────────────────────────────────────────────────────

export async function getSharedMedia(): Promise<any[]> {
  if (!hasApi()) return [];
  try {
    return await apiFetch('/media');
  } catch {
    return [];
  }
}

export async function uploadMediaToCloud(file: File, type: 'audio' | 'video' | 'image'): Promise<any | null> {
  if (!hasApi()) return null;
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('name', file.name);
    form.append('type', type);
    const res = await fetch(`${API_URL}/media/upload`, { method: 'POST', body: form });
    const data = await res.json();
    return data.item || null;
  } catch {
    return null;
  }
}

export async function deleteSharedMedia(id: string): Promise<void> {
  if (!hasApi()) return;
  try {
    await apiFetch(`/media/${id}`, { method: 'DELETE' });
  } catch {}
}

// ─── Live State ───────────────────────────────────────────────────────────────

export async function getLiveState(): Promise<{ track: any; messages: any[]; tv: any }> {
  if (!hasApi()) return { track: null, messages: [], tv: null };
  try {
    return await apiFetch('/live');
  } catch {
    return { track: null, messages: [], tv: null };
  }
}

export async function setLiveTrack(track: { url: string; name: string } | null): Promise<void> {
  if (!hasApi()) return;
  try {
    await apiFetch('/live/track', { method: 'PUT', body: JSON.stringify(track) });
  } catch {}
}

export async function setLiveTv(tv: { url: string; name: string } | null): Promise<void> {
  if (!hasApi()) return;
  try {
    await apiFetch('/live/tv', { method: 'PUT', body: JSON.stringify(tv) });
  } catch {}
}

// ─── News ─────────────────────────────────────────────────────────────────────

export async function getSharedNews(): Promise<any[]> {
  if (!hasApi()) return [];
  try {
    return await apiFetch('/news');
  } catch {
    return [];
  }
}

export async function saveSharedNews(news: any[]): Promise<void> {
  if (!hasApi()) return;
  try {
    await apiFetch('/news', { method: 'PUT', body: JSON.stringify(news) });
  } catch {}
}

export { hasApi };
