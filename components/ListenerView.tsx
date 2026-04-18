
import React, { useState, useEffect, useCallback, useRef } from 'react';
import SponsoredVideo from './SponsoredVideo';
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

const ListenerView: React.FC<ListenerViewProps> = ({ 
  news, 
  sponsoredVideos,
  reports,
  adminMessages = []
}) => {
  const [location, setLocation] = useState<string>('Syncing...');
  const [localTime, setLocalTime] = useState<string>('');
  const [reportText, setReportText] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [adIndex, setAdIndex] = useState(0);
  const [shareFeedback, setShareFeedback] = useState('');
  
  const timerRef = useRef<number | null>(null);

  const nextAd = useCallback(() => {
    const liveVideos = sponsoredVideos.filter(v => v.isLive);
    const pool = liveVideos.length > 0 ? liveVideos : sponsoredVideos;
    if (pool.length > 0) {
      setAdIndex((prev) => (prev + 1) % pool.length);
    }
  }, [sponsoredVideos]);

  useEffect(() => {
    if (sponsoredVideos.length > 0) {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        nextAd();
      }, 20000);
    }
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [adIndex, sponsoredVideos.length, nextAd]);

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

  const currentAd = sponsoredVideos.filter(v => v.isLive)[adIndex % Math.max(1, sponsoredVideos.filter(v => v.isLive).length)] 
    ?? sponsoredVideos[adIndex];

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

      {/* 2. NEWS TICKER */}
      <section className="bg-[#008751]/5 rounded-xl border border-[#008751]/10 shadow-inner h-8 flex items-center overflow-hidden">
        <div className="flex whitespace-nowrap animate-marquee items-center">
          <span className="text-[8px] font-black text-[#008751] uppercase px-8 tracking-widest inline-block">{CHANNEL_INTRO}</span>
          {adminMessages.map((msg, i) => (
            <span key={`admin-${i}`} className="text-[8px] text-red-600 font-black uppercase px-8 flex items-center inline-block">
               <i className="fas fa-bullhorn mr-2 animate-bounce"></i> {msg.text}
               <span className="ml-8 text-green-300">|</span>
            </span>
          ))}
          {news.map((n, i) => (
            <span key={`ticker-${i}`} className="text-[8px] text-green-800 font-bold uppercase px-8 flex items-center inline-block">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full mr-2 shrink-0 animate-pulse"></span>
              {n.title}
              <span className="ml-8 text-green-300">|</span>
            </span>
          ))}
          <span className="text-[8px] font-black text-[#008751] uppercase px-8 tracking-widest inline-block">{CHANNEL_INTRO}</span>
        </div>
      </section>

      {/* 3. SPONSORED HIGHLIGHTS */}
      <section className="space-y-1">
        <h3 className="text-[7px] font-black uppercase text-green-600/40 tracking-[0.2em] px-1">Sponsored Highlights</h3>
        <div className="min-h-[276px] relative">
          {currentAd ? (
            <div style={{ borderRadius: 0, height: '276px', width: '100%' }} className="overflow-hidden border border-green-100 shadow-md animate-scale-in">
              {currentAd.type === 'image' ? (
                <img src={currentAd.url} className="w-full h-full object-cover" alt="ad" />
              ) : (
                <SponsoredVideo video={currentAd} onEnded={nextAd} />
              )}
            </div>
          ) : (
            <div style={{ borderRadius: 0, height: '276px' }} className="bg-green-50/20 border border-dashed border-green-100 flex flex-col items-center justify-center opacity-40">
              <i className="fas fa-signal mb-2 text-green-600"></i>
              <span className="text-[6px] font-black uppercase tracking-widest">Awaiting Sponsor Signal</span>
            </div>
          )}
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
        <div className="flex items-center justify-center space-x-4 mb-4">
           <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center hover:bg-green-200 transition-colors cursor-pointer"><i className="fab fa-facebook-f text-[12px] text-green-950"></i></div>
           <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center hover:bg-green-200 transition-colors cursor-pointer"><i className="fab fa-twitter text-[12px] text-green-950"></i></div>
           <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center hover:bg-green-200 transition-colors cursor-pointer"><i className="fab fa-whatsapp text-[12px] text-green-950"></i></div>
        </div>
        <p className="text-[8.5px] font-black uppercase tracking-[0.2em] text-green-950">{APP_NAME}</p>
        <p className="text-[7.5px] text-green-950/50 uppercase tracking-[0.4em]">Designed by {DESIGNER_NAME} &bull; v2.4.0</p>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .animate-marquee { display: inline-flex; animation: marquee 120s linear infinite; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
    </div>
  );
};

export default ListenerView;
