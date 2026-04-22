
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
import { registerSession, updateSession } from './services/analyticsService';

const App: React.FC = () => {
  const [role, setRole] = useState<UserRole>(UserRole.LISTENER);
  const [showAuth, setShowAuth] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [sponsoredMedia, setSponsoredMedia] = useState<MediaFile[]>([]);
  const [audioPlaylist, setAudioPlaylist] = useState<MediaFile[]>([]);
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [reports, setReports] = useState<ListenerReport[]>([]);
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error' | 'none'>('none');

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
  const roleRef = useRef<UserRole>(UserRole.LISTENER);
  useEffect(() => { roleRef.current = role; }, [role]);
  const lastBroadcastMarkerRef = useRef<string>("");
  const wasPlayingBeforeBroadcastRef = useRef(false);

  const activeTrackIdRef = useRef<string | null>(null);
  useEffect(() => { activeTrackIdRef.current = activeTrackId; }, [activeTrackId]);
  const activeTrackUrlRef = useRef<string | null>(null);
  useEffect(() => { activeTrackUrlRef.current = activeTrackUrl; }, [activeTrackUrl]);
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isRadioPlaying; }, [isRadioPlaying]);
  const playlistRef = useRef<MediaFile[]>([]);
  const mediaUrlCache = useRef<Map<string, string>>(new Map());

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

      setNews(n || []);
      setLogs(l || []);
      setSponsoredMedia(processedMedia.filter(item => item.type === 'video' || item.type === 'image' || item.type === 'youtube' || item.type === 'iptv'));
      setAudioPlaylist(processedMedia.filter(item => item.type === 'audio'));
      setAdminMessages(msg || []);
      setReports(rep || []);

      if (activeTrackIdRef.current && activeTrackIdRef.current !== 'live-stream') {
        const activeTrack = processedMedia.find(t => t.id === activeTrackIdRef.current);
        if (activeTrack && activeTrack.url && activeTrack.url !== activeTrackUrlRef.current) {
          setActiveTrackUrl(activeTrack.url);
        }
      }

      // Sync cloud state is now handled by the dedicated syncLiveState interval
      if (hasApi()) {
        if (apiStatus === 'none') setApiStatus('checking');
        getSharedMedia().then(cloudMedia => {
          if (cloudMedia.length > 0) {
            if (!activeTrackUrlRef.current) {
              setAudioPlaylist(prev => {
                const merged = [...cloudMedia.filter((c: any) => c.type === 'audio'), ...prev.filter(p => !cloudMedia.find((c: any) => c.id === p.id))];
                return merged;
              });
            }
          }
        }).catch(() => {});
      }
    } catch (err) {
      console.error("Data fetch error", err);
    }
  }, []); // stable — uses refs, no stale closure

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

  // Register listener session and send heartbeat every 60s
  useEffect(() => {
    if (role !== UserRole.LISTENER) return;
    registerSession(false);
    const heartbeat = setInterval(() => {
      updateSession(false); // isWatching updated separately
    }, 60000);
    return () => clearInterval(heartbeat);
  }, [role]);

  useEffect(() => {
    fetchData();
    refreshNews();
    const interactionHandler = () => setHasInteracted(true);
    window.addEventListener('click', interactionHandler, { once: true });
    return () => window.removeEventListener('click', interactionHandler);
  }, [fetchData, refreshNews]);

  useEffect(() => {
    // ── LISTENER SYNC: runs once on mount, then every 5s ──────────────────
    // Completely separate from fetchData — never touches audio while playing
    if (!hasApi()) return;

    let hasInitialised = false; // only auto-start on first sync

    const syncLiveState = async () => {
      try {
        const live = await getLiveState();
        if (roleRef.current !== UserRole.LISTENER) return;

        if (live.track?.url?.startsWith('http')) {
          if (activeTrackUrlRef.current !== live.track.url) {
            setActiveTrackUrl(live.track.url);
            setCurrentTrackName(live.track.name || '');
            dbService.setLiveStreamUrl(live.track.url);
          }
          // Only auto-start on first sync — after that respect user's pause
          if (!hasInitialised) {
            setIsRadioPlaying(true);
          }
        } else if (live.stream?.startsWith('http')) {
          if (activeTrackUrlRef.current !== live.stream) {
            setActiveTrackUrl(live.stream);
            setCurrentTrackName('Live Stream');
            dbService.setLiveStreamUrl(live.stream);
          }
          if (!hasInitialised) {
            setIsRadioPlaying(true);
          }
        } else if (live.track === null && !live.stream?.startsWith('http')) {
          // Admin explicitly stopped — stop listener
          setActiveTrackUrl(null);
          setCurrentTrackName('');
          setIsRadioPlaying(false);
          dbService.setLiveStreamUrl('');
        }

        hasInitialised = true;

        if (live.messages?.length) setAdminMessages(live.messages);

        if (live.tv?.url) {
          setSponsoredMedia(prev => {
            const existing = prev.find(m => m.id === 'cloud-tv-live');
            if (existing?.url === live.tv.url) return prev;
            const cloudTv: MediaFile = {
              id: 'cloud-tv-live',
              name: live.tv.name || 'Live TV',
              url: live.tv.url,
              type: (live.tv.type as any) || 'youtube',
              youtubeId: live.tv.youtubeId || undefined,
              caption: live.tv.caption || '',
              timestamp: live.tv.url, // stable — use URL as timestamp key
              isLive: true,
            };
            return [cloudTv, ...prev.filter(m => m.id !== 'cloud-tv-live')];
          });
        } else if (live.tv === null) {
          setSponsoredMedia(prev => prev.filter(m => m.id !== 'cloud-tv-live'));
        }

        setApiStatus('connected');
      } catch {
        setApiStatus('error');
      }
    };

    syncLiveState();
    const interval = setInterval(syncLiveState, 5000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayNext = useCallback(() => {
    const list = playlistRef.current;
    if (list.length === 0) {
      // Fall back to stream URL instead of going silent
      const streamUrl = dbService.getLiveStreamUrl();
      if (streamUrl) {
        setActiveTrackId('live-stream');
        setActiveTrackUrl(streamUrl);
        setCurrentTrackName('Live Stream');
        setIsRadioPlaying(true);
      } else {
        setActiveTrackId(null);
        setActiveTrackUrl(null);
        setCurrentTrackName('');
      }
      return;
    }
    const currentIndex = list.findIndex(t => t.id === activeTrackId);
    // Prefer cloud tracks — only cloud tracks can be heard by listeners
    const cloudTracks = list.filter(t => t.url?.startsWith('http'));
    const pool = cloudTracks.length > 0 ? cloudTracks : list;
    if (pool.length === 0) return;
    let nextIndex = isShuffle ? Math.floor(Math.random() * pool.length) : (currentIndex + 1) % pool.length;
    const track = pool[nextIndex];
    if (track) {
      setActiveTrackId(track.id);
      setActiveTrackUrl(track.url);
      setCurrentTrackName(cleanTrackName(track.name));
      setIsRadioPlaying(true);
      // Push to Supabase so all listeners hear it
      if (hasApi() && track.url?.startsWith('http')) {
        setLiveTrack({ url: track.url, name: cleanTrackName(track.name) }).catch(() => {});
      }
    }
  }, [activeTrackId, isShuffle]);

  const handlePlayAll = () => {
    setHasInteracted(true);
    if (audioPlaylist.length === 0) {
      // Fall back to saved stream URL
      const streamUrl = dbService.getLiveStreamUrl();
      if (streamUrl) {
        setActiveTrackId('live-stream');
        setActiveTrackUrl(streamUrl);
        setCurrentTrackName('Live Stream');
        setIsRadioPlaying(true);
        if (hasApi()) setLiveTrack({ url: streamUrl, name: 'Live Stream' }).catch(() => {});
      } else {
        // Nothing at all — try fetching live state from cloud
        if (hasApi()) {
          getLiveState().then(live => {
            const url = live?.track?.url || live?.stream;
            if (url?.startsWith('http')) {
              setActiveTrackId('live-stream');
              setActiveTrackUrl(url);
              setCurrentTrackName(live?.track?.name || 'Live Stream');
              setIsRadioPlaying(true);
              dbService.setLiveStreamUrl(url);
            }
          }).catch(() => {});
        }
      }
      return;
    }
    // Use all tracks — cloud first, then local blobs
    const cloudTracks = audioPlaylist.filter(t => t.url?.startsWith('http'));
    const pool = cloudTracks.length > 0 ? cloudTracks : audioPlaylist;
    const track = isShuffle ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
    
    setActiveTrackId(track.id);
    setActiveTrackUrl(track.url);
    setCurrentTrackName(cleanTrackName(track.name));
    setIsRadioPlaying(true);
    // Push to cloud only if it's a cloud URL
    if (hasApi() && track.url?.startsWith('http')) {
      setLiveTrack({ url: track.url, name: cleanTrackName(track.name) }).catch(() => {});
    } else if (hasApi()) {
      // Local blob — check if Cloudinary version exists
      getSharedMedia().then(cloudItems => {
        const cloudVersion = cloudItems.find(c =>
          c.name === track.name && c.url?.startsWith('http')
        );
        if (cloudVersion) {
          setLiveTrack({ url: cloudVersion.url, name: cleanTrackName(track.name) }).catch(() => {});
        }
      }).catch(() => {});
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
            apiStatus={apiStatus}
            onRefreshData={fetchData} logs={logs} onPlayTrack={(t) => {
              setHasInteracted(true);
              setActiveTrackId(t.id);
              setActiveTrackUrl(t.url);
              setCurrentTrackName(cleanTrackName(t.name));
              setIsRadioPlaying(true);
              if (hasApi()) {
                if (t.url && String(t.url).startsWith('http')) {
                  // Cloud URL — push directly to listeners
                  setLiveTrack({ url: t.url, name: cleanTrackName(t.name) }).catch(() => {});
                } else {
                  // Local blob — find matching cloud URL by name or id
                  getSharedMedia().then(cloudItems => {
                    const match = cloudItems.find((c: any) =>
                      c.type === 'audio' && c.url?.startsWith('http') &&
                      (c.id === t.id || c.name === t.name)
                    );
                    if (match) {
                      setLiveTrack({ url: match.url, name: cleanTrackName(t.name) }).catch(() => {});
                    }
                  }).catch(() => {});
                }
              }
            }}
            isRadioPlaying={isRadioPlaying} onToggleRadio={() => {
              const stopping = isRadioPlaying;
              setIsRadioPlaying(!isRadioPlaying);
              if (stopping && hasApi()) setLiveTrack(null).catch(() => {});
            }}
            currentTrackName={currentTrackName} isShuffle={isShuffle} onToggleShuffle={() => setIsShuffle(!isShuffle)}
            onPlayAll={handlePlayAll} onSkipNext={handlePlayNext}
            onPushBroadcast={handlePushBroadcast} onPlayJingle={handlePlayJingle}
            news={news} onTriggerFullBulletin={() => runScheduledBroadcast(false)}
            onRefreshNews={refreshNews}
            onPlayStream={(url) => {
              setActiveTrackId('live-stream');
              setActiveTrackUrl(url);
              setCurrentTrackName('Live Stream');
              setIsRadioPlaying(true);
              if (hasApi()) setLiveTrack({ url, name: 'Live Stream' }).catch(() => {});
            }}
          />
        )}
      </main>

      {showAuth && <PasswordModal onClose={() => setShowAuth(false)} onSuccess={() => { setRole(UserRole.ADMIN); setShowAuth(false); }} />}
    </div>
  );
};

export default App;
