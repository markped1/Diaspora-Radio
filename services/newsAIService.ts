
import { getAIClient, withRetry } from './geminiService';
import { fetchAndRankNews } from './rssNewsService';
import { dbService } from './dbService';
import { NewsItem } from '../types';

export interface WeatherData {
  condition: string;
  temp: string;
  location: string;
}

// ─── Weather fetch (Gemini only — RSS doesn't provide weather) ────────────────
async function fetchWeather(locationLabel: string): Promise<WeatherData | undefined> {
  try {
    const ai = getAIClient();
    const prompt = `What is the current weather in ${locationLabel}?
Return ONLY a JSON object with no markdown, no code fences:
{"condition":"Sunny","temp":"32°C","location":"Lagos, Nigeria"}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
    });

    const raw = (response.text || '').replace(/```json|```/gi, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as WeatherData;
  } catch (e) {
    console.warn('⚠️ Weather fetch failed:', e);
  }
  return undefined;
}

// ─── Gemini fallback — used only when all RSS feeds fail ─────────────────────
async function fetchNewsFromGemini(
  locationLabel: string,
  existingNews: NewsItem[]
): Promise<NewsItem[]> {
  return withRetry(async () => {
    try {
      const ai = getAIClient();
      const prompt = `You are a news aggregator for Nigeria Diaspora Radio.
Search for the most CURRENT breaking news (strictly last 24 hours).

PRIORITY ORDER (most important first):
1. LOCAL BREAKING: Nigerian politics, economy, security, disasters — top priority
2. DIASPORA: Nigerians in USA, UK, Canada, Australia, Germany, Italy, Spain, France,
   Ireland, Netherlands, Malaysia, India, China, Indonesia, Brazil, Argentina,
   UAE, Saudi Arabia, Qatar, South Africa, and anywhere else worldwide
3. GLOBAL: Major world news affecting Nigerians abroad

Return ONLY valid JSON (no markdown):
{
  "news": [
    { "title": "...", "content": "60-80 word summary", "category": "Nigeria|Diaspora|Sports|Global|Economy|Culture" }
  ]
}
Return at least 8 news items. Local breaking news first, then diaspora, then global.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: { tools: [{ googleSearch: {} }], temperature: 0.3 },
      });

      const raw = (response.text || '').replace(/```json|```/gi, '').trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON found in Gemini response');

      const data = JSON.parse(match[0]);
      const items: NewsItem[] = (data.news || []).map((item: any) => ({
        id: Math.random().toString(36).substr(2, 9),
        title: item.title || 'Untitled',
        content: item.content || '',
        category: (item.category as NewsItem['category']) || 'Global',
        timestamp: Date.now(),
      }));

      console.log(`✅ Gemini fallback: ${items.length} news items`);
      return items;
    } catch (error) {
      console.error('❌ Gemini news fetch failed:', error);
      return existingNews;
    }
  });
}

// ─── Rewrite articles for broadcast (human-readable, TTS-friendly) ───────────
export async function rewriteArticlesForBroadcast(articles: NewsItem[]): Promise<NewsItem[]> {
  if (articles.length === 0) return articles;

  try {
    const ai = getAIClient();

    // Send up to 15 articles at once to save API calls
    const batch = articles.slice(0, 15);
    const input = batch.map((a, i) => `${i + 1}. TITLE: ${a.title}\nCONTENT: ${a.content}`).join('\n\n');

    const prompt = `You are a professional radio news editor for Nigeria Diaspora Radio.

Rewrite each news story below so that:
- It sounds natural when read aloud by a text-to-speech voice
- It is written in clear, complete sentences — no truncation, no "..." endings
- It is rephrased in your own words (do not copy sentences verbatim from the source)
- It is factually accurate to the original story
- It is 2-3 sentences long (40-70 words)
- The title and content must NOT contain the words: "Breaking", "Exclusive", "Just In", "Alert", "Urgent" — remove them entirely
- Do not start with any urgency word or label — go straight into the story
- It reads like a calm, professional radio news bulletin — just the facts

Return ONLY a JSON array with the same number of items, each with "title" and "content":
[{"title":"...","content":"..."}]

Stories to rewrite:
${input}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: { temperature: 0.4 },
    });

    const raw = (response.text || '').replace(/```json|```/gi, '').trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in rewrite response');

    const rewritten: { title: string; content: string }[] = JSON.parse(match[0]);

    // Merge rewritten text back into original articles (preserving category, timestamp etc.)
    const result = articles.map((article, i) => {
      const rw = rewritten[i];
      if (rw?.title && rw?.content) {
        return { ...article, title: rw.title, content: rw.content };
      }
      return article; // Keep original if rewrite failed for this item
    });

    console.log(`✍️ Rewrote ${rewritten.length} articles for broadcast`);
    return result;

  } catch (err) {
    console.warn('⚠️ Article rewrite failed, using originals:', err);
    return articles; // Graceful fallback — use original RSS content
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export async function scanNigerianNewspapers(
  locationLabel: string = 'Global'
): Promise<{ news: NewsItem[]; weather?: WeatherData }> {

  // Quota guard: skip only if news is less than 15 minutes old AND we have articles
  const lastSync = await dbService.getLastSyncTime();
  const refreshThreshold = 15 * 60 * 1000;
  await dbService.cleanupOldNews();
  const existingNews = await dbService.getNews();

  if (lastSync && Date.now() - lastSync < refreshThreshold && existingNews.length > 0) {
    console.log(`⏱ News is fresh (${Math.round((Date.now() - lastSync) / 1000)}s ago). Using cached.`);
    return { news: existingNews };
  }

  // Fetch weather and news in parallel
  const [weather, rssNews] = await Promise.all([
    fetchWeather(locationLabel),
    fetchAndRankNews(),
  ]);

  let finalNews: NewsItem[];

  if (rssNews.length > 0) {
    // RSS succeeded — use ranked results
    finalNews = rssNews;
    console.log(`📰 Using RSS news (${finalNews.length} articles)`);
  } else {
    // RSS failed — fall back to Gemini
    console.warn('📡 RSS failed. Falling back to Gemini...');
    finalNews = await fetchNewsFromGemini(locationLabel, existingNews);
  }

  if (finalNews.length > 0) {
    await dbService.saveNews(finalNews);
  }

  return { news: finalNews, weather };
}
