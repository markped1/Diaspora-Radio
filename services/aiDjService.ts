
import { generateText, withRetry } from './geminiService';
import { webSpeechSpeak } from './webSpeechService';
import { dbService } from './dbService';
import { DjScript, NewsItem } from '../types';
import { NEWSCASTER_NAME, APP_NAME } from '../constants';
import { WeatherData } from './newsAIService';

// ─── Callbacks for ducking control ───────────────────────────────────────────
let _onSpeechStart: (() => void) | null = null;
let _onSpeechEnd: (() => void) | null = null;
let _onSetMusicVolume: ((vol: number) => void) | null = null;
let _onStopMusic: (() => void) | null = null;
let _onResumeMusic: (() => void) | null = null;

export function registerSpeechCallbacks(
  onStart: () => void,
  onEnd: () => void,
  onSetMusicVolume?: (vol: number) => void,
  onStopMusic?: () => void,
  onResumeMusic?: () => void,
) {
  _onSpeechStart = onStart;
  _onSpeechEnd = onEnd;
  _onSetMusicVolume = onSetMusicVolume || null;
  _onStopMusic = onStopMusic || null;
  _onResumeMusic = onResumeMusic || null;
}

// ─── Transition phrases between stories ──────────────────────────────────────
// Used to make the bulletin sound like real broadcasting, not a numbered list
const HEADLINE_TRANSITIONS = [
  'In our top story,',
  'Also making news,',
  'On another story,',
  'In other news,',
  'Turning now to,',
  'We are also following,',
  'Meanwhile,',
  'In a related development,',
  'Across the diaspora,',
  'From the international desk,',
  'And in sports news,',
  'On the economic front,',
];

const DETAIL_TRANSITIONS = [
  'With more on that story,',
  'In full detail,',
  'Here is the full report,',
  'Our correspondent reports that',
  'More on that story now.',
  'The full details are as follows.',
];

function getTransition(index: number, category?: string): string {
  if (index === 0) return 'In our top story,';
  if (category === 'Sports') return 'And in sports news,';
  if (category === 'Economy') return 'On the economic front,';
  if (category === 'Diaspora') return 'Across the diaspora,';
  return HEADLINE_TRANSITIONS[index % HEADLINE_TRANSITIONS.length];
}

function getDetailTransition(index: number): string {
  return DETAIL_TRANSITIONS[index % DETAIL_TRANSITIONS.length];
}

// ─── DJ Segment ──────────────────────────────────────────────────────────────
export async function generateDjSegment(): Promise<DjScript> {
  return withRetry(async () => {
    const prompt = `Write a 15-second radio bridge for ${APP_NAME}. 
    Host: ${NEWSCASTER_NAME}. 
    Mention the diaspora community and our voice abroad. Keep it high energy and warm.`;

    const systemInstruction = `You are ${NEWSCASTER_NAME}, the voice of ${APP_NAME}. Your tone is professional, sophisticated, and distinctively Nigerian.`;

    const scriptText = await generateText(prompt, systemInstruction);
    const djScript: DjScript = {
      id: Math.random().toString(36).substr(2, 9),
      script: scriptText,
      timestamp: Date.now()
    };
    await dbService.addScript(djScript);
    return djScript;
  });
}

// ─── Build the 30-minute headline bulletin (headlines only, no details) ───────
function buildHeadlineBulletin(
  newsItems: NewsItem[],
  weather?: WeatherData
): string {
  const lines: string[] = [];
  lines.push(`Good day, I am ${NEWSCASTER_NAME}, and you are listening to ${APP_NAME} — the voice of Nigerians abroad.`);
  lines.push(`Here is a summary of the headlines at this hour.`);
  if (weather) {
    lines.push(`A quick look at the weather: in ${weather.location}, expect ${weather.condition} conditions with temperatures around ${weather.temp}.`);
  }
  newsItems.forEach((item, i) => {
    lines.push(`${getTransition(i, item.category)} ${item.title}.`);
  });
  lines.push(
    `Those are your headlines. Stay with us on ${APP_NAME} for the full bulletin at the top of the hour, ` +
    `where ${NEWSCASTER_NAME} will bring you the complete stories.`
  );
  lines.push(
    `Thank you for tuning in to ${APP_NAME} — Nigeria's voice abroad. ` +
    `We encourage you to remain with us for more informative and entertaining programming. ` +
    `I am ${NEWSCASTER_NAME}. Stay tuned.`
  );
  return lines.join(' ');
}

