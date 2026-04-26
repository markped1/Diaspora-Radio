/**
 * bookmarkService — Auto-health-check and self-healing bookmarks
 *
 * On load: pings each bookmark through the Cloudflare proxy.
 * Dead ones get flagged. Known fallback domains are tried automatically.
 * Working replacements are saved to localStorage so they persist.
 */

const PROXY = (import.meta as any).env?.VITE_PROXY_URL || '';
const STORAGE_KEY = 'ndr_bookmarks_v2';
const CHECK_TIMEOUT_MS = 8000;

export interface Bookmark {
  name: string;
  url: string;
  logo: string;
  status: 'unknown' | 'ok' | 'dead';
  lastChecked?: number;
}

// ── Master list with known fallback domains per site ─────────────────────────
export const BOOKMARK_DEFINITIONS: Array<{
  name: string;
  logo: string;
  candidates: string[]; // ordered by preference — first working one wins
}> = [
  {
    name: 'Yalla Shoot',
    logo: '⚽',
    candidates: [
      'https://yallashoot.org',
      'https://shoot-yalla.to',
      'https://yallashootenglish.com',
      'https://yalla-shoot.soccer',
      'https://shootyalla.com',
    ],
  },
  {
    name: 'Yalla Live',
    logo: '🎯',
    candidates: [
      'https://shoot.yallatvlive.com',
      'https://yalla-shoot.soccer',
      'https://yallashoot.soccer',
    ],
  },
  {
    name: 'Hesgoal',
    logo: '🏆',
    candidates: [
      'https://hesgoal-vip.to',
      'https://hesgoal7.com',
      'https://hesgoal.im',
      'https://tv.hesgoal-tv.app',
      'https://hesgoal-tv.space',
    ],
  },
  {
    name: 'VIP League',
    logo: '👑',
    candidates: [
      'https://vipleague.im/football',
      'https://vipleague.lc/football',
    ],
  },
  {
    name: 'StreamEast',
    logo: '🌊',
    candidates: [
      'https://streameast.co',
      'https://streameastv2.com',
      'https://istreameast.app',
      'https://streameast.org.uk',
    ],
  },
  {
    name: 'Sportsurge',
    logo: '⚡',
    candidates: [
      'https://sportsurge.surf',
      'https://sportsurge.shop',
      'https://sportsurge.bz',
      'https://sportsurge.ltd',
      'https://sportsurge.bond',
    ],
  },
  {
    name: 'Total Sportek',
    logo: '📡',
    candidates: [
      'https://hesgoal.sbs/totalsportek',
      'https://www.totalsportek.com',
    ],
  },
  {
    name: 'Sporticos',
    logo: '🎯',
    candidates: [
      'https://sporticos.com/en-gb',
      'https://www.sporticos.com',
    ],
  },
  {
    name: 'Live Soccer TV',
    logo: '📺',
    candidates: [
      'https://www.livesoccertv.com',
    ],
  },
  {
    name: 'Ronaldo7',
    logo: '⭐',
    candidates: [
      'https://www.ronaldo7.com',
      'https://ronaldo7.net',
    ],
  },
  {
    name: 'FIFA+',
    logo: '🌍',
    candidates: [
      'https://www.fifa.com/fifaplus',
    ],
  },
];

// ── Ping a URL through the proxy — returns true if reachable ─────────────────
async function ping(url: string): Promise<boolean> {
  try {
    const probeUrl = PROXY
      ? `${PROXY.replace(/\/$/, '')}?url=${encodeURIComponent(url)}`
      : url;

    const res = await fetch(probeUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      cache: 'no-store',
    });
    return res.ok || res.status === 405; // 405 = Method Not Allowed but server is alive
  } catch {
    // HEAD blocked — try GET with a short timeout
    try {
      const probeUrl = PROXY
        ? `${PROXY.replace(/\/$/, '')}?url=${encodeURIComponent(url)}`
        : url;
      const res = await fetch(probeUrl, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── Load saved bookmarks from localStorage ────────────────────────────────────
export function loadSavedBookmarks(): Bookmark[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: Bookmark[] = JSON.parse(raw);
    // Invalidate cache older than 6 hours
    const sixHours = 6 * 60 * 60 * 1000;
    if (parsed[0]?.lastChecked && Date.now() - parsed[0].lastChecked > sixHours) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveBookmarks(bookmarks: Bookmark[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {}
}

// ── Main: check all bookmarks, heal dead ones, return results ─────────────────
export async function checkAndHealBookmarks(
  onProgress?: (name: string, status: 'checking' | 'ok' | 'dead' | 'healed', url: string) => void
): Promise<Bookmark[]> {
  const results: Bookmark[] = [];

  for (const def of BOOKMARK_DEFINITIONS) {
    onProgress?.(def.name, 'checking', def.candidates[0]);

    let workingUrl: string | null = null;

    for (const candidate of def.candidates) {
      const alive = await ping(candidate);
      if (alive) {
        workingUrl = candidate;
        break;
      }
    }

    if (workingUrl) {
      onProgress?.(def.name, workingUrl === def.candidates[0] ? 'ok' : 'healed', workingUrl);
      results.push({ name: def.name, logo: def.logo, url: workingUrl, status: 'ok', lastChecked: Date.now() });
    } else {
      onProgress?.(def.name, 'dead', def.candidates[0]);
      // Keep first candidate as placeholder even if dead
      results.push({ name: def.name, logo: def.logo, url: def.candidates[0], status: 'dead', lastChecked: Date.now() });
    }
  }

  saveBookmarks(results);
  return results;
}
