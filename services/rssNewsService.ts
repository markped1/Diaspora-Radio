/**
 * RSS News Service — Nigeria Diaspora Radio
 *
 * Uses rss2json.com (free, no key needed) to fetch RSS as clean JSON.
 * Articles are scored and sorted into 3 priority tiers:
 *
 *   Tier 1 — LOCAL BREAKING  (score 70–100)  → always top
 *   Tier 2 — DIASPORA        (score 30–69)   → middle
 *   Tier 3 — GENERAL         (score 0–29)    → bottom
 */

import { NewsItem } from '../types';
import { rewriteArticlesForBroadcast } from './newsAIService';

const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

// Only feeds confirmed working (no CORS block, returns items)
const RSS_FEEDS = [
  { url: 'https://premiumtimesng.com/feed',                    name: 'Premium Times'    },
  { url: 'https://saharareporters.com/rss.xml',                name: 'Sahara Reporters' },
  { url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml', name: 'BBC Africa'       },
];

// ─── Tier 1: Local Nigerian breaking news ────────────────────────────────────
const LOCAL_KEYWORDS = [
  'breaking', 'just in', 'alert', 'urgent', 'developing',
  'nigeria', 'nigerian', 'abuja', 'lagos', 'port harcourt',
  'kano', 'ibadan', 'enugu', 'imo', 'delta', 'rivers state',
  'tinubu', 'senate', 'house of reps', 'naira', 'cbn', 'nnpc',
  'efcc', 'dss', 'army', 'police', 'election', 'inec',
  'governor', 'minister', 'federal government', 'supreme court',
  'flood', 'explosion', 'attack', 'kidnap', 'rescue', 'crash',
  'fuel', 'electricity', 'power outage',
];

// ─── Tier 2: Diaspora / international Nigerian news ───────────────────────────
const DIASPORA_KEYWORDS = [
  'diaspora', 'abroad', 'overseas', 'international', 'foreign',
  'deported', 'deportation', 'detained', 'arrested abroad',
  'visa', 'immigration', 'asylum', 'refugee', 'citizenship',
  'remittance', 'nigerian in', 'nigerians in',
  'nigerian student', 'nigerian doctor', 'nigerian nurse',
  'nigerian footballer', 'nigerian community',
  'nigerian man', 'nigerian woman', 'nigerian family',
  // Countries
  'united states', 'usa', 'america', 'washington', 'new york',
  'united kingdom', 'uk', 'britain', 'london', 'manchester',
  'canada', 'toronto', 'australia', 'sydney', 'melbourne',
  'germany', 'berlin', 'italy', 'rome', 'milan',
  'spain', 'madrid', 'france', 'paris',
  'netherlands', 'amsterdam', 'ireland', 'dublin',
  'south africa', 'johannesburg', 'ghana', 'accra',
  'malaysia', 'kuala lumpur', 'india', 'new delhi', 'mumbai',
  'china', 'beijing', 'shanghai', 'guangzhou',
  'indonesia', 'jakarta', 'brazil', 'sao paulo',
  'argentina', 'uae', 'dubai', 'abu dhabi',
  'saudi arabia', 'qatar', 'doha',
  'europe', 'european union', 'south america', 'latin america', 'asia',
];

// ─── Depressors: hyper-local non-breaking stories ────────────────────────────
const DEPRESSORS = [
  'traffic', 'road closure', 'market price',
  'local government', 'ward', 'councillor', 'lga', 'state assembly',
];

function scoreArticle(title: string, content: string): { score: number; tier: 1 | 2 | 3 } {
  const text = `${title} ${content}`.toLowerCase();

  let localHits    = LOCAL_KEYWORDS.filter(kw => text.includes(kw)).length;
  let diasporaHits = DIASPORA_KEYWORDS.filter(kw => text.includes(kw)).length;
  let depHits      = DEPRESSORS.filter(kw => text.includes(kw)).length;

  // Breaking + diaspora = still Tier 1 (e.g. "Nigerian arrested in Malaysia")
  if (localHits >= 2 && diasporaHits >= 1) {
    return { score: Math.min(85 + diasporaHits * 2, 100), tier: 1 };
  }
  if (localHits >= 2) {
    return { score: Math.min(70 + localHits * 3 - depHits * 5, 100), tier: 1 };
  }
  if (diasporaHits >= 1) {
    return { score: Math.min(30 + diasporaHits * 8, 69), tier: 2 };
  }
  return { score: Math.max(0, localHits * 5 - depHits * 3), tier: 3 };
}

function mapCategory(title: string, content: string): NewsItem['category'] {
  const t = `${title} ${content}`.toLowerCase();
  if (t.match(/sport|football|soccer|super eagle|afcon|premier league/)) return 'Sports';
  if (t.match(/economy|naira|cbn|inflation|gdp|trade|market|stock/))     return 'Economy';
  if (t.match(/culture|music|nollywood|fashion|art|festival/))           return 'Culture';
  if (t.match(/diaspora|abroad|overseas|nigerian in|nigerians in/))      return 'Diaspora';
  if (t.match(/nigeria|abuja|lagos|federal|senate|tinubu/))              return 'Nigeria';
  return 'Global';
}

interface Rss2JsonItem {
  title: string;
  description: string;
  pubDate: string;
  link: string;
}

// ─── Content Cleaners ─────────────────────────────────────────────────────────

/**
 * Cleans a headline: removes "BREAKING:", "JUST IN:", "ALERT:", "EXCLUSIVE:" prefixes,
 * and trailing source attributions like "- Premium Times".
 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^(breaking\s*news\s*[:\-–]?\s*|breaking\s*[:\-–]\s*|just\s*in\s*[:\-–]\s*|alert\s*[:\-–]\s*|urgent\s*[:\-–]\s*|exclusive\s*[:\-–]\s*|exclusive\s*)/i, '')
    .replace(/\s*[-–|]\s*(premium times|sahara reporters|bbc|punch|vanguard|guardian).*$/i, '')
    .trim();
}

/**
 * Cleans article body:
 * - Strips "BREAKING:", "EXCLUSIVE:", "JUST IN:" from anywhere in the content
 * - Strips "The post X appeared first on Y." WordPress footers
 * - Strips truncation artifacts like "Pr..." or "Read more..."
 * - Strips HTML entities
 * - Caps at 300 chars on a clean sentence boundary
 */
function cleanContent(raw: string): string {
  let text = raw
    .replace(/\b(breaking\s*news\s*[:\-–]?\s*|breaking\s*[:\-–]\s*|just\s*in\s*[:\-–]\s*|alert\s*[:\-–]\s*|urgent\s*[:\-–]\s*|exclusive\s*[:\-–]\s*|exclusive\s*)/gi, '')
    .replace(/The post .+? appeared first on .+?\./gi, '')
    .replace(/Read (more|full story|the full article)[^.]*\./gi, '')
    .replace(/Click here to read more[^.]*\./gi, '')
    .replace(/\[…\]|\[\.{3}\]|\.{3,}$/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // If text is too short (truncated feed), return what we have
  if (text.length < 40) return text;

  // Cap at 300 chars on a sentence boundary
  if (text.length > 300) {
    const cut = text.substring(0, 300);
    const lastPeriod = cut.lastIndexOf('.');
    text = lastPeriod > 150 ? cut.substring(0, lastPeriod + 1) : cut.trim();
  }

  return text;
}

async function fetchFeed(feedUrl: string, sourceName: string): Promise<NewsItem[]> {
  try {
    // No &count param — requires paid API key on rss2json free tier
    const url = `${RSS2JSON}${encodeURIComponent(feedUrl)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (json.status !== 'ok' || !Array.isArray(json.items)) {
      throw new Error(`Bad response: ${json.message || json.status}`);
    }

    return (json.items as Rss2JsonItem[]).map(item => {
      const title   = cleanTitle(item.title?.trim() || '');
      const raw     = item.description?.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim() || '';
      const content = cleanContent(raw) || title;
      const ts      = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();

      return {
        id: Math.random().toString(36).substr(2, 9),
        title,
        content,
        category: mapCategory(title, content),
        timestamp: isNaN(ts) ? Date.now() : ts,
        sources: [sourceName],
      } as NewsItem;
    }).filter(item => item.title.length > 5);

  } catch (err) {
    console.warn(`⚠️ Feed failed (${sourceName}):`, err);
    return [];
  }
}

export async function fetchAndRankNews(): Promise<NewsItem[]> {
  console.log('📡 Fetching RSS feeds...');

  const results = await Promise.allSettled(
    RSS_FEEDS.map(f => fetchFeed(f.url, f.name))
  );

  const all: NewsItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  if (all.length === 0) {
    console.warn('⚠️ All RSS feeds returned empty');
    return [];
  }

  // Deduplicate by first 50 chars of title
  const seen = new Set<string>();
  const unique = all.filter(a => {
    const key = a.title.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Score and sort: Tier 1 → 2 → 3, then score desc within tier
  const scored = unique.map(a => ({ a, ...scoreArticle(a.title, a.content) }));
  scored.sort((x, y) => x.tier !== y.tier ? x.tier - y.tier : y.score - x.score);

  const t1 = scored.filter(s => s.tier === 1).length;
  const t2 = scored.filter(s => s.tier === 2).length;
  const t3 = scored.filter(s => s.tier === 3).length;
  console.log(`✅ RSS ranked: ${scored.length} articles — Breaking: ${t1}, Diaspora: ${t2}, General: ${t3}`);

  const ranked = scored.map(s => s.a);

  // Rewrite articles to be human-readable and TTS-friendly via Gemini
  const rewritten = await rewriteArticlesForBroadcast(ranked);
  return rewritten;
}
