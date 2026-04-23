import React, { useState, useRef, useEffect } from 'react';
import { getAIClient } from '../services/geminiService';
import { APP_NAME, STATION_TAGLINE, DESIGNER_NAME } from '../constants';

interface Message {
  role: 'user' | 'bot';
  text: string;
  time: string;
}

// ─── Rule-based fallback when Gemini is unavailable ──────────────────────────
function getRuleBasedReply(input: string): string {
  const q = input.toLowerCase();

  // ── Messaging / contact — check FIRST before TV/channel rules ────────────
  if (q.match(/send message|contact|reach|message to|write to|talk to|speak to|email|dm|inbox|communicate/))
    return `There is no direct messaging or private chat with the admin.\n\nTo reach the station, use the Journalist HQ:\n1. Scroll down to "Journalist HQ"\n2. Tap "Report Happenings in your City"\n3. Type your message or report\n4. You can also attach a video or paste a YouTube link\n5. Tap "Broadcast Report" to submit\n\nYour message will appear in the community feed and the admin will see it in the Inbox.`;

  if (q.match(/listen|play|radio|tune|hear/))
    return `To listen to NDR Radio:\n1. Tap the ▶ play button at the top of the screen\n2. The station streams automatically when admin is live\n3. No login needed — just tap and listen\n\nDownload our Android app from the footer!`;

  // ── TV — only match when NOT about messaging ──────────────────────────────
  if (q.match(/\btv\b|television|watch|iptv/) && !q.match(/message|send|contact/))
    return `NDR TV shows whatever the admin pushes live from the TV Studio.\n\nThe TV screen is below the radio player. Tap the screen to show volume controls.\n\nIf it shows "Off Air", the admin hasn't pushed a channel live yet.`;

  if (q.match(/\bchannel\b/) && !q.match(/message|send|contact/))
    return `NDR TV shows live channels pushed by the admin from the TV Studio.\n\nThe admin can push any IPTV stream, YouTube video, or custom URL live to all viewers.`;

  if (q.match(/news|bulletin|headline|broadcast/))
    return `NDR broadcasts news bulletins:\n• Full bulletin every hour at :00\n• Headlines every half hour at :30\n• No news midnight–6am (music only)\n\nSources: Premium Times, Punch, BBC Africa, Al Jazeera, Channels TV, and more.`;

  if (q.match(/download|app|android|apk|install/))
    return `Download the NDR Android app:\n👉 Scroll to the bottom of the page\n👉 Tap "Download for Android"\n\niOS version coming soon!`;

  if (q.match(/admin|password|login|manage/))
    return `The Admin panel is password-protected. Tap "Admin Login" in the top-right corner.\n\nAdmin features:\n• Command Center (go live, play music)\n• TV Studio (push live channels)\n• Newsroom (fetch & broadcast news)\n• Genre Manager (schedule music)\n• Analytics (live listener stats)\n• Inbox (read listener reports)`;

  if (q.match(/genre|afrobeats|amapiano|rnb|gospel|schedule|playlist/))
    return `NDR has genre folders with scheduled time slots:\n🎵 Afrobeats — afternoons\n🎹 Amapiano — Friday/Saturday nights\n🎤 R&B — late nights\n🙏 Gospel — Sunday mornings\n🎧 Hip-Hop — evenings\n🌿 Reggae — afternoons\n\nAdmin assigns tracks to genres in the Genre (🎵) tab.`;

  if (q.match(/report|journalist|community|city|video message/))
    return `Submit a community report from your city!\n\n1. Scroll down to "Journalist HQ"\n2. Tap "Report Happenings in your City"\n3. Type your message\n4. Optionally add a video (upload or YouTube link)\n5. Tap "Broadcast Report"\n\nYour report appears live on the station feed!`;

  if (q.match(/who|what is|about|station|ndr/))
    return `${APP_NAME} — ${STATION_TAGLINE}\n\nWe are the voice of Nigerians abroad — a live radio and TV station connecting the Nigerian diaspora worldwide to home and to each other.\n\nDesigned by Thompson Obosa.`;

  if (q.match(/nigeria|lagos|abuja|naija/))
    return `NDR covers all things Nigerian:\n🇳🇬 Breaking news from Nigeria\n🌍 Diaspora stories worldwide\n⚽ Nigerian sports\n🎵 Nigerian music (Afrobeats, Amapiano, Highlife)\n\nWe are your connection to home, wherever you are!`;

  return `I'm NDR Assistant! Ask me about:\n• How to listen to the radio\n• How to watch NDR TV\n• News bulletin schedule\n• How to send a report or video message\n• Downloading the app\n• Admin features\n\nWhat would you like to know?`;
}

