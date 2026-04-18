/**
 * Web Speech API - Text to Speech
 * Zero cost, zero setup, works in all modern browsers and Android WebView (Capacitor).
 *
 * Returns a Promise that resolves when speech finishes, so callers can await it
 * just like the old Uint8Array-based flow.
 */

// Preferred voices in priority order (best Nigerian/African English first)
const PREFERRED_VOICES = [
  'en-NG',        // Nigerian English (rare but exists on some Android devices)
  'en-ZA',        // South African English — closest accent widely available
  'en-GB',        // British English — cleaner than US for broadcast feel
  'en-AU',        // Australian English
  'en-US',        // Fallback
];

let cachedVoice: SpeechSynthesisVoice | null = null;

function getBestVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;

  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  for (const lang of PREFERRED_VOICES) {
    const match = voices.find(v => v.lang.startsWith(lang));
    if (match) {
      cachedVoice = match;
      return match;
    }
  }

  // Last resort: any English voice
  const anyEnglish = voices.find(v => v.lang.startsWith('en'));
  if (anyEnglish) {
    cachedVoice = anyEnglish;
    return anyEnglish;
  }

  return voices[0] ?? null;
}

/**
 * Speaks the given text using the Web Speech API.
 * Returns a Promise that resolves when speech ends (or rejects on error).
 * onStart / onEnd callbacks allow the caller to trigger audio ducking.
 */
export function webSpeechSpeak(
  text: string,
  options: {
    rate?: number;
    pitch?: number;
    volume?: number;
    onStart?: () => void;
    onEnd?: () => void;
  } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      console.error('Web Speech API not supported in this browser.');
      resolve(); // Fail silently so the app keeps running
      return;
    }

    // Cancel any ongoing speech before starting new one
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Voice selection
    const voice = getBestVoice();
    if (voice) utterance.voice = voice;

    // Tuning for a broadcast feel
    utterance.rate   = options.rate   ?? 0.92;  // Slightly slower = more authoritative
    utterance.pitch  = options.pitch  ?? 1.0;
    utterance.volume = options.volume ?? 1.0;

    utterance.onstart = () => {
      options.onStart?.();
    };

    utterance.onend = () => {
      options.onEnd?.();
      resolve();
    };

    utterance.onerror = (event) => {
      // Always call onEnd to ensure ducking is released no matter what
      options.onEnd?.();
      if (event.error === 'interrupted' || event.error === 'canceled') {
        resolve();
        return;
      }
      console.error('Web Speech error:', event.error);
      resolve(); // Resolve instead of reject so the app keeps running
    };

    // Voices may not be loaded yet on first call — wait for them
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        cachedVoice = null; // Reset cache so we pick up newly loaded voices
        const v = getBestVoice();
        if (v) utterance.voice = v;
        window.speechSynthesis.speak(utterance);
      }, { once: true });
    } else {
      window.speechSynthesis.speak(utterance);
    }
  });
}

/**
 * Stop any currently playing speech immediately.
 */
export function webSpeechStop(): void {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Returns true if the browser supports the Web Speech API.
 */
export function isWebSpeechSupported(): boolean {
  return 'speechSynthesis' in window;
}
