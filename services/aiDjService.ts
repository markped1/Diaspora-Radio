
import { generateText, withRetry } from './geminiService';
import {
  openBroadcastSession, speakSegment, closeBroadcastSession, webSpeechSpeak,
  isBroadcastActive, isBroadcastPaused, pauseBroadcast, resumeBroadcast,
  stopBroadcast, setBroadcastVolume,
} from './webSpeechService';
import { dbService } from './dbService';
import { DjScript, NewsItem } from '../types';
import { NEWSCASTER_NAME, APP_NAME } from '../constants';
import { WeatherData } from './newsAIService';

// Re-export controls so RadioPlayer can import from one place
export { isBroadcastActive, isBroadcastPaused, pauseBroadcast, resumeBroadcast, stopBroadcast, setBroadcastVolume };

// ─── Music control callbacks ──────────────────────────────────────────────────
let _onSpeechStart: (() => void) | null = null;
let _onSpeechEnd: (() => void) | null = null;
let _onSetMusicVolume: ((vol: number) => void) | null = null;
let _onStopMusic: (() => void) | null = null;

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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const say   = (text: string) => speakSegment(text);

// ─── Transition phrases ───────────────────────────────────────────────────────
const HEADLINE_TRANSITIONS = [
  'In our top story,',
  'Also making news this hour,',
  'On another story,',
  'In other news,',
  'Turning now to another development,',
  'We are also following this story,',
  'Meanwhile,',
  'In a related development,',
  'Across the diaspora,',
  'From our international desk,',
  'And in sports,',
  'On the economic front,',
  'In politics,',
  'And finally in our headlines,',
];

function headlineTransition(index: number, total: number, category?: string): string {
  if (index === 0) return 'In our top story,';
  if (index === total - 1) return 'And finally in our headlines,';
  if (category === 'Sports')   return 'And in sports,';
  if (category === 'Economy')  return 'On the economic front,';
  if (category === 'Diaspora') return 'Across the diaspora,';
  if (category === 'Culture')  return 'On the culture front,';
  return HEADLINE_TRANSITIONS[1 + ((index - 1) % (HEADLINE_TRANSITIONS.length - 1))];
}

// ─── DJ Segment ──────────────────────────────────────────────────────────────
export async function generateDjSegment(): Promise<DjScript> {
  return withRetry(async () => {
    const prompt = `Write a 15-second radio bridge for ${APP_NAME}. Host: ${NEWSCASTER_NAME}. Mention the diaspora community and our voice abroad. Keep it high energy and warm.`;
    const systemInstruction = `You are ${NEWSCASTER_NAME}, the voice of ${APP_NAME}. Your tone is professional, sophisticated, and distinctively Nigerian.`;
    const scriptText = await generateText(prompt, systemInstruction);
    const djScript: DjScript = { id: Math.random().toString(36).substr(2, 9), script: scriptText, timestamp: Date.now() };
    await dbService.addScript(djScript);
    return djScript;
  });
}

// ─── TOP-OF-HOUR FULL BULLETIN ────────────────────────────────────────────────
async function readFullBulletin(newsItems: NewsItem[], localTime: string, location: string, weather?: WeatherData): Promise<void> {
  _onSetMusicVolume?.(0.15);

  await say(`Good day and welcome to Nigeria Diaspora Radio and Television.`);
  await pause(80);
  await say(`The time is ${localTime}. I am ${NEWSCASTER_NAME}, and here is your news bulletin.`);
  await pause(120);

  if (weather) {
    await say(`But first, a look at the weather. In ${weather.location}, we are currently seeing ${weather.condition} conditions with a temperature of ${weather.temp}.`);
    await pause(120);
  }

  await say(`Here now are the headlines.`);
  await pause(80);

  for (let i = 0; i < newsItems.length; i++) {
    await say(`${headlineTransition(i, newsItems.length, newsItems[i].category)} ${newsItems[i].title}.`);
    await pause(60);
  }

  await pause(100);
  await say(`Now the full details on each of those stories.`);
  await pause(100);

  _onStopMusic?.();

  for (let i = 0; i < newsItems.length; i++) {
    const item = newsItems[i];
    if (i === 0) {
      await say(`Starting with our top story. ${item.title}.`);
    } else {
      await say(`${headlineTransition(i, newsItems.length, item.category)} ${item.title}.`);
    }
    await pause(60);

    const sentences = item.content.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
    for (const sentence of sentences) {
      await say(sentence);
      await pause(50);
    }
    await pause(i < newsItems.length - 1 ? 120 : 80);
  }

  await pause(80);
  await say(`That is the news. I am ${NEWSCASTER_NAME}. Thank you for staying tuned to Nigeria Diaspora Radio and Television. We are your connection to home, wherever in the world you may be. Stay tuned.`);
}

// ─── 30-MINUTE HEADLINE BULLETIN ─────────────────────────────────────────────
async function readHeadlineBulletin(newsItems: NewsItem[], weather?: WeatherData): Promise<void> {
  _onSetMusicVolume?.(0.15);

  await say(`Good day. I am ${NEWSCASTER_NAME}, and you are listening to ${APP_NAME}, the voice of Nigerians abroad.`);
  await pause(80);
  await say(`Here is a summary of the headlines at this hour.`);
  await pause(80);

  if (weather) {
    await say(`A quick look at the weather: in ${weather.location}, expect ${weather.condition} conditions with temperatures around ${weather.temp}.`);
    await pause(80);
  }

  for (let i = 0; i < newsItems.length; i++) {
    await say(`${headlineTransition(i, newsItems.length, newsItems[i].category)} ${newsItems[i].title}.`);
    await pause(60);
  }

  await pause(80);
  await say(`Those are your headlines. Join us at the top of the hour for the full bulletin. I am ${NEWSCASTER_NAME}. Stay tuned to ${APP_NAME}.`);
}

// ─── Main bulletin entry point ────────────────────────────────────────────────
export async function getDetailedBulletinAudio(params: {
  location: string; localTime: string; newsItems: NewsItem[]; weather?: WeatherData; isBrief?: boolean;
}): Promise<Uint8Array | null> {
  const { location, localTime, newsItems, weather, isBrief } = params;

  await openBroadcastSession(0.95);
  _onSpeechStart?.();

  try {
    if (isBrief) await readHeadlineBulletin(newsItems, weather);
    else await readFullBulletin(newsItems, localTime, location, weather);
  } finally {
    closeBroadcastSession();
    _onSpeechEnd?.();
  }

  return new Uint8Array(1);
}

// ─── Single News Item / Custom Broadcast ─────────────────────────────────────
export async function getNewsAudio(newsContent: string): Promise<Uint8Array | null> {
  await webSpeechSpeak(newsContent, { rate: 0.92, onStart: () => _onSpeechStart?.(), onEnd: () => _onSpeechEnd?.() });
  return new Uint8Array(1);
}

// ─── Jingle ───────────────────────────────────────────────────────────────────
export async function getJingleAudio(jingleText: string): Promise<Uint8Array | null> {
  // Slower, more human delivery — like a real radio station ID
  // Add a natural pause before and after
  await pause(300);
  await webSpeechSpeak(jingleText, {
    rate: 0.82,       // slower than normal speech — warm, deliberate
    pitch: 0.95,      // slightly lower pitch — more authoritative
    onStart: () => _onSpeechStart?.(),
    onEnd: () => _onSpeechEnd?.(),
  });
  await pause(400);
  return new Uint8Array(1);
}
