
import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import SponsoredVideo from './SponsoredVideo';
import IptvPlayer from './IptvPlayer';
import { NewsItem, MediaFile, AdminMessage, ListenerReport } from '../types';
import { dbService } from './../services/dbService';
import { CHANNEL_INTRO, DESIGNER_NAME, APP_NAME } from '../constants';

interface ListenerViewProps {
  news: NewsItem[];
  onStateChange: (isPlaying: boolean) => void;
  isRadioPlaying: boolean;
  sponsoredVideos: MediaFile[];
  activeTrackUrl: string | null;
  currentTrackName: string;
  adminMessages: AdminMessage[];
  reports: ListenerReport[];
  onPlayTrack: (track: MediaFile) => void;
}

// Memoized TV screen — only re-renders when currentAd or tvAudioOn actually changes
const TvScreen = memo(({ currentAd, tvAudioOn, isRadioPlaying, nextAd }: {
  currentAd: MediaFile | null;
  tvAudioOn: boolean;
  isRadioPlaying: boolean;
  nextAd: () => void;
}) => {
  // TV audio is active only when tvAudioOn AND radio is not playing
  const tvHasAudio = tvAudioOn && !isRadioPlaying;

  if (!currentAd) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950 space-y-2">
        <span className="text-3xl font-black text-gray-800">NDRtv</span>
        <span className="text-[7px] font-black text-gray-700 uppercase tracking-widest">Off Air</span>
      </div>
    );
  }
  if (currentAd.type === 'image') {
    return <img src={currentAd.url} className="w-full h-full object-cover" alt="ad" />;
  }
  if (currentAd.type === 'iptv') {
    return <IptvPlayer url={currentAd.url} muted={!tvHasAudio} autoPlay className="w-full h-full object-contain" />;
  }
  if (currentAd.type === 'youtube' && currentAd.url.includes('youtube.com/embed')) {
    return (
      <iframe
        key={currentAd.id}
        src={currentAd.url.includes('?') ? currentAd.url + '&mute=0' : currentAd.url + '?mute=0'}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title={currentAd.name}
      />
    );
  }
  if (currentAd.type === 'youtube') {
    return (
      <div className="w-full h-full bg-gray-900 flex flex-col items-center justify-center space-y-3 p-4">
        <span className="text-4xl">⚽</span>
        <p className="text-[8px] font-black text-white uppercase text-center">Live Match Available</p>
        <button onClick={() => window.open(currentAd.url, '_blank')}
          className="bg-red-600 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase flex items-center space-x-2">
          <i className="fas fa-play text-sm"></i><span>Watch Live Match</span>
        </button>
      </div>
    );
  }
  return <SponsoredVideo video={currentAd} onEnded={nextAd} isMutedByRadio={isRadioPlaying} />;
});

