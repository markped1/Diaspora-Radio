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

  if (q.match(/listen|play|radio|tune|hear/))
    return `To listen to NDR Radio:\n1. Tap the ▶ play button at the top of the screen\n2. The station will start streaming automatically\n3. Admin must be playing for the stream to be live\n\nYou can also download our Android app from the footer!`;

  if (q.match(/tv|television|channel|watch|video|iptv/))
    return `NDR TV streams live channels including:\n🌍 DW Africa, Al Jazeera, France 24, CGTN\n⚽ Abu Dhabi Sports, Dubai Sports, TRT Spor\n🎬 FilmRise Movies, TRT Belgesel\n🚀 NASA TV, NHK World Japan\n\nAdmin pushes channels live from the TV Studio tab.`;

  if (q.match(/news|bulletin|headline|broadcast/))
    return `NDR broadcasts news bulletins:\n• Full bulletin at the top of every hour (:00)\n• Headlines at :30 past every hour\n• No news midnight–6am (music only)\n\nNews comes from Premium Times, Punch, BBC Africa, Al Jazeera, Channels TV, and more.`;

  if (q.match(/download|app|android|apk|install/))
    return `Download the NDR Android app:\n👉 Scroll to the bottom of the page and tap "Download for Android"\n\nOr visit: github.com/markped1/Diaspora-Radio/releases/latest/download/app-debug.apk\n\niOS version coming soon!`;

  if (q.match(/admin|password|login|manage/))
    return `The Admin panel is password-protected. Tap "Admin Login" in the top-right corner.\n\nAdmin features include:\n• Command Center (play/stop music)\n• TV Studio (push live channels)\n• Newsroom (fetch & broadcast news)\n• Genre Manager (schedule music by genre)\n• Analytics (live listener stats)\n• Media Library (upload tracks)`;

  if (q.match(/genre|afrobeats|amapiano|rnb|gospel|schedule|playlist/))
    return `NDR has genre folders with scheduled time slots:\n🎵 Afrobeats — 12pm–8pm daily\n🎹 Amapiano — 8pm–midnight (Fri/Sat)\n🎤 R&B — 10pm–2am daily\n🙏 Gospel — 6am–10am Sundays\n🎧 Hip-Hop — 6pm–10pm daily\n🌿 Reggae — 2pm–6pm daily\n\nAdmin assigns tracks to genres in the Genre tab.`;

  if (q.match(/report|journalist|community|city/))
    return `You can submit live community reports!\nScroll down to "Journalist HQ" and tap "Report Happenings in your City".\n\nYour report will appear in the Live Community Reports feed for all listeners to see.`;

  if (q.match(/contact|support|help|problem|issue/))
    return `For support with NDR:\n• Use this chat for quick questions\n• Submit a community report for feedback\n• The station is designed by Thompson Obosa\n\nFor technical issues, try refreshing the page or clearing your browser cache.`;

  if (q.match(/who|what is|about|station|ndr/))
    return `${APP_NAME} — ${STATION_TAGLINE}\n\nWe are the voice of Nigerians abroad, broadcasting live radio, TV, and news 24/7 to the Nigerian diaspora worldwide — UK, USA, Canada, Australia, Europe, Middle East, and beyond.\n\nDesigned by Thompson Obosa.`;

  if (q.match(/nigeria|lagos|abuja|naija/))
    return `NDR covers all things Nigerian:\n🇳🇬 Breaking news from Nigeria\n🌍 Diaspora stories worldwide\n⚽ Nigerian sports (Super Eagles, AFCON)\n🎵 Nigerian music (Afrobeats, Amapiano, Highlife)\n📺 African TV channels\n\nWe are your connection to home, wherever you are!`;

  return `I'm NDR Assistant! I can help you with:\n• How to listen to the radio\n• Available TV channels\n• News bulletin schedule\n• Downloading the app\n• Admin features\n• Genre music scheduling\n\nWhat would you like to know?`;
}

const SYSTEM_CONTEXT = `You are NDR Assistant, the official AI helper for ${APP_NAME} — ${STATION_TAGLINE}.

WHO WE ARE:
${APP_NAME} is a digital radio and TV station built specifically for Nigerians living in the diaspora — Nigerians who have left home to live, work, study, or build their lives in other countries around the world. The station exists to serve their needs, keep them connected to home, and give them a platform to reach out to the world and back to Nigeria from wherever they are.

OUR MISSION:
- To be the voice of Nigerians abroad — a bridge between home and the diaspora
- To keep Nigerians in the diaspora informed about what is happening back home in Nigeria
- To celebrate Nigerian culture, music, and identity no matter where our listeners are
- To give diaspora Nigerians a space to share their stories, report from their cities, and stay connected to each other
- To serve as a means for Nigerians worldwide to reach out to the world and back home

OUR AUDIENCE:
Nigerians living in the UK, USA, Canada, Australia, Germany, Italy, Spain, France, Ireland, Netherlands, UAE, Saudi Arabia, Qatar, South Africa, Malaysia, China, Brazil, and every corner of the world where Nigerians have made their home.

WHAT WE OFFER:
1. LIVE RADIO — Music, jingles, and live audio streaming. Genres include Afrobeats, Amapiano, R&B, Hip-Hop, Gospel, Highlife, Reggae, and more. Music is scheduled by genre — for example, Gospel in the morning, Afrobeats in the afternoon, R&B at night.

2. NEWS BULLETINS — Automated news from trusted Nigerian and African sources (Premium Times, Punch, Channels TV, BusinessDay, BBC Africa, Al Jazeera, Africanews). Full bulletin at the top of every hour, headline summary at the half hour. No news midnight to 6am — music only during quiet hours.

3. NDRtv — A live TV screen showing channels the admin pushes live. The admin selects from available IPTV streams or pushes any custom URL. Viewers can watch while listening or separately.

4. COMMUNITY REPORTS — Listeners can submit live reports from their city anywhere in the world, giving diaspora Nigerians a voice on the platform.

5. GENRE MUSIC FOLDERS — Admin organises music by genre with scheduled time slots so the right music plays at the right time of day.

6. ANALYTICS — Admin can see how many listeners are tuned in, where they are in the world, and whether they are watching TV or listening to radio.

HOW TO LISTEN:
- Visit diaspora-radio.vercel.app on any browser
- Download the Android app from the website footer
- Tap the play button — the station starts automatically when admin is broadcasting
- No login needed for listeners

HOW THE TV WORKS:
- The admin pushes a live channel or video to the TV screen from the TV Studio
- Viewers see it automatically on their screen
- Tap the TV screen to show/hide volume controls
- The ticker at the bottom shows live news headlines

ADMIN FEATURES (password protected):
- Command Center: Go Live, stream URL, jingles
- TV Studio: Push any video or IPTV channel live
- Newsroom: Fetch and broadcast news bulletins
- Genre Manager: Organise music by genre and schedule
- Analytics: Live listener and viewer counts by country
- Kill All: Stop all playing instances globally
- Inbox: Read listener community reports
- Logs: Activity history

DESIGNED BY: ${DESIGNER_NAME}
NEWSCASTER: Favour Obosa

TONE: Be warm, proud, and knowledgeable about the Nigerian diaspora experience. Speak like someone who understands what it means to be Nigerian abroad — the longing for home, the pride in culture, the need to stay connected. Keep answers helpful and concise. If asked something outside the app, gently bring the conversation back to how NDR serves the diaspora community.`;

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
