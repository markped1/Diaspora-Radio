/**
 * bookmarkService — Auto-health-check and self-healing bookmarks
 *
 * On load: pings each bookmark through the Cloudflare proxy.
 * Dead ones get flagged. Known fallback domains are tried automatically.
 * Working replacements are saved to localStorage so they persist.
 */

const PROXY = (import.meta as any).env?.VITE_PROXY_URL || '';
const STORAGE_KEY = 'ndr_bookmarks_v4';
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
];

// ── Ping a URL — returns true if reachable, defaults to true on ambiguous errors ─
async function ping(url: string): Promise<boolean> {
  try {
    // Try a no-cors fetch — won't give us response details but won't throw on CORS blocks
    // A DNS failure or connection refused WILL throw
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',       // avoids CORS errors — we just want to know if server exists
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    return true; // no-cors fetch resolves (even opaque) = server is alive
  } catch (err: any) {
    const msg = (err?.message || '').toLowerCase();
    // Only mark dead on clear DNS/network failure
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('net::err') ||
      msg.includes('aborted') ||
      err?.name === 'AbortError'
    ) {
      return false;
    }
    // Any other error (CORS, 4xx, 5xx) = server exists, just blocks us
    return true;
  }
}

// ── Load saved bookmarks from localStorage ────────────────────────────────────
export function loadSavedBookmarks(): Bookmark[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: Bookmark[] = JSON.parse(raw);
    // Reject cache if all entries are dead (bad check result)
    if (parsed.every(b => b.status === 'dead')) { localStorage.removeItem(STORAGE_KEY); return null; }
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
