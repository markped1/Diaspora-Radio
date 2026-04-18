/**
 * Azure Cognitive Services Text-to-Speech
 * Free tier: 500,000 characters/month (F0)
 * Voice: en-NG-EzinneNeural (Nigerian English, Female)
 *
 * Setup:
 * 1. Go to https://portal.azure.com
 * 2. Create a "Speech" resource (choose F0 free tier)
 * 3. Copy your Key and Region into .env.local
 */

const AZURE_TTS_KEY = import.meta.env.VITE_AZURE_TTS_KEY;
const AZURE_TTS_REGION = import.meta.env.VITE_AZURE_TTS_REGION;

// Nigerian English voices available on Azure
// en-NG-EzinneNeural  — Female, warm and professional (recommended)
// en-NG-AbeoNeural    — Male, authoritative
const DEFAULT_VOICE = 'en-NG-EzinneNeural';

function buildSSML(text: string, voice: string = DEFAULT_VOICE): string {
  // Escape XML special characters to prevent SSML injection
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  return `<speak version='1.0' xml:lang='en-NG'>
    <voice xml:lang='en-NG' xml:gender='Female' name='${voice}'>
      <prosody rate='0%' pitch='0%'>
        ${escaped}
      </prosody>
    </voice>
  </speak>`;
}

/**
 * Converts text to speech using Azure TTS and returns raw audio bytes (MP3).
 * Returns null if the API key is not configured or the request fails.
 */
export async function azureTextToSpeech(
  text: string,
  voice: string = DEFAULT_VOICE
): Promise<Uint8Array | null> {
  if (!AZURE_TTS_KEY || !AZURE_TTS_REGION) {
    console.error(
      '❌ Azure TTS not configured. Add VITE_AZURE_TTS_KEY and VITE_AZURE_TTS_REGION to .env.local'
    );
    return null;
  }

  const endpoint = `https://${AZURE_TTS_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = buildSSML(text, voice);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_TTS_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'NigeriaDiasporaRadio',
      },
      body: ssml,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Azure TTS error ${response.status}:`, errorText);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    console.error('Azure TTS request failed:', error);
    return null;
  }
}

/**
 * Returns true if Azure TTS credentials are present in the environment.
 */
export function isAzureTtsConfigured(): boolean {
  return Boolean(AZURE_TTS_KEY && AZURE_TTS_REGION);
}