const SYSTEM_CONTEXT = `You are NDR Assistant, the official AI helper for ${APP_NAME} (Nigeria Diaspora RadioTv) — ${STATION_TAGLINE}.

IDENTITY & MISSION:
${APP_NAME} is a live digital radio and TV station built exclusively for Nigerians living in the diaspora. It exists to:
- Keep diaspora Nigerians connected to home — news, music, culture
- Give Nigerians abroad a voice to reach out to the world and back home
- Serve as a community platform wherever Nigerians are in the world
- Bridge the gap between Nigeria and the global Nigerian community

The station is designed by Thompson Obosa. The newscaster is Favour Obosa.
Available at: diaspora-radio.vercel.app | Android APK downloadable from the app footer.

═══════════════════════════════════════════
HOW TO LISTEN TO THE RADIO:
═══════════════════════════════════════════
1. Open diaspora-radio.vercel.app on any browser or device
2. The radio player is at the top of the screen
3. Tap the green play button (▶) to start listening
4. No account or login needed — just tap and listen
5. The station plays automatically when the admin is broadcasting
6. Volume slider is next to the play button
7. If you see "No stream available", the admin has not started broadcasting yet

═══════════════════════════════════════════
HOW TO SEND A MESSAGE TO THE CHANNEL / ADMIN:
═══════════════════════════════════════════
Listeners CANNOT send private messages to the admin. However, you can:
1. SUBMIT A COMMUNITY REPORT (TEXT): Scroll down to "Journalist HQ", tap "Report Happenings in your City", type your message, and tap "Broadcast Report".
2. SUBMIT A VIDEO REPORT: In the same Journalist HQ form, tap "Upload Video" to attach a video from your device, OR tap "YouTube Link" to paste a video URL. Then submit.
3. Your report (with or without video) goes live on the station feed and the admin sees it in the Inbox tab.
4. There is NO private messaging or email form — community reports are the only way to reach the station.

═══════════════════════════════════════════
HOW TO WATCH NDR TV:
═══════════════════════════════════════════
1. The TV screen is below the radio player on the listener screen
2. It shows whatever the admin has pushed live from the TV Studio
3. Tap anywhere on the TV screen to show/hide volume controls
4. The scrolling ticker at the bottom shows live news headlines
5. If the TV shows "Off Air", the admin has not pushed any channel live yet
6. TV and radio are independent — you can watch TV while radio plays (TV will be muted automatically when radio is on)

═══════════════════════════════════════════
HOW TO SUBMIT A COMMUNITY REPORT (TEXT OR VIDEO):
═══════════════════════════════════════════
1. Scroll down on the listener screen
2. Find the "Journalist HQ" section
3. Tap "Report Happenings in your City"
4. Enter your name (optional)
5. Type what is happening near you
6. OPTIONALLY ADD A VIDEO:
   - Tap "Upload Video" to record or select a video from your phone/device
   - OR tap "YouTube Link" to paste a YouTube or video URL
7. Tap "Broadcast Report" to submit
8. Your report (with video if attached) appears in the Live Community Reports feed
9. The admin sees all reports including videos in the Inbox tab

VIDEO REPORTS:
- Listeners can submit video evidence, eyewitness footage, or video messages
- Supported: phone camera videos, recorded clips, YouTube links
- Videos are uploaded to cloud storage automatically
- Admin can watch submitted videos directly in the Inbox

═══════════════════════════════════════════
HOW TO DOWNLOAD THE APP:
═══════════════════════════════════════════
1. Scroll to the bottom of the listener screen
2. Find the "Get the App" section
3. Tap the Android button to download the APK directly
4. iOS version is coming soon
5. The app works on all Android phones and tablets

═══════════════════════════════════════════
MUSIC & GENRES:
═══════════════════════════════════════════
- The station plays Nigerian and African music 24/7
- Genres include: Afrobeats, Amapiano, R&B, Hip-Hop, Gospel, Highlife, Reggae, Jazz, Dancehall, Fuji, Juju, Soul
- Music is scheduled by genre — for example: Gospel on Sunday mornings, Afrobeats in the afternoon, R&B and Amapiano at night
- The admin controls what plays and when
- Listeners cannot request songs directly (no request feature currently)

═══════════════════════════════════════════
NEWS BULLETINS:
═══════════════════════════════════════════
- Full news bulletin: every hour at :00 (e.g. 9:00, 10:00, 11:00)
- Headline summary: every half hour at :30 (e.g. 9:30, 10:30)
- NO news from midnight (12:00am) to 6:00am — music only during quiet hours
- News covers: Nigerian politics, economy, diaspora stories, sports, culture, global news affecting Nigerians
- Sources: Premium Times, Punch Nigeria, Channels TV, BusinessDay, BBC Africa, Al Jazeera, Africanews, Complete Sports
- The newscaster is Favour Obosa

═══════════════════════════════════════════
ADMIN FEATURES (for station operators only):
═══════════════════════════════════════════
The admin panel is PASSWORD PROTECTED. Only the station operator has access.
To access: tap "Admin Login" in the top-right corner of the app.

Admin tabs and what they do:
- COMMAND: The main control room. Big play/stop button to go live. Paste a stream URL to broadcast a live radio stream. Play jingles. Import music folders.
- NEWS (Bulletin): Fetch latest news, read individual stories, trigger a full news broadcast manually.
- TV: TV Studio. Push any video, IPTV stream, YouTube link, or custom URL live to all listeners' screens. Has a library of pre-loaded channels.
- SPORTS (⚽): Manage sports channels and push live matches to the TV screen.
- MEDIA: Upload and manage audio tracks (MP3s), videos, and ads. Tracks sync to Cloudinary cloud storage.
- GENRES (🎵): Create genre folders (Afrobeats, Gospel, etc.), assign tracks to genres, set time schedules for when each genre plays.
- ANALYTICS (📊): See how many listeners are tuned in right now, how many are watching TV, which countries they are from, and today's peak listener count.
- INBOX: Read community reports submitted by listeners from around the world.
- LOGS: Full activity history of everything that has happened on the station.
- KILL ALL: Emergency button that stops ALL playing instances globally — radio and TV — for every listener worldwide.

═══════════════════════════════════════════
WHAT LISTENERS CAN AND CANNOT DO:
═══════════════════════════════════════════
LISTENERS CAN:
✅ Listen to live radio (tap play)
✅ Watch live TV (whatever admin pushes)
✅ Submit text community reports from their city
✅ Submit VIDEO reports — upload a video or paste a YouTube link
✅ Share the station link with friends (Invite Friends button)
✅ Download the Android app
✅ Ask this chatbot questions

LISTENERS CANNOT:
❌ Send private messages to the admin
❌ Request specific songs
❌ Control what plays on radio or TV
❌ Access the admin panel (password protected)
❌ Upload content

═══════════════════════════════════════════
IMPORTANT RULES FOR YOUR ANSWERS:
═══════════════════════════════════════════
- If someone asks "how do I send a message to the channel/admin?" — tell them to use the Community Report feature in Journalist HQ. There is NO direct messaging.
- If someone asks about TV channels — explain that the admin pushes channels live from the TV Studio. The viewer sees whatever the admin has selected.
- If someone asks about the admin panel — explain it is password protected and only for the station operator.
- Always be warm, proud of Nigerian culture, and speak like someone who understands the diaspora experience.
- Keep answers focused on NDR and the Nigerian diaspora community.`;