const ListenerView: React.FC<ListenerViewProps> = ({ 
  news, 
  sponsoredVideos,
  reports,
  adminMessages = [],
  isRadioPlaying,
  onStateChange,
}) => {
  const [location, setLocation] = useState<string>('Syncing...');
  const [localTime, setLocalTime] = useState<string>('');
  const [reportText, setReportText] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [adIndex, setAdIndex] = useState(0);
  const [shareFeedback, setShareFeedback] = useState('');
  // TV is always visually on but audio is muted when radio is playing
  const [tvAudioOn, setTvAudioOn] = useState(false);
  const [tvVolume, setTvVolume] = useState(0.8);

  const timerRef = useRef<number | null>(null);

  // TV audio is independent — user controls it manually
  const handleTvAudioToggle = () => {
    setTvAudioOn(prev => !prev);
  };

  const liveVideosRef = useRef<MediaFile[]>([]);

  const nextAd = useCallback(() => {
    const live = liveVideosRef.current;
    if (live.length > 1) setAdIndex(prev => (prev + 1) % live.length);
  }, []);

  useEffect(() => {
    const live = sponsoredVideos.filter(v => v.isLive);
    liveVideosRef.current = live;
    // Only start rotation timer if there are multiple items
    if (live.length > 1) {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(nextAd, 20000);
    }
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [adIndex, sponsoredVideos, nextAd]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => setLocation(`Node: ${pos.coords.latitude.toFixed(1)}, ${pos.coords.longitude.toFixed(1)}`), () => setLocation('Global Diaspora'));
    }
    const timer = setInterval(() => setLocalTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleShare = async () => {
    const text = "📻 Tune in to Nigeria Diaspora Radio (NDR)! The voice of Nigerians abroad. Live news and culture. Listen here: ";
    const url = window.location.href.split('?')[0]; 
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Nigeria Diaspora Radio', text, url });
        setShareFeedback('Shared!');
      } else {
        await navigator.clipboard.writeText(`${text}${url}`);
        setShareFeedback('Link Copied!');
      }
    } catch (err) {
      console.warn("Share failed", err);
    } finally {
      setTimeout(() => setShareFeedback(''), 3000);
    }
  };

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportText.trim()) return;
    await dbService.addReport({ 
      id: Math.random().toString(36).substring(2, 9), 
      reporterName: 'Listener', 
      location, 
      content: reportText, 
      timestamp: Date.now() 
    });
    setReportText(''); 
    setIsReporting(false);
    setShareFeedback('Report Sent!');
    setTimeout(() => setShareFeedback(''), 3000);
  };

  const liveVideos = useMemo(() => sponsoredVideos.filter(v => v.isLive), [sponsoredVideos]);
  const adPool = liveVideos;
  const currentAd = useMemo(() => adPool.length > 0 ? adPool[adIndex % adPool.length] : null, [adPool, adIndex]);

  return (
    <div className="flex flex-col space-y-4 pb-8 px-1 text-[#008751] animate-scale-in">
      {/* 1. STATUS BAR */}
      <div className="flex justify-between items-center bg-white p-2 rounded-xl border border-green-100 shadow-sm relative overflow-hidden">
        <div className="flex flex-col z-10">
          <span className="text-[6px] font-black uppercase tracking-widest text-green-600">{location}</span>
          <span className="text-[6px] font-mono text-green-900 font-black">{localTime}</span>
        </div>
        
        <button 
          onClick={handleShare} 
          className="relative z-10 bg-[#008751] hover:bg-green-700 text-white px-4 py-1.5 rounded-full text-[7px] font-black uppercase tracking-widest shadow-md active:scale-95 transition-all flex items-center space-x-2"
        >
          <i className="fas fa-paper-plane"></i>
          <span>{shareFeedback || 'Invite Friends'}</span>
        </button>
        <div className="absolute top-0 right-0 w-16 h-16 bg-green-50/50 rounded-full -mr-8 -mt-8"></div>
      </div>

      {/* NDR TV — LIVE MONITOR */}
      <section className="space-y-0">
        {/* NDR TV Monitor */}
        <div className="bg-black overflow-hidden shadow-2xl" style={{ borderRadius: 0 }}>

          {/* ── TOP BAR: NDRtv + LIVE dot ── */}
          <div className="bg-gray-950 px-3 py-1.5 flex items-center justify-between border-b border-gray-800">
            <span className="text-[11px] font-black text-white tracking-tight">
              <span className="text-red-500">NDR</span>tv
            </span>
            {currentAd ? (
              <div className="flex items-center space-x-1">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                <span className="text-[6px] font-black text-red-400 uppercase tracking-widest">Live</span>
              </div>
            ) : (
              <span className="text-[6px] font-black text-gray-600 uppercase tracking-widest">Off Air</span>
            )}
          </div>

          {/* ── SCREEN ── */}
          <div className="relative bg-black" style={{ height: '276px' }}>
            <TvScreen currentAd={currentAd} tvAudioOn={tvAudioOn} isRadioPlaying={isRadioPlaying} nextAd={nextAd} />
          </div>

          {/* ── BOTTOM CONTROLS ── */}
          <div className="bg-gray-950 border-t border-gray-800 px-3 py-2 space-y-2">
            {/* Play / Pause / Stop + Volume + Expand */}
            <div className="flex items-center justify-between">
              {/* Left: play controls */}
              <div className="flex items-center space-x-2">
                {/* Play/Pause */}
                <button
                  onClick={handleTvAudioToggle}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white transition-all active:scale-90 ${tvAudioOn ? 'bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <i className={`fas ${tvAudioOn ? 'fa-pause' : 'fa-play'} text-[9px] ${!tvAudioOn ? 'ml-0.5' : ''}`}></i>
                </button>
                {/* Stop */}
                <button
                  onClick={() => { setTvAudioOn(false); }}
                  className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white transition-all active:scale-90">
                  <i className="fas fa-stop text-[9px]"></i>
                </button>
                {/* Volume */}
                <div className="flex items-center space-x-1">
                  <i className={`fas ${tvVolume === 0 ? 'fa-volume-mute' : 'fa-volume-up'} text-gray-400 text-[8px]`}></i>
                  <input
                    type="range" min="0" max="1" step="0.05" value={tvVolume}
                    onChange={e => setTvVolume(parseFloat(e.target.value))}
                    className="w-16 h-0.5 accent-red-500 cursor-pointer"
                  />
                </div>
              </div>
              {/* Right: expand */}
              {currentAd && (
                <button
                  onClick={() => {
                    const el = document.getElementById('ndr-tv-screen');
                    if (el?.requestFullscreen) el.requestFullscreen();
                  }}
                  className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white transition-all active:scale-90">
                  <i className="fas fa-expand text-[9px]"></i>
                </button>
              )}
            </div>

            {/* Red scrolling ticker */}
            <div className="bg-red-600 flex items-center overflow-hidden rounded-sm" style={{ height: '20px' }}>
              <div className="shrink-0 flex h-full border-r border-red-700" style={{ width: '24px' }}>
                <div className="flex-1 bg-[#008751]"></div>
                <div className="flex-1 bg-white"></div>
                <div className="flex-1 bg-[#008751]"></div>
              </div>
              <div className="flex-1 overflow-hidden h-full flex items-center">
                <div className="flex whitespace-nowrap animate-tv-ticker items-center">
                  <span className="text-[7px] font-black text-white uppercase tracking-widest px-4">{APP_NAME} — {CHANNEL_INTRO}</span>
                  {adminMessages.map((msg, i) => (
                    <span key={`tv-admin-${i}`} className="text-[7px] text-yellow-200 font-black uppercase px-4 flex items-center">
                      <i className="fas fa-bullhorn mr-1"></i>{msg.text}
                      <span className="ml-4 text-red-300">◆</span>
                    </span>
                  ))}
                  {news.map((n, i) => (
                    <span key={`tv-news-${i}`} className="text-[7px] text-white font-bold uppercase px-4 flex items-center">
                      <span className="w-1.5 h-1.5 bg-yellow-300 rounded-full mr-2 shrink-0"></span>
                      {n.title}
                      <span className="ml-4 text-red-300">◆</span>
                    </span>
                  ))}
                  <span className="text-[7px] font-black text-white uppercase tracking-widest px-4">{APP_NAME} — {CHANNEL_INTRO}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. GOOGLE ADS */}
      <section className="space-y-1">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-[7px] font-black uppercase text-gray-400 tracking-[0.2em]">Google Ads</h3>
          <div className="flex items-center text-gray-300 text-[6px] space-x-1">
            <i className="fas fa-info-circle"></i>
            <span>AdChoices</span>
          </div>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-6 h-[135px] flex flex-col items-center justify-center text-center space-y-3 overflow-hidden relative group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 via-red-400 to-yellow-400"></div>
          <span className="text-[12px] font-black text-gray-800 uppercase tracking-wide">Premium African Fashion</span>
          <span className="text-[9px] text-gray-500 font-medium leading-relaxed max-w-[80%]">Global shipping starting at $15. Shop the latest authentic styles direct from Lagos!</span>
          <button className="bg-blue-600 text-white text-[8px] px-5 py-2 rounded-full font-black uppercase shadow-sm mt-1 hover:bg-blue-700 transition-colors">Shop Now</button>
        </div>
      </section>

      {/* 5. LIVE COMMUNITY REPORTS */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
           <h3 className="text-[7px] font-black uppercase text-green-600/40 tracking-[0.2em]">Live Community Reports</h3>
           <span className="text-[6px] font-black text-red-500 flex items-center">
             <span className="w-1 h-1 bg-red-500 rounded-full mr-1 animate-ping"></span> ON-AIR FEED
           </span>
        </div>
        <div className="bg-white/60 border border-green-50 rounded-2xl p-3 max-h-[150px] overflow-y-auto no-scrollbar shadow-inner">
          {reports.length > 0 ? (
            <div className="space-y-3">
              {reports.slice(0, 10).map((r) => (
                <div key={r.id} className="bg-white p-2.5 rounded-xl border border-green-50 shadow-sm animate-scale-in">
                   <div className="flex justify-between items-center mb-1">
                      <span className="text-[7px] font-black text-green-800 uppercase flex items-center">
                        <i className="fas fa-map-marker-alt mr-1 text-red-500"></i> {r.location}
                      </span>
                      <span className="text-[6px] text-gray-400 font-mono">{new Date(r.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                   </div>
                   <p className="text-[9px] text-green-950 leading-relaxed font-medium">"{r.content}"</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center opacity-30 flex flex-col items-center">
              <i className="fas fa-broadcast-tower text-2xl mb-2 text-green-300"></i>
              <span className="text-[7px] font-black uppercase tracking-widest">No community reports</span>
            </div>
          )}
        </div>
      </section>

      {/* 6. JOURNALIST HQ */}
      <section className="space-y-1">
        <h3 className="text-[7px] font-black uppercase text-green-600/40 tracking-[0.2em] px-1">Journalist HQ</h3>
        <div className="p-3 rounded-2xl border border-dashed border-green-200 bg-white/60 shadow-sm">
          {!isReporting ? (
            <button 
              onClick={() => setIsReporting(true)} 
              className="w-full py-2.5 text-[7px] font-black text-[#008751] uppercase tracking-widest flex items-center justify-center bg-white rounded-xl border border-green-50 shadow-sm active:scale-95 transition-all"
            >
              <i className="fas fa-microphone-alt mr-2 text-red-500"></i> Report Happenings in your City
            </button>
          ) : (
            <form onSubmit={handleReport} className="space-y-2 animate-scale-in">
              <textarea 
                value={reportText} 
                onChange={(e) => setReportText(e.target.value)} 
                placeholder="Briefly describe what's happening near you..." 
                className="w-full bg-green-50 border border-green-100 rounded-xl p-3 text-[9px] h-20 outline-none focus:border-green-400 font-medium resize-none shadow-inner" 
              />
              <div className="flex space-x-2">
                <button type="submit" className="flex-1 bg-[#008751] text-white py-2.5 rounded-xl font-black text-[7px] uppercase tracking-widest shadow-md active:scale-95 transition-all">
                  Broadcast Report
                </button>
                <button type="button" onClick={() => setIsReporting(false)} className="px-5 bg-white text-green-700 py-2.5 rounded-xl text-[7px] font-black border border-green-100 active:scale-95 transition-all">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* Footer (Text color dark green, size +15%) */}
      <footer className="mt-8 pt-6 border-t border-green-100 text-center space-y-1 pb-6">

        {/* ── DOWNLOAD APP BUTTON ── */}
        <div className="mb-6 px-2 space-y-2">
          <p className="text-[7px] font-black uppercase tracking-widest text-green-700 text-center">Get the App</p>
          <p className="text-[6px] text-green-600/50 text-center">Full radio, TV, sports & live news</p>

          {/* Android */}
          <a
            href="https://github.com/markped1/Diaspora-Radio/releases/latest/download/app-debug.apk"
            className="flex items-center justify-between w-full bg-gray-950 text-white py-3 px-4 rounded-2xl shadow-lg active:scale-95 transition-all"
          >
            <div className="flex items-center space-x-3">
              <i className="fab fa-android text-2xl text-green-400"></i>
              <div className="text-left">
                <p className="text-[6px] text-gray-400 uppercase tracking-widest">Download for</p>
                <p className="text-[12px] font-black uppercase">Android</p>
              </div>
            </div>
            <i className="fas fa-download text-gray-400"></i>
          </a>

          {/* iOS — coming soon */}
          <div className="flex items-center justify-between w-full bg-gray-100 text-gray-400 py-3 px-4 rounded-2xl">
            <div className="flex items-center space-x-3">
              <i className="fab fa-apple text-2xl text-gray-400"></i>
              <div className="text-left">
                <p className="text-[6px] text-gray-400 uppercase tracking-widest">Coming soon</p>
                <p className="text-[12px] font-black uppercase text-gray-500">iOS / iPhone</p>
              </div>
            </div>
            <span className="text-[6px] font-black uppercase bg-gray-200 text-gray-500 px-2 py-1 rounded-full">Soon</span>
          </div>
        </div>

        <div className="flex items-center justify-center space-x-4 mb-4">
           <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center hover:bg-green-200 transition-colors cursor-pointer"><i className="fab fa-facebook-f text-[12px] text-green-950"></i></div>
           <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center hover:bg-green-200 transition-colors cursor-pointer"><i className="fab fa-twitter text-[12px] text-green-950"></i></div>
           <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center hover:bg-green-200 transition-colors cursor-pointer"><i className="fab fa-whatsapp text-[12px] text-green-950"></i></div>
        </div>
        <p className="text-[8.5px] font-black uppercase tracking-[0.2em] text-green-950">{APP_NAME}</p>
        <p className="text-[7.5px] text-green-950/50 uppercase tracking-[0.4em]">Designed by {DESIGNER_NAME} &bull; v3.0.0</p>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .animate-marquee { display: inline-flex; animation: marquee 120s linear infinite; }
        @keyframes tv-ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .animate-tv-ticker { display: inline-flex; animation: tv-ticker 60s linear infinite; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
    </div>
  );
};

export default ListenerView;