// ─── Phase 1: Opening + headlines (music ducked) ─────────────────────────────
function buildHeadlinesOnly(
  newsItems: NewsItem[],
  weather: WeatherData | undefined,
  localTime: string,
  location: string
): string {
  const lines: string[] = [];
  lines.push(`Good day and welcome. The time is ${localTime} and you are listening to ${APP_NAME} — the voice of Nigerians abroad.`);
  lines.push(`I am ${NEWSCASTER_NAME}, and here is your news bulletin.`);
  if (weather) {
    lines.push(
      `Before we go into the news, a look at the weather. ` +
      `In ${weather.location}, we are currently seeing ${weather.condition} conditions with a temperature of ${weather.temp}. ` +
      `Do plan your day accordingly.`
    );
  }
  lines.push(`Here now are the headlines.`);
  newsItems.forEach((item, i) => {
    lines.push(`${getTransition(i, item.category)} ${item.title}.`);
  });
  lines.push(`And now, the details behind those stories.`);
  return lines.join(' ');
}

// ─── Phase 2: Full story details (music stopped) ─────────────────────────────
function buildDetailsOnly(newsItems: NewsItem[]): string {
  const lines: string[] = [];
  newsItems.forEach((item, i) => {
    const transition = i === 0 ? `Starting with our top story.` : getDetailTransition(i);
    lines.push(`${transition} ${item.title}. ${item.content}`);
  });
  return lines.join(' ');
}

// ─── Phase 3: Sign-off (music still stopped) ─────────────────────────────────
function buildSignoff(): string {
  return (
    `And that brings us to the end of this bulletin. ` +
    `On behalf of everyone here at ${APP_NAME}, I am ${NEWSCASTER_NAME}, ` +
    `and I want to sincerely thank you for staying tuned to Nigeria Diaspora Radio and Television. ` +
    `We are your connection to home, wherever in the world you may be. ` +
    `Please do remain with us for more informative and entertaining programming coming up right after this. ` +
    `This is ${APP_NAME} — Nigeria's voice abroad. Stay tuned.`
  );
}

// ─── Build the top-of-hour detailed bulletin (kept for reference) ─────────────
function buildDetailedBulletin(
  newsItems: NewsItem[],
  localTime: string,
  location: string,
  weather?: WeatherData
): string {
  return [
    buildHeadlinesOnly(newsItems, weather, localTime, location),
    buildDetailsOnly(newsItems),
    buildSignoff(),
  ].join(' ');
}

// ─── Bulletin Audio ───────────────────────────────────────────────────────────
export async function getDetailedBulletinAudio(params: {
  location: string;
  localTime: string;
  newsItems: NewsItem[];
  weather?: WeatherData;
  isBrief?: boolean;
}): Promise<Uint8Array | null> {
  const { location, localTime, newsItems, weather, isBrief } = params;

  if (isBrief) {
    // ── 30-MIN BULLETIN: headlines only, music ducked to 15% throughout ──
    const script = buildHeadlineBulletin(newsItems, weather);

    _onSetMusicVolume?.(0.15); // Duck music for headlines
    _onSpeechStart?.();

    await webSpeechSpeak(script, { rate: 0.90 });

    _onSpeechEnd?.();
    _onResumeMusic?.(); // Restore music after headlines

  } else {
    // ── TOP-OF-HOUR BULLETIN: headlines ducked, details music stopped ──
    const headlinesScript = buildHeadlinesOnly(newsItems, weather, localTime, location);
    const detailsScript   = buildDetailsOnly(newsItems);
    const signoffScript   = buildSignoff();

    // Phase 1 — Headlines: duck music to 15%
    _onSetMusicVolume?.(0.15);
    _onSpeechStart?.();
    await webSpeechSpeak(headlinesScript, { rate: 0.90 });

    // Phase 2 — Details: stop music completely
    _onStopMusic?.();
    await webSpeechSpeak(detailsScript, { rate: 0.90 });

    // Phase 3 — Sign-off: still silent
    await webSpeechSpeak(signoffScript, { rate: 0.90 });

    _onSpeechEnd?.();
    _onResumeMusic?.(); // Music resumes after outro jingle (handled in App.tsx)
  }

  return new Uint8Array(1);
}

// ─── Single News Item / Custom Broadcast ─────────────────────────────────────
export async function getNewsAudio(newsContent: string): Promise<Uint8Array | null> {
  await webSpeechSpeak(newsContent, {
    rate: 0.92,
    onStart: () => _onSpeechStart?.(),
    onEnd:   () => _onSpeechEnd?.(),
  });
  return new Uint8Array(1);
}

// ─── Jingle Audio ─────────────────────────────────────────────────────────────
export async function getJingleAudio(jingleText: string): Promise<Uint8Array | null> {
  await webSpeechSpeak(jingleText, {
    rate: 1.05,
    onStart: () => _onSpeechStart?.(),
    onEnd:   () => _onSpeechEnd?.(),
  });
  return new Uint8Array(1);
}
