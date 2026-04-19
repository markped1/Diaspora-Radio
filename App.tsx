
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ListenerView from './components/ListenerView';
import AdminView from './components/AdminView';
import PasswordModal from './components/PasswordModal';
import RadioPlayer from './components/RadioPlayer';
import { dbService } from './services/dbService';
import { scanNigerianNewspapers } from './services/newsAIService';
import { getDetailedBulletinAudio, getNewsAudio, getJingleAudio, registerSpeechCallbacks } from './services/aiDjService';
import { UserRole, MediaFile, AdminMessage, AdminLog, NewsItem, ListenerReport } from './types';
import { DESIGNER_NAME, APP_NAME, JINGLE_1, JINGLE_2 } from './constants';
import { getSharedMedia, getLiveState, setLiveTrack, hasApi } from './services/apiService';

const App: React.FC = () => {
  const [role, setRole] = useState<UserRole>(UserRole.LISTENER);
  const [showAuth, setShowAuth] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [sponsoredMedia, setSponsoredMedia] = useState<MediaFile[]>([]);
  const [audioPlaylist, setAudioPlaylist] = useState<MediaFile[]>([]);
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [reports, setReports] = useState<ListenerReport[]>([]);

  const [isRadioPlaying, setIsRadioPlaying] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [activeTrackUrl, setActiveTrackUrl] = useState<string | null>(null);
  const [currentTrackName, setCurrentTrackName] = useState<string>('');
  const [isShuffle, setIsShuffle] = useState(true);
  const [isDucking, setIsDucking] = useState(false);
  const [musicVolumeOverride, setMusicVolumeOverride] = useState<number | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<string>("Global");

  const isSyncingRef = useRef(false);
  const lastBroadcastMarkerRef = useRef<string>("");
  const wasPlayingBeforeBroadcastRef = useRef(false);

  const mediaUrlCache = useRef<Map<string, string>>(new Map());
  const playlistRef = useRef<MediaFile[]>([]);

  // Register Web Speech ducking callbacks once on mount
  useEffect(() => {
    registerSpeechCallbacks(
      () => setIsDucking(true),
      () => setIsDucking(false),
      (vol: number) => setMusicVolumeOverride(vol),   // duck to specific level
      () => { wasPlayingBeforeBroadcastRef.current = isRadioPlaying; setIsRadioPlaying(false); }, // stop music
      () => { setMusicVolumeOverride(null); }          // restore volume (music resumes after outro jingle)
    );
    setIsDucking(false);
    setMusicVolumeOverride(null);
  }, [isRadioPlaying]);

  useEffect(() => {
    playlistRef.current = audioPlaylist;
    // Try to get precise location for weather
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        // We'll use coordinates for weather search grounding
        setCurrentLocation(`${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`);
      });
    }
  }, [audioPlaylist]);

  const cleanTrackName = (name: string) => {
    return name.replace(/\.(mp3|wav|m4a|aac|ogg|flac|webm|wma)$/i, '');
  };

  const fetchData = useCallback(async () => {
    try {
      const [n, l, m, msg, rep] = await Promise.all([
        dbService.getNews(), dbService.getLogs(), dbService.getMedia(), dbService.getAdminMessages(), dbService.getReports()
      ]);

      const mediaItems = m || [];
      const processedMedia = mediaItems.map(item => {
        if (item.file) {
          let url = mediaUrlCache.current.get(item.id);
          if (!url) {
            url = URL.createObjectURL(item.file);
            mediaUrlCache.current.set(item.id, url);
          }
          return { ...item, url };
        }
        return item;
      });

      // Merge cloud media (shared across all devices) with local media
      let cloudMedia: MediaFile[] = [];
      if (hasApi()) {
        try {
          cloudMedia = await getSharedMedia();
        } catch {}
      }

      // Cloud media takes priority — local media is fallback
      const allMedia = [
        ...cloudMedia,
        ...processedMedia.filter(local => !cloudMedia.find(c => c.id === local.id))
      ];

      setNews(n || []);
      setLogs(l || []);
      setSponsoredMedia(allMedia.filter(item => item.type === 'video' || item.type === 'image' || item.type === 'youtube' || item.type === 'iptv'));
      setAudioPlaylist(allMedia.filter(item => item.type === 'audio'));
      setAdminMessages(msg || []);
      setReports(rep || []);

      if (activeTrackId) {
        const activeTrack = allMedia.find(t => t.id === activeTrackId);
        if (activeTrack) setActiveTrackUrl(activeTrack.url);
      }

      // Sync live state from cloud (what admin is playing)
      if (hasApi()) {
        try {
          const live = await getLiveState();
          // Only sync if it's a real HTTP URL (not a blob URL which is device-specific)
          if (live.track && live.track.url && live.track.url.startsWith('http') && !isRadioPlaying) {
            setActiveTrackUrl(live.track.url);
            setCurrentTrackName(live.track.name || '');
          }
          if (live.messages?.length) {
            setAdminMessages(live.messages);
          }
        } catch {}
      }
    } catch (err) {
      console.error("Data fetch error", err);
    }
  }, [activeTrackId, isRadioPlaying]);

  // Fetch fresh news from RSS and dump into newsroom + state
  const refreshNews = useCallback(async () => {
    try {
      // Clear lastSync so quota guard doesn't block a manual refresh
      localStorage.removeItem('ndn_radio_last_sync');
      const { news: freshNews } = await scanNigerianNewspapers(currentLocation);
      if (freshNews.length > 0) {
        setNews(freshNews);
        console.log(`📰 Newsroom updated: ${freshNews.length} articles`);
      } else {
        console.warn('⚠️ No articles returned from news fetch');
      }
    } catch (err) {
      console.error('News refresh failed:', err);
    }
  }, [currentLocation]);

  // Web Speech API speaks directly inside aiDjService — this wrapper exists
  // only so the rest of the call sites (runScheduledBroadcast, handlePushBroadcast)
  // don't need to change. The Uint8Array returned is a sentinel (1 byte) meaning
  // "speech already happened", so we just resolve immediately.
  const playRawPcm = useCallback(async (_pcmData: Uint8Array): Promise<void> => {
    // Speech was already played by webSpeechSpeak inside the service call.
    // Nothing to do here.
    return Promise.resolve();
  }, []);

  const runScheduledBroadcast = useCallback(async (isBrief: boolean) => {
    // Skip broadcast if listener isn't actively listening to the radio
    if (!isRadioPlaying) {
      console.log(`⏭ Skipping ${isBrief ? 'headline' : 'detailed'} broadcast — radio is off`);
      return;
    }

    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      console.log(`Starting ${isBrief ? 'Headline' : 'Detailed'} News & Weather Broadcast...`);

      // Step 1: Fetch fresh news + weather, dump into newsroom
      const { news: freshNews, weather } = await scanNigerianNewspapers(currentLocation);
      if (freshNews.length > 0) setNews(freshNews);
      await fetchData();

      const broadcastNews = freshNews.length > 0 ? freshNews : news;

      if (broadcastNews.length > 0) {
        // Remember if music was playing before broadcast
        wasPlayingBeforeBroadcastRef.current = isRadioPlaying;

        // Step 1: Intro jingle — music ducked to 30%
        setMusicVolumeOverride(0.30);
        setIsDucking(true);
        await getJingleAudio(JINGLE_1);

        // Step 2: Read bulletin — handles its own duck/stop internally
        // Anchor goes silent after sign-off, does NOT resume music
        await getDetailedBulletinAudio({
          location: currentLocation,
          localTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          newsItems: broadcastNews.slice(0, isBrief ? 5 : 8),
          weather,
          isBrief,
        });

        dbService.addLog({
          id: Date.now().toString(),
          action: `${isBrief ? 'Headline' : 'Detailed'} Broadcast — ${broadcastNews.length} stories at ${new Date().toLocaleTimeString()}`,
          timestamp: Date.now()
        });

        // Step 3: Outro jingle plays in silence — anchor has already signed off
        await getJingleAudio(JINGLE_2);

        // Step 4: ONLY NOW restore music — after the jingle finishes
        setMusicVolumeOverride(null);
        setIsDucking(false);
        if (wasPlayingBeforeBroadcastRef.current) {
          setIsRadioPlaying(true);
        }
      }
    } catch (err) {
      console.error("Scheduled broadcast failed", err);
      // Always restore music on error
      setMusicVolumeOverride(null);
      setIsDucking(false);
    } finally {
      isSyncingRef.current = false;
    }
  }, [currentLocation, fetchData, news, isRadioPlaying]);

  // Precise Heartbeat Scheduler
  useEffect(() => {
    const heartbeat = setInterval(() => {
      const now = new Date();
      const currentMinute = now.getMinutes();
      const timeTag = `${now.getHours()}:${currentMinute}`;

      // :00 = Detailed News & Weather
      if (currentMinute === 0 && lastBroadcastMarkerRef.current !== timeTag) {
        lastBroadcastMarkerRef.current = timeTag;
        runScheduledBroadcast(false);
      }
      // :30 = Headline News & Weather
      else if (currentMinute === 30 && lastBroadcastMarkerRef.current !== timeTag) {
        lastBroadcastMarkerRef.current = timeTag;
        runScheduledBroadcast(true);
      }
    }, 1000); // Checking every second for precise start

    return () => clearInterval(heartbeat);
  }, [runScheduledBroadcast]);

  useEffect(() => {
    fetchData();
    refreshNews();

    const interactionHandler = () => setHasInteracted(true);
    window.addEventListener('click', interactionHandler, { once: true });

    // Poll cloud state every 10 seconds so listeners stay in sync with admin
    const syncInterval = hasApi() ? setInterval(() => fetchData(), 10000) : null;

    return () => {
      window.removeEventListener('click', interactionHandler);
      if (syncInterval) clearInterval(syncInterval);
    };
  }, [fetchData, refreshNews]);

  const handlePlayNext = useCallback(() => {
    const list = playlistRef.current;
    if (list.length === 0) {
      setActiveTrackId(null);
      setActiveTrackUrl(null);
      setCurrentTrackName('');
      return;
    }
    const currentIndex = list.findIndex(t => t.id === activeTrackId);
    let nextIndex = isShuffle ? Math.floor(Math.random() * list.length) : (currentIndex + 1) % list.length;
    const track = list[nextIndex];
    if (track) {
      setActiveTrackId(track.id);
      setActiveTrackUrl(track.url);
      setCurrentTrackName(cleanTrackName(track.name));
      setIsRadioPlaying(true);
      // Push live track to cloud
      if (hasApi() && track.url.startsWith('http')) setLiveTrack({ url: track.url, name: cleanTrackName(track.name) }).catch(() => {});
    }
  }, [activeTrackId, isShuffle]);

  const handlePlayAll = () => {
    setHasInteracted(true);
    if (audioPlaylist.length === 0) {
      setIsRadioPlaying(true);
      return;
    }
    const track = isShuffle ? audioPlaylist[Math.floor(Math.random() * audioPlaylist.length)] : audioPlaylist[0];
    setActiveTrackId(track.id);
    setActiveTrackUrl(track.url);
    setCurrentTrackName(cleanTrackName(track.name));
    setIsRadioPlaying(true);
    // Push live track to cloud so all listeners hear it (only HTTP URLs work across devices)
    if (hasApi() && track.url.startsWith('http')) {
      setLiveTrack({ url: track.url, name: cleanTrackName(track.name) }).catch(() => {});
    }
  };

  const handlePushBroadcast = async (voiceText: string) => {
    if (voiceText.trim()) {
      const intro = await getJingleAudio(JINGLE_1);
      if (intro) await playRawPcm(intro, 'jingle');

      const audioData = await getNewsAudio(voiceText);
      if (audioData) await playRawPcm(audioData, 'news');

      const outro = await getJingleAudio(JINGLE_2);
      if (outro) await playRawPcm(outro, 'jingle');
    }
    await fetchData();
  };

  const handlePlayJingle = async (idx: number) => {
    const audio = await getJingleAudio(idx === 1 ? JINGLE_1 : JINGLE_2);
    if (audio) await playRawPcm(audio, 'jingle');
  };

  return (
    <div className="min-h-screen bg-[#f0fff4] text-[#008751] flex flex-col max-w-md mx-auto relative shadow-2xl overflow-x-hidden border-x border-green-100/30">
      <header className="p-2 sticky top-0 z-40 bg-white/90 backdrop-blur-md flex justify-between items-center border-b border-green-50 shadow-sm">
        <div className="flex flex-col">
          <h1 className="text-[11px] font-black italic uppercase leading-none text-green-950">{APP_NAME}</h1>
          <p className="text-[6px] text-green-950/60 font-black uppercase mt-0.5 tracking-widest">Designed by {DESIGNER_NAME}</p>
        </div>
        <div className="flex items-center space-x-2">
          {isDucking && <span className="text-[7px] font-black uppercase text-red-500 animate-pulse bg-red-50 px-1 rounded shadow-sm border border-red-100">Live Broadcast</span>}
          <button
            onClick={role === UserRole.ADMIN ? () => setRole(UserRole.LISTENER) : () => setShowAuth(true)}
            className="px-2 py-0.5 rounded-full border border-green-950 text-[7px] font-black uppercase text-green-950 hover:bg-green-50 transition-colors"
          >
            {role === UserRole.ADMIN ? 'Exit Admin' : 'Admin Login'}
          </button>
        </div>
      </header>

      <main className="flex-grow pt-1 px-1.5">
        <RadioPlayer
          onStateChange={setIsRadioPlaying}
          activeTrackUrl={activeTrackUrl}
          currentTrackName={currentTrackName}
          forcePlaying={isRadioPlaying}
          onTrackEnded={handlePlayNext}
          isDucking={isDucking}
          musicVolumeOverride={musicVolumeOverride}
        />

        {role === UserRole.LISTENER ? (
          <ListenerView
            news={news} onStateChange={setIsRadioPlaying} isRadioPlaying={isRadioPlaying}
            sponsoredVideos={sponsoredMedia} activeTrackUrl={activeTrackUrl}
            currentTrackName={currentTrackName} adminMessages={adminMessages} reports={reports}
            onPlayTrack={(t) => { setHasInteracted(true); setActiveTrackId(t.id); setActiveTrackUrl(t.url); setCurrentTrackName(cleanTrackName(t.name)); setIsRadioPlaying(true); }}
          />
        ) : (
          <AdminView
            onRefreshData={fetchData} logs={logs} onPlayTrack={(t) => { setHasInteracted(true); setActiveTrackId(t.id); setActiveTrackUrl(t.url); setCurrentTrackName(cleanTrackName(t.name)); setIsRadioPlaying(true); }}
            isRadioPlaying={isRadioPlaying} onToggleRadio={() => setIsRadioPlaying(!isRadioPlaying)}
            currentTrackName={currentTrackName} isShuffle={isShuffle} onToggleShuffle={() => setIsShuffle(!isShuffle)}
            onPlayAll={handlePlayAll} onSkipNext={handlePlayNext}
            onPushBroadcast={handlePushBroadcast} onPlayJingle={handlePlayJingle}
            news={news} onTriggerFullBulletin={() => runScheduledBroadcast(false)}
            onRefreshNews={refreshNews}
          />
        )}
      </main>

      {showAuth && <PasswordModal onClose={() => setShowAuth(false)} onSuccess={() => { setRole(UserRole.ADMIN); setShowAuth(false); }} />}
    </div>
  );
};

export default App;
