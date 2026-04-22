/**
 * Analytics Service — tracks listener sessions and pushes counts to Supabase
 */

import { dbService } from './dbService';
import { hasApi } from './apiService';

export interface ListenerSession {
  id: string;
  region: string;
  country: string;
  city: string;
  device: 'mobile' | 'desktop' | 'tablet';
  startedAt: number;
  lastSeen: number;
  isWatching: boolean; // true = TV, false = radio only
}

export interface AnalyticsSnapshot {
  totalListeners: number;
  tvViewers: number;
  radioListeners: number;
  regions: Record<string, number>; // region -> count
  countries: Record<string, number>;
  peakToday: number;
  updatedAt: number;
}

const SESSION_KEY = 'ndr_listener_session';
const ANALYTICS_KEY = 'ndr_analytics_snapshot';

// ── Detect device type ────────────────────────────────────────────────────────
function detectDevice(): 'mobile' | 'desktop' | 'tablet' {
  const ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

// ── Get or create session ID ──────────────────────────────────────────────────
function getSessionId(): string {
  let id = sessionStorage.getItem('ndr_session_id');
  if (!id) {
    id = Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
    sessionStorage.setItem('ndr_session_id', id);
  }
  return id;
}

// ── Fetch geo from free IP API ────────────────────────────────────────────────
async function getGeoInfo(): Promise<{ region: string; country: string; city: string }> {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return {
      region: data.continent_code || data.region || 'Unknown',
      country: data.country_name || 'Unknown',
      city: data.city || 'Unknown',
    };
  } catch {
    return { region: 'Unknown', country: 'Unknown', city: 'Unknown' };
  }
}

// ── Register this listener session ───────────────────────────────────────────
export async function registerSession(isWatching = false): Promise<void> {
  if (!hasApi()) return;
  try {
    const geo = await getGeoInfo();
    const session: ListenerSession = {
      id: getSessionId(),
      region: geo.region,
      country: geo.country,
      city: geo.city,
      device: detectDevice(),
      startedAt: Date.now(),
      lastSeen: Date.now(),
      isWatching,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    await pushSessionToSupabase(session);
  } catch { /* silent */ }
}

// ── Update session (heartbeat) ────────────────────────────────────────────────
export async function updateSession(isWatching: boolean): Promise<void> {
  if (!hasApi()) return;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) { await registerSession(isWatching); return; }
    const session: ListenerSession = JSON.parse(raw);
    session.lastSeen = Date.now();
    session.isWatching = isWatching;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    await pushSessionToSupabase(session);
  } catch { /* silent */ }
}

// ── Push session to Supabase listener_sessions table ─────────────────────────
async function pushSessionToSupabase(session: ListenerSession): Promise<void> {
  const SB_URL = import.meta.env.VITE_SUPABASE_URL || '';
  const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (!SB_URL || !SB_KEY) return;

  await fetch(`${SB_URL}/rest/v1/listener_sessions`, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: session.id,
      region: session.region,
      country: session.country,
      city: session.city,
      device: session.device,
      started_at: new Date(session.startedAt).toISOString(),
      last_seen: new Date(session.lastSeen).toISOString(),
      is_watching: session.isWatching,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

// ── Fetch analytics for admin ─────────────────────────────────────────────────
export async function fetchAnalytics(): Promise<AnalyticsSnapshot> {
  const SB_URL = import.meta.env.VITE_SUPABASE_URL || '';
  const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  const empty: AnalyticsSnapshot = {
    totalListeners: 0, tvViewers: 0, radioListeners: 0,
    regions: {}, countries: {}, peakToday: 0, updatedAt: Date.now(),
  };

  if (!SB_URL || !SB_KEY) return empty;

  try {
    // Active sessions = last_seen within 2 minutes
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const res = await fetch(
      `${SB_URL}/rest/v1/listener_sessions?last_seen=gte.${cutoff}&select=*`,
      {
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    const sessions: any[] = await res.json();
    if (!Array.isArray(sessions)) return empty;

    const regions: Record<string, number> = {};
    const countries: Record<string, number> = {};
    let tvViewers = 0;

    for (const s of sessions) {
      const r = s.region || 'Unknown';
      const c = s.country || 'Unknown';
      regions[r] = (regions[r] || 0) + 1;
      countries[c] = (countries[c] || 0) + 1;
      if (s.is_watching) tvViewers++;
    }

    // Store peak
    const saved = localStorage.getItem(ANALYTICS_KEY);
    const prev: AnalyticsSnapshot = saved ? JSON.parse(saved) : empty;
    const peak = Math.max(prev.peakToday, sessions.length);

    const snapshot: AnalyticsSnapshot = {
      totalListeners: sessions.length,
      tvViewers,
      radioListeners: sessions.length - tvViewers,
      regions,
      countries,
      peakToday: peak,
      updatedAt: Date.now(),
    };
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return empty;
  }
}
