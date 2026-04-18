/**
 * Web Speech API - TTS
 *
 * Voice priority: picks the most natural-sounding neural voice available.
 * On Windows: Microsoft voices (Aria, Jenny, Guy) are neural and sound human.
 * On Android: Google voices are decent.
 * On Mac/iOS: Samantha/Karen are the best available.
 *
 * Tuning for broadcast feel:
 *   rate  0.88 — slightly slower than natural speech, authoritative
 *   pitch 0.95 — slightly lower, more gravitas
 */

// Preferred voice name substrings — checked in order, first match wins
// These are the neural/natural voices available on most platforms
const VOICE_PRIORITY = [
  // Windows neural voices (best quality)
  'Microsoft Aria',
  'Microsoft Jenny',
  'Microsoft Guy',
  'Microsoft Natasha',
  'Microsoft Libby',
  'Microsoft Ryan',
  'Microsoft Sonia',
  // Google neural voices (Android/Chrome)
  'Google UK English Female',
  'Google UK English Male',
  'Google US English',
  // Apple voices (Mac/iOS)
  'Samantha',
  'Karen',
  'Daniel',
  'Moira',
  // Generic fallbacks
  'en-GB',
  'en-AU',
  'en-ZA',
  'en-NG',
  'en-US',
];

let cachedVoice: SpeechSynthesisVoice | null = null;

function getBestVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Try name matches first (neural voices)
  for (const name of VOICE_PRIORITY) {
    const match = voices.find(v =>
      v.name.toLowerCase().includes(name.toLowerCase()) ||
      v.lang.startsWith(name)
    );
    if (match) {
      console.log(`🎙️ Selected voice: ${match.name} (${match.lang})`);
      cachedVoice = match;
      return match;
    }
  }

  // Last resort: any English voice
  const eng = voices.find(v => v.lang.startsWith('en'));
  if (eng) { cachedVoice = eng; return eng; }
  return voices[0] ?? null;
}

async function ensureVoicesLoaded(): Promise<void> {
  if (window.speechSynthesis.getVoices().length > 0) return;
  await new Promise<void>(resolve => {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      cachedVoice = null;
      resolve();
    }, { once: true });
    setTimeout(resolve, 2000);
  });
}

// ─── Session state ────────────────────────────────────────────────────────────
let _isSpeaking  = false;
let _isPaused    = false;
let _isCancelled = false;
let _volume      = 1.0;
let _rate        = 0.88;

export function isBroadcastActive(): boolean { return _isSpeaking; }
export function isBroadcastPaused(): boolean { return _isPaused; }

export function pauseBroadcast(): void {
  if (_isSpeaking && !_isPaused) {
    _isPaused = true;
    window.speechSynthesis.pause();
  }
}

export function resumeBroadcast(): void {
  if (_isSpeaking && _isPaused) {
    _isPaused = false;
    window.speechSynthesis.resume();
  }
}

export function stopBroadcast(): void {
  _isCancelled = true;
  _isSpeaking  = false;
  _isPaused    = false;
  window.speechSynthesis.cancel();
}

export function setBroadcastVolume(vol: number): void {
  _volume = Math.max(0, Math.min(1, vol));
}

export function webSpeechStop(): void { stopBroadcast(); }
export function isWebSpeechSupported(): boolean { return 'speechSynthesis' in window; }

// ─── Speak one utterance ──────────────────────────────────────────────────────
function speakOne(text: string, rate: number, pitch: number, vol: number): Promise<void> {
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    const v = getBestVoice();
    if (v) u.voice = v;
    u.rate   = rate;
    u.pitch  = pitch;
    u.volume = vol;
    u.onend   = () => resolve();
    u.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('TTS:', e.error, '|', text.substring(0, 40));
      }
      resolve();
    };
    window.speechSynthesis.speak(u);
  });
}

// ─── Chunk splitter ───────────────────────────────────────────────────────────
function toChunks(text: string, max = 180): string[] {
  const out: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let cur = '';
  for (const s of sentences) {
    const t = s.trim();
    if (!t) continue;
    if ((cur + ' ' + t).trim().length <= max) {
      cur = (cur + ' ' + t).trim();
    } else {
      if (cur) out.push(cur);
      if (t.length > max) {
        const parts = t.split(/,\s*/);
        let sub = '';
        for (const p of parts) {
          if ((sub + ', ' + p).trim().length <= max) { sub = sub ? sub + ', ' + p : p; }
          else { if (sub) out.push(sub); sub = p; }
        }
        cur = sub;
      } else { cur = t; }
    }
  }
  if (cur) out.push(cur);
  return out.filter(c => c.trim().length > 0);
}

// ─── Session API ──────────────────────────────────────────────────────────────
export async function openBroadcastSession(rate = 0.88): Promise<void> {
  window.speechSynthesis.cancel();
  await new Promise(r => setTimeout(r, 100));
  await ensureVoicesLoaded();
  _isSpeaking  = true;
  _isPaused    = false;
  _isCancelled = false;
  _rate        = rate;
}

export async function speakSegment(text: string): Promise<void> {
  if (!_isSpeaking || _isCancelled) return;

  while (_isPaused && !_isCancelled) await new Promise(r => setTimeout(r, 150));
  if (_isCancelled) return;

  const chunks = toChunks(text);
  for (const chunk of chunks) {
    if (_isCancelled) break;
    while (_isPaused && !_isCancelled) await new Promise(r => setTimeout(r, 150));
    if (_isCancelled) break;
    await speakOne(chunk, _rate, 0.95, _volume);
    if (!_isCancelled) await new Promise(r => setTimeout(r, 60));
  }
}

export function closeBroadcastSession(): void {
  _isSpeaking  = false;
  _isPaused    = false;
  _isCancelled = false;
  window.speechSynthesis.cancel();
}

// ─── Legacy single-call speak (jingles, custom broadcasts) ───────────────────
export async function webSpeechSpeak(
  text: string,
  options: { rate?: number; pitch?: number; volume?: number; onStart?: () => void; onEnd?: () => void; } = {}
): Promise<void> {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  await new Promise(r => setTimeout(r, 100));
  await ensureVoicesLoaded();

  const rate  = options.rate  ?? 0.92;
  const pitch = options.pitch ?? 0.95;
  const vol   = options.volume ?? _volume;

  options.onStart?.();
  const chunks = toChunks(text);
  for (const chunk of chunks) {
    await speakOne(chunk, rate, pitch, vol);
    await new Promise(r => setTimeout(r, 60));
  }
  options.onEnd?.();
}