const ChatBot: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'bot',
      text: `Welcome to ${APP_NAME}! 🇳🇬 I'm your NDR Assistant — the voice of Nigerians abroad. Whether you're in London, Houston, Dubai, or anywhere in the world, we're here to keep you connected to home. Ask me anything about the station, how to listen, our music, news, or anything else.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = {
      role: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const ai = getAIClient();
      const history = messages.slice(-6).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      }));

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [
          { role: 'user', parts: [{ text: SYSTEM_CONTEXT }] },
          { role: 'model', parts: [{ text: 'Understood. I am NDR Assistant, ready to help.' }] },
          ...history,
          { role: 'user', parts: [{ text }] },
        ],
        config: { temperature: 0.7, maxOutputTokens: 300 },
      });

      const reply = response.text?.trim() || 'Sorry, I could not get a response. Please try again.';
      setMessages(prev => [...prev, {
        role: 'bot',
        text: reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } catch {
      // Fallback: rule-based responses when Gemini is unavailable
      const reply = getRuleBasedReply(text);
      setMessages(prev => [...prev, {
        role: 'bot',
        text: reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const quickQuestions = [
    'What is NDR?',
    'How do I tune in?',
    'Can I report from my city?',
    'How do I get the app?',
  ];

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-4 z-50 w-12 h-12 rounded-full shadow-2xl flex items-center justify-center transition-all active:scale-95"
        style={{ backgroundColor: '#008751' }}
        aria-label="Open NDR Assistant"
      >
        {open
          ? <i className="fas fa-times text-white text-lg" />
          : <i className="fas fa-comment-dots text-white text-lg" />}
        {!open && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
            <span className="text-[6px] font-black text-white">AI</span>
          </span>
        )}
      </button>

      {/* Chat window */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-green-100 flex flex-col overflow-hidden"
          style={{ height: '420px' }}>

          {/* Header */}
          <div className="px-4 py-3 flex items-center space-x-2 border-b border-green-50" style={{ backgroundColor: '#008751' }}>
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
              <i className="fas fa-robot text-white text-sm" />
            </div>
            <div>
              <p className="text-[10px] font-black text-white uppercase tracking-widest">NDR Assistant</p>
              <p className="text-[7px] text-white/70">Always here to help</p>
            </div>
            <div className="ml-auto flex items-center space-x-1">
              <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse" />
              <span className="text-[6px] text-white/70 font-black uppercase">Online</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  msg.role === 'user'
                    ? 'bg-[#008751] text-white rounded-br-sm'
                    : 'bg-white text-gray-800 border border-gray-100 shadow-sm rounded-bl-sm'
                }`}>
                  <p className="text-[9px] leading-relaxed">{msg.text}</p>
                  <p className={`text-[6px] mt-1 ${msg.role === 'user' ? 'text-white/60 text-right' : 'text-gray-400'}`}>
                    {msg.time}
                  </p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex space-x-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick questions — only show when no conversation yet */}
          {messages.length === 1 && (
            <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex flex-wrap gap-1">
              {quickQuestions.map(q => (
                <button key={q} onClick={() => { setInput(q); setTimeout(send, 50); }}
                  className="text-[7px] font-black uppercase bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded-full hover:bg-green-100 transition-colors">
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 py-2 border-t border-gray-100 bg-white flex items-center space-x-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask me anything..."
              className="flex-1 bg-gray-50 border border-gray-200 rounded-full px-3 py-2 text-[9px] outline-none focus:border-green-400"
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white disabled:opacity-40 transition-all active:scale-95"
              style={{ backgroundColor: '#008751' }}
            >
              <i className="fas fa-paper-plane text-[9px]" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatBot;
