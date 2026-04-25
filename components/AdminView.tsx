
import React, { useState, useEffect, useRef } from 'react';
import { dbService } from '../services/dbService';
import { AdminLog, MediaFile, NewsItem, ListenerReport, SportChannel } from '../types';
import TvMonitor from './TvMonitor';
import SportsTv from './SportsTv';
import GenreManager from './GenreManager';
import AnalyticsDashboard from './AnalyticsDashboard';
import { getSharedMedia, hasApi, addMediaToCloud, setSharedStreamUrl, deleteSharedMedia, setLiveTrack, setLiveTv, setLiveStream } from '../services/apiService';

// ── Quick Stream Box — paste any URL and push instantly to TV ─────────────────
const QuickStreamBox: React.FC<{ onPushLive: (url: string, name: string) => Promise<void> }> = ({ onPushLive }) => {
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const [pushing, setPushing] = React.useState(false);
  const [msg, setMsg] = React.useState('');

  const handle = async () => {
    if (!url.trim()) return;
    setPushing(true);
    setMsg('');
    try {
      await onPushLive(url.trim(), name.trim() || 'Live Stream');
      setMsg('✅ Live!');
      setUrl('');
      setName('');
    } catch {
      setMsg('❌ Failed');
    } finally {
      setPushing(false);
      setTimeout(() => setMsg(''), 3000);
    }
  };

  return (
    <div className="bg-red-950 border border-red-800 rounded-2xl p-4 space-y-2 shadow-lg">
      <div className="flex items-center space-x-2">
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
        <h3 className="text-[8px] font-black uppercase tracking-widest text-red-300">Quick Stream to TV</h3>
      </div>
      <p className="text-[6px] text-red-400">Paste any URL — IPTV (.m3u8), YouTube, Dailymotion, Twitch, or direct video link</p>
      <input
        type="url"
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://stream.example.com/live.m3u8"
        className="w-full bg-gray-900 border border-red-800 rounded-lg px-3 py-2 text-[9px] text-white outline-none focus:border-red-500 placeholder-gray-600"
      />
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Channel name (optional)"
        className="w-full bg-gray-900 border border-red-800 rounded-lg px-3 py-2 text-[9px] text-white outline-none focus:border-red-500 placeholder-gray-600"
      />
      <div className="flex items-center space-x-2">
        <button
          onClick={handle}
          disabled={pushing || !url.trim()}
          className="flex-1 bg-red-600 text-white py-2.5 rounded-xl text-[8px] font-black uppercase flex items-center justify-center space-x-1 disabled:opacity-40 active:scale-95 transition-all"
        >
          <i className={`fas ${pushing ? 'fa-circle-notch fa-spin' : 'fa-broadcast-tower'} text-[9px]`}></i>
          <span>{pushing ? 'Pushing...' : 'Push Live to TV'}</span>
        </button>
        {msg && <span className="text-[8px] font-black text-red-300">{msg}</span>}
      </div>
    </div>
  );
};

interface AdminViewProps {
  onRefreshData: () => void;
  onRefreshNews: () => Promise<void>;
  logs: AdminLog[];
  onPlayTrack: (track: MediaFile) => void;
  isRadioPlaying: boolean;
  onToggleRadio: () => void;
  apiStatus: 'checking' | 'connected' | 'error' | 'none';
  currentTrackName: string;
  isShuffle: boolean;
  onToggleShuffle: () => void;
  onPlayAll: () => void;
  onSkipNext: () => void;
  onPushBroadcast?: (voiceText: string) => Promise<void>;
  onPlayJingle?: (index: 1 | 2) => Promise<void>;
  news?: NewsItem[];
  onTriggerFullBulletin?: () => Promise<void>;
  onPlayStream?: (url: string) => void;
}

type Tab = 'command' | 'bulletin' | 'tv' | 'sports' | 'media' | 'genres' | 'analytics' | 'inbox' | 'logs';
type MediaSubTab = 'audio' | 'video' | 'ads';

const AdminView: React.FC<AdminViewProps> = ({ 
  onRefreshData,
  onRefreshNews,
  logs, 
  onPlayTrack, 
  isRadioPlaying, 
  onToggleRadio,
  apiStatus,
  currentTrackName,
  isShuffle,
  onToggleShuffle,
  onPlayAll,
  onSkipNext,
  onPushBroadcast,
  onPlayJingle,
  news = [],
  onTriggerFullBulletin,
  onPlayStream,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('command');
  const [mediaSubTab, setMediaSubTab] = useState<MediaSubTab>('audio');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFetchingNews, setIsFetchingNews] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [mediaList, setMediaList] = useState<MediaFile[]>([]);
  const [cloudMedia, setCloudMedia] = useState<MediaFile[]>([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [reports, setReports] = useState<ListenerReport[]>([]);
  const [voiceMsg, setVoiceMsg] = useState('');
  const [nextSyncIn, setNextSyncIn] = useState<string>('');
  const [liveStreamUrl, setLiveStreamUrlState] = useState(() => dbService.getLiveStreamUrl());
  const [adInterval, setAdInterval] = useState(() => Number(localStorage.getItem('ndr_ad_interval') || 3));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    const [m, r] = await Promise.all([dbService.getMedia(), dbService.getReports()]);
    setMediaList(m || []);
    setReports(r || []);
  };

  const loadCloudMedia = async () => {
    if (!hasApi()) return;
    setIsLoadingCloud(true);
    try {
      const items = await getSharedMedia();
      setCloudMedia(items || []);
    } catch {
      setCloudMedia([]);
    } finally {
      setIsLoadingCloud(false);
    }
  };

  useEffect(() => {
    loadData();
    loadCloudMedia();
    const interval = setInterval(loadData, 15000);
    const countdownInterval = setInterval(() => {
      const now = new Date();
      const mins = now.getMinutes() < 30 ? 29 - now.getMinutes() : 59 - now.getMinutes();
      const secs = 59 - now.getSeconds();
      setNextSyncIn(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(countdownInterval);
    };
  }, []);

  // Background auto-sync: Check for unsynced files every 5 minutes
  useEffect(() => {
    const syncInterval = setInterval(() => {
      if (mediaList.length > 0 && hasApi()) {
        const unsynced = mediaList.filter(m => (!m.url || String(m.url).startsWith('blob:')) && m.file);
        if (unsynced.length > 0 && !isProcessing) {
          console.log(`☁️ Background sync triggered for ${unsynced.length} files`);
          syncAllMediaToCloud();
        }
      }
    }, 300000); // 5 minutes
    return () => clearInterval(syncInterval);
  }, [mediaList.length, isProcessing]);

  const syncAllMediaToCloud = async () => {
    if (isProcessing) return;
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
      setStatusMsg('❌ Cloudinary keys missing in .env.local');
      return;
    }

    const unsynced = mediaList.filter(m => (!m.url || String(m.url).startsWith('blob:')) && m.file);
    if (unsynced.length === 0) {
      setStatusMsg('✅ All files are already synced to cloud');
      setTimeout(() => setStatusMsg(''), 3000);
      return;
    }

    setIsProcessing(true);
    let successCount = 0;
    
    for (let i = 0; i < unsynced.length; i++) {
        const item = unsynced[i];
        setStatusMsg(`Syncing ${i+1}/${unsynced.length}: ${item.name}`);
        try {
            const form = new FormData();
            form.append('file', item.file!);
            form.append('upload_preset', uploadPreset);
            const resourceType = (item.type === 'audio' || item.type === 'video') ? 'video' : 'image';
            
            const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, { 
              method: 'POST', body: form, signal: AbortSignal.timeout(60000) 
            });
            const data = await res.json();
            
            if (data.secure_url) {
                await dbService.updateMedia({ ...item, url: data.secure_url, file: item.file }); // Keep local file!
                await addMediaToCloud({
                    id: item.id, name: item.name, url: data.secure_url,
                    type: item.type, timestamp: item.timestamp
                });
                successCount++;
            }
        } catch (err) {
            console.error(`Sync failed for ${item.name}:`, err);
        }
    }

    setIsProcessing(false);
    setStatusMsg(`✅ Completed: ${successCount} files duplicated to cloud`);
    await loadData();
    await loadCloudMedia();
    setTimeout(() => setStatusMsg(''), 5000);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    let count = 0;

    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    const useCloud = Boolean(cloudName && uploadPreset);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.startsWith('.') || file.name.includes('DS_Store')) continue;
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const mime = file.type.toLowerCase();
        const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext) || mime.startsWith('audio/');
        const isVideo = ['mp4', 'webm', 'mov'].includes(ext) || mime.startsWith('video/');
        const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) || mime.startsWith('image/');
        let finalType: 'audio' | 'video' | 'image' = isAudio ? 'audio' : (isVideo ? 'video' : 'image');
        if (!isAudio && !isVideo && !isImage) continue;

        setStatusMsg(`Saving ${count + 1} of ${files.length}: ${file.name}`);

        // Step 1: Save locally IMMEDIATELY so admin can use it right away
        const localId = 'local-' + Math.random().toString(36).substr(2, 9);
        const localItem = {
          id: localId,
          name: file.name,
          url: '',
          file: file,
          type: finalType,
          timestamp: Date.now(),
          likes: 0
        };
        await dbService.addMedia(localItem);
        count++;

        // Step 2: Upload to cloud in background (non-blocking)
        if (useCloud) {
          const uploadToCloud = async () => {
            try {
              const form = new FormData();
              form.append('file', file);
              form.append('upload_preset', uploadPreset);
              // CRITICAL: Cloudinary treats audio as 'video' resource type. 'raw' breaks media features.
              const resourceType = (isAudio || isVideo) ? 'video' : 'image';
              const res = await fetch(
                `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
                { method: 'POST', body: form, signal: AbortSignal.timeout(60000) }
              );
              const data = await res.json();
              if (data.secure_url) {
                // Update local record with cloud URL
                await dbService.updateMedia({ ...localItem, url: data.secure_url, file: undefined });

                // Save to KV so all listeners see it
                await addMediaToCloud({
                  id: localId,
                  name: file.name,
                  url: data.secure_url,
                  type: finalType,
                  timestamp: Date.now(),
                });

                // Refresh UI to show cloud URL
                await loadData();
                await loadCloudMedia();
                setStatusMsg(`☁️ ${file.name} synced to cloud`);
                setTimeout(() => setStatusMsg(''), 3000);
              } else {
                console.error(`Cloudinary error for ${file.name}:`, data.error?.message || 'Unknown error');
                setStatusMsg(`❌ Cloud upload failed for ${file.name}`);
              }
            } catch (err) {
              console.warn(`Background cloud upload failed for ${file.name}:`, err);
              setStatusMsg(`❌ Cloud sync error: check your Internet`);
            }
          };

          // Fire and forget — don't await
          uploadToCloud();
        }
      }

      setStatusMsg(`✅ ${count} files saved. ${useCloud ? 'Syncing to cloud in background...' : 'Add Cloudinary keys to sync to cloud.'}`);
      onRefreshData();
      await loadData();
    } catch (error) {
      setStatusMsg('Import Error.');
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusMsg(''), 6000);
      if (e.target) e.target.value = '';
    }
  };

  const handleManualBroadcast = async (item: NewsItem) => {
    setIsProcessing(true);
    setStatusMsg(`Broadcasting: ${item.title}`);
    await onPushBroadcast?.(`Headline: ${item.title}. ${item.content}`);
    setIsProcessing(false);
    setStatusMsg(`Broadcast complete.`);
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const triggerUpload = (accept: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('accept', accept);
      fileInputRef.current.click();
    }
  };

  const filteredMedia = mediaList.filter(m => {
    if (!m) return false;
    if (mediaSubTab === 'audio') return m.type === 'audio';
    return m.type === 'video' || m.type === 'image';
  });

  return (
    <div className="space-y-4 pb-20 text-green-900 animate-scale-in">
      <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileUpload} />
      <input type="file" ref={folderInputRef} className="hidden" webkitdirectory="true" directory="true" multiple onChange={handleFileUpload} />

      <div className="bg-white p-6 rounded-2xl border border-green-100 shadow-sm flex items-center justify-between mx-1">
        <div className="flex flex-col">
          <h1 className="text-xl font-black tracking-tighter text-green-900 leading-none">COMMAND CENTER</h1>
          <div className="flex items-center space-x-2 mt-2">
            <span className="text-[7px] text-gray-400 font-bold uppercase tracking-widest leading-none">AUTHORIZED ADMIN ONLY</span>
            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-[#008751]/5 border border-green-100">
              <span className={`w-1 h-1 rounded-full ${
                apiStatus === 'connected' ? 'bg-green-500 shadow-sm' : 
                apiStatus === 'error' ? 'bg-red-500 animate-pulse' : 
                'bg-yellow-500'
              }`}></span>
              <span className="text-[6px] font-black uppercase text-green-700">
                Backend: {apiStatus === 'connected' ? 'CONNECTED' : apiStatus === 'error' ? 'OFFLINE' : 'SYNCING'}
              </span>
            </div>
          </div>
        </div>
        <div className="w-12 h-12 bg-[#008751] rounded-2xl flex items-center justify-center shadow-lg transform -rotate-12">
          <i className="fas fa-crown text-white text-xl"></i>
        </div>
      </div>

      <div className="flex items-center space-x-1.5 px-0.5">
        <div className="flex-grow flex space-x-1 bg-[#008751]/10 p-1 rounded-xl border border-green-200 shadow-sm overflow-x-auto no-scrollbar">
          {(['command', 'bulletin', 'tv', 'sports', 'media', 'genres', 'analytics', 'inbox', 'logs'] as Tab[]).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`flex-1 min-w-[44px] py-2 text-[7px] font-black uppercase tracking-widest rounded-lg transition-all relative ${activeTab === t ? 'bg-[#008751] text-white shadow-md' : 'text-green-950/50 hover:text-green-950'}`}>
              {t === 'bulletin' ? 'News' : t === 'tv' ? 'TV' : t === 'sports' ? '⚽' : t === 'genres' ? '🎵' : t === 'analytics' ? '📊' : t}
              {t === 'inbox' && reports.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[6px] w-3 h-3 rounded-full flex items-center justify-center border border-white animate-bounce">{reports.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mx-1 px-4 py-2 bg-blue-600 text-white rounded-xl shadow-lg border border-blue-400">
         <div className="flex items-center space-x-2">
            <i className="fas fa-satellite-dish animate-pulse text-xs"></i>
            <span className="text-[7px] font-black uppercase tracking-widest">Ticker Auto-Sync</span>
         </div>
         <div className="text-right">
            <span className="text-[6px] font-bold uppercase opacity-70 block">Next Headlines In</span>
            <span className="text-[10px] font-mono font-black">{nextSyncIn}</span>
         </div>
      </div>

      {statusMsg && <div className="mx-1 p-2 text-[8px] font-black uppercase text-center rounded-lg bg-green-600 text-white border border-green-700 animate-pulse shadow-sm">{statusMsg}</div>}

      {activeTab === 'command' && (
        <div className="space-y-4">
          <div className="bg-white p-6 rounded-3xl text-center border border-green-100 shadow-md relative">
            <button onClick={isRadioPlaying ? onToggleRadio : onPlayAll} className={`w-28 h-28 rounded-full border-8 ${isRadioPlaying ? 'bg-red-500 border-red-50' : 'bg-[#008751] border-green-50'} text-white flex flex-col items-center justify-center mx-auto mb-4 shadow-2xl active:scale-95 transition-all`}>
              <i className={`fas ${isRadioPlaying ? 'fa-stop' : 'fa-play'} text-3xl mb-1`}></i>
              <span className="text-[9px] font-black uppercase tracking-widest">{isRadioPlaying ? 'Stop' : 'Go Live'}</span>
            </button>
            <div className="bg-green-50 py-2.5 px-5 rounded-2xl border border-green-100 inline-block shadow-inner"><span className="text-[8px] font-black text-green-700 uppercase block tracking-widest truncate max-w-[200px]">{currentTrackName}</span></div>
          </div>

          {/* ── KILL ALL — stop every playing instance globally ── */}
          <button
            onClick={async () => {
              if (!confirm('Kill ALL playing instances? This stops radio and TV for every listener worldwide.')) return;
              // Stop locally
              if (isRadioPlaying) onToggleRadio();
              // Wipe Supabase state completely
              if (hasApi()) {
                await Promise.all([
                  setLiveTrack(null),
                  setLiveTv(null),
                  setLiveStream(''),
                ]).catch(() => {});
              }
              // Clear local stream URL
              dbService.setLiveStreamUrl('');
              setLiveStreamUrlState('');
              setStatusMsg('🛑 All instances killed — radio and TV stopped globally');
              setTimeout(() => setStatusMsg(''), 4000);
            }}
            className="w-full bg-red-900 text-white py-3 rounded-2xl flex items-center justify-center space-x-2 shadow-lg active:scale-95 transition-all border border-red-800"
          >
            <i className="fas fa-skull-crossbones text-sm"></i>
            <span className="text-[8px] font-black uppercase tracking-widest">Kill All Instances</span>
          </button>

          {/* ── LIVE STREAM URL — what all listeners hear ── */}
          <div className="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm space-y-2">
            <div className="flex items-center space-x-2">
              <i className="fas fa-broadcast-tower text-blue-500 text-sm"></i>
              <h3 className="text-[8px] font-black uppercase tracking-widest text-blue-700">Station Broadcast Override</h3>
            </div>
            <p className="text-[6px] text-gray-400 leading-relaxed">
              Enter a live stream URL to broadcast to all listeners (e.g. a Zeno.fm or Icecast stream). Leave blank to use uploaded audio tracks only.
            </p>
            <input
              type="url"
              value={liveStreamUrl}
              onChange={e => setLiveStreamUrlState(e.target.value)}
              placeholder="https://stream.zeno.fm/your-station-id"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-blue-400"
            />
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  const url = liveStreamUrl.trim();
                  dbService.setLiveStreamUrl(url);
                  if (hasApi()) setSharedStreamUrl(url).catch(() => {});
                  if (url && !isRadioPlaying) onPlayStream?.(url);
                  setStatusMsg(url ? '✅ Stream URL saved — playing now' : '✅ Stream URL cleared');
                  setTimeout(() => setStatusMsg(''), 3000);
                }}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-[7px] font-black uppercase"
              >
                Save & Play Stream
              </button>
              {liveStreamUrl && (
                <button
                  onClick={() => { setLiveStreamUrlState(''); dbService.setLiveStreamUrl(''); }}
                  className="px-3 bg-gray-100 text-gray-500 py-2 rounded-lg text-[7px] font-black uppercase"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[6px] text-blue-500 font-bold">
              💡 Free streams: zeno.fm (free tier) · radio.co · mixlr.com · spreaker.com
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => folderInputRef.current?.click()} className="bg-white p-4 rounded-2xl border border-green-100 flex flex-col items-center justify-center space-y-2 hover:bg-green-50 shadow-sm"><i className="fas fa-folder-open text-lg text-green-600"></i><span className="text-[8px] font-black uppercase tracking-widest">Import Folder</span></button>
            <div className="bg-white p-4 rounded-2xl border border-amber-100 space-y-2 shadow-sm">
               <h3 className="text-[7px] font-black uppercase tracking-widest text-amber-600">Jingles</h3>
               <div className="flex space-x-2">
                 <button onClick={() => onPlayJingle?.(1)} className="flex-1 bg-amber-500 text-white py-2 rounded-lg text-[7px] font-black uppercase">ID 1</button>
                 <button onClick={() => onPlayJingle?.(2)} className="flex-1 bg-amber-500 text-white py-2 rounded-lg text-[7px] font-black uppercase">ID 2</button>
               </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'bulletin' && (
        <div className="space-y-4">
          {/* Header bar */}
          <div className="bg-[#008751] p-4 rounded-2xl text-white shadow-lg flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black uppercase italic">Newsroom</h2>
              <p className="text-[7px] opacity-70 uppercase tracking-widest mt-0.5">{news.length} stories loaded</p>
            </div>
            <div className="flex flex-col space-y-1.5 items-end">
              <button
                onClick={async () => { setIsFetchingNews(true); await onRefreshNews(); setIsFetchingNews(false); }}
                disabled={isFetchingNews}
                className="bg-white text-green-700 px-3 py-1.5 rounded-lg text-[7px] font-black uppercase flex items-center space-x-1 disabled:opacity-50"
              >
                <i className={`fas fa-sync-alt text-[8px] ${isFetchingNews ? 'animate-spin' : ''}`}></i>
                <span>{isFetchingNews ? 'Fetching...' : 'Fetch News'}</span>
              </button>
              <button
                onClick={async () => { setIsProcessing(true); setStatusMsg('Broadcasting full bulletin...'); await onTriggerFullBulletin?.(); setIsProcessing(false); setStatusMsg('Bulletin complete.'); setTimeout(() => setStatusMsg(''), 3000); }}
                disabled={isProcessing || news.length === 0}
                className="bg-amber-400 text-amber-900 px-3 py-1.5 rounded-lg text-[7px] font-black uppercase flex items-center space-x-1 disabled:opacity-50"
              >
                <i className="fas fa-broadcast-tower text-[8px]"></i>
                <span>Broadcast Now</span>
              </button>
            </div>
          </div>

          {/* News list */}
          {news.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-green-200 p-10 flex flex-col items-center justify-center text-center space-y-3">
              <i className="fas fa-newspaper text-3xl text-green-200"></i>
              <p className="text-[8px] font-black uppercase text-green-400 tracking-widest">No news loaded yet</p>
              <p className="text-[7px] text-green-300">Tap "Fetch News" to pull latest stories</p>
            </div>
          ) : (
            <div className="space-y-2">
              {news.map((n, idx) => (
                <div key={n.id} className="bg-white p-3 rounded-xl border border-green-50 shadow-sm space-y-2 animate-scale-in">
                  <div className="flex items-start justify-between space-x-2">
                    <div className="flex items-center space-x-1.5 shrink-0">
                      <span className={`text-[5px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest ${
                        n.category === 'Nigeria'  ? 'bg-green-100 text-green-700' :
                        n.category === 'Diaspora' ? 'bg-blue-100 text-blue-700'  :
                        n.category === 'Sports'   ? 'bg-orange-100 text-orange-700' :
                        n.category === 'Economy'  ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{n.category}</span>
                      <span className="text-[5px] text-gray-300 font-mono">#{idx + 1}</span>
                    </div>
                    <button
                      onClick={() => handleManualBroadcast(n)}
                      className="shrink-0 w-6 h-6 bg-green-50 text-green-600 rounded-full flex items-center justify-center hover:bg-green-100"
                      title="Voice broadcast this story"
                    >
                      <i className="fas fa-volume-up text-[7px]"></i>
                    </button>
                  </div>
                  <h4 className="text-[9px] font-black text-green-950 leading-tight">{n.title}</h4>
                  <p className="text-[8px] text-green-700 leading-relaxed">{n.content}</p>
                  <p className="text-[6px] text-gray-300 font-mono">{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {(n as any).sources?.[0] || 'NDR'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'tv' && (
        <div className="space-y-3">
          <div className="bg-gray-950 px-4 py-3 rounded-xl flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-wide">TV Studio</h2>
              <p className="text-[7px] text-gray-400 uppercase tracking-widest mt-0.5">Preview, edit and push video live</p>
            </div>
            <button
              onClick={() => triggerUpload('video/*,image/*')}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[7px] font-black uppercase flex items-center space-x-1"
            >
              <i className="fas fa-cloud-upload-alt text-[8px]"></i>
              <span>Upload</span>
            </button>
          </div>

          {/* ── QUICK STREAM TO TV ── */}
          <QuickStreamBox onPushLive={async (url, name) => {
            const item = {
              id: 'quick-' + Date.now(),
              name: name || 'Live Stream',
              url,
              type: (url.includes('.m3u8') ? 'iptv' : 'youtube') as 'iptv' | 'youtube',
              timestamp: Date.now(),
              isLive: true,
            };
            await dbService.addMedia(item);
            if (hasApi()) {
              await setLiveTv({ url, name: item.name, type: item.type, caption: '', youtubeId: null }).catch(() => {});
            }
            await loadData();
            onRefreshData();
            setStatusMsg('📺 Stream pushed live to TV');
            setTimeout(() => setStatusMsg(''), 3000);
          }} />

          <TvMonitor mediaList={mediaList} onMediaUpdated={async () => { await loadData(); onRefreshData(); }} />

          {/* ── FREE MOVIES & STREAMING SITES ── */}
          <div className="bg-gray-900 rounded-2xl p-4 space-y-3">
            <div className="flex items-center space-x-2">
              <i className="fas fa-film text-purple-400 text-sm"></i>
              <h3 className="text-[8px] font-black uppercase tracking-widest text-purple-300">Free Movies & Streaming</h3>
            </div>
            <p className="text-[6px] text-gray-400">Tap any site to load it in the Quick Stream box, then push live to all viewers.</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { name: 'Stremio Web',      url: 'https://web.stremio.com',                    emoji: '🎬', desc: 'Movies & Series' },
                { name: 'Pluto TV',         url: 'https://pluto.tv',                           emoji: '📺', desc: 'Free live TV & movies' },
                { name: 'Tubi',             url: 'https://tubitv.com',                         emoji: '🎥', desc: 'Free movies & shows' },
                { name: 'Crackle',          url: 'https://www.crackle.com',                    emoji: '🍿', desc: 'Free Hollywood movies' },
                { name: 'Plex',             url: 'https://watch.plex.tv/live-tv',              emoji: '▶️', desc: 'Free live TV & movies' },
                { name: 'Kanopy',           url: 'https://www.kanopy.com',                     emoji: '🎭', desc: 'Free with library card' },
                { name: 'Nollywood Films',  url: 'https://www.youtube.com/@NollywoodPictures/videos', emoji: '🇳🇬', desc: 'Nigerian movies on YouTube' },
                { name: 'African Films',    url: 'https://www.youtube.com/@AfricanMoviesTV/videos',   emoji: '🌍', desc: 'African movies on YouTube' },
                { name: 'FilmRise',         url: 'https://www.filmrise.com',                   emoji: '🎞️', desc: 'Free classic movies' },
                { name: 'Popcornflix',      url: 'https://www.popcornflix.com',                emoji: '🍿', desc: 'Free movies & TV' },
              ].map(site => (
                <button
                  key={site.url}
                  onClick={() => {
                    // Pre-fill the Quick Stream box
                    setStatusMsg(`📺 ${site.name} loaded — tap "Push Live to TV" above`);
                    setTimeout(() => setStatusMsg(''), 4000);
                    // Push directly to TV
                    const item = {
                      id: 'movie-' + Date.now(),
                      name: site.name,
                      url: site.url,
                      type: 'youtube' as const,
                      timestamp: Date.now(),
                      isLive: true,
                    };
                    dbService.addMedia(item).then(() => {
                      if (hasApi()) {
                        setLiveTv({ url: site.url, name: site.name, type: 'youtube', caption: site.desc, youtubeId: null } as any).catch(() => {});
                      }
                      loadData();
                      onRefreshData();
                    });
                  }}
                  className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl p-3 text-left transition-all active:scale-95 space-y-1"
                >
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">{site.emoji}</span>
                    <p className="text-[8px] font-black text-white truncate">{site.name}</p>
                  </div>
                  <p className="text-[6px] text-gray-400">{site.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sports' && (
        <SportsTv
          onPushLive={async (ch: SportChannel) => {
            // Convert SportChannel to MediaFile and push to listener screen
            const mediaItem: MediaFile = {
              id: ch.id,
              name: ch.name,
              url: ch.url,
              type: ch.url.includes('.m3u8') ? 'iptv' : 'youtube',
              timestamp: ch.timestamp,
              isLive: true,
              caption: ch.matchInfo,
              sponsorName: ch.category,
            };
            await dbService.updateMedia(mediaItem);
            onRefreshData();
          }}
        />
      )}

      {activeTab === 'media' && (
        <div className="space-y-4">
          {/* Sub-tabs: Audio / Video / Ads */}
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-xl">
            {(['audio', 'video', 'ads'] as const).map(t => (
              <button key={t} onClick={() => setMediaSubTab(t as any)}
                className={`flex-1 py-2 text-[7px] font-black uppercase rounded-lg transition-all ${mediaSubTab === t ? 'bg-white shadow text-green-700' : 'text-gray-400'}`}>
                {t === 'audio' ? '🎵 Audio' : t === 'video' ? '🎬 Video' : '📢 Ads'}
              </button>
            ))}
          </div>

          {/* ── AUDIO TAB ── */}
          {mediaSubTab === 'audio' && (
            <div className="space-y-3">
              {/* Upload + Master Play + Master Delete */}
              <div className="flex space-x-2">
                <button onClick={() => triggerUpload('audio/*')}
                  className="flex-1 bg-[#008751] text-white py-2.5 rounded-xl flex items-center justify-center space-x-1 shadow active:scale-95">
                  <i className="fas fa-cloud-upload-alt text-[10px]"></i>
                  <span className="text-[8px] font-black uppercase">Upload Audio</span>
                </button>
                <button onClick={() => {
                  const allAudio = [...cloudMedia.filter(m => m && m.type === 'audio'), ...mediaList.filter(m => m && m.type === 'audio' && m.url && String(m.url).startsWith('http'))];
                  if (allAudio.length > 0) onPlayTrack(allAudio[Math.floor(Math.random() * allAudio.length)]);
                }}
                  className="flex-1 bg-green-600 text-white py-2.5 rounded-xl flex items-center justify-center space-x-1 shadow active:scale-95">
                  <i className="fas fa-play text-[10px]"></i>
                  <span className="text-[8px] font-black uppercase">Play All</span>
                </button>
              </div>

              {/* Cloud status */}
              <div className={`px-3 py-2 rounded-xl flex items-center justify-between ${hasApi() ? 'bg-blue-50 border border-blue-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                <div className="flex items-center space-x-2">
                  <i className={`fas fa-cloud text-sm ${hasApi() ? 'text-blue-500' : 'text-yellow-500'}`}></i>
                  <div>
                    <p className={`text-[7px] font-black uppercase ${hasApi() ? 'text-blue-700' : 'text-yellow-700'}`}>{hasApi() ? 'Cloud Sync Active' : 'Local Only'}</p>
                    <p className={`text-[6px] ${hasApi() ? 'text-blue-500' : 'text-yellow-600'}`}>{hasApi() ? 'All uploads sync to cloud automatically' : 'Add Cloudinary keys to enable cloud sync'}</p>
                  </div>
                </div>
                <button onClick={loadCloudMedia} className="text-blue-500"><i className={`fas fa-sync-alt text-[10px] ${isLoadingCloud ? 'animate-spin' : ''}`}></i></button>
              </div>

              {/* Manual sync button */}
              <button 
                onClick={syncAllMediaToCloud} 
                disabled={isProcessing}
                className="w-full bg-blue-600/10 text-blue-700 border border-blue-200 py-3 rounded-2xl flex items-center justify-center space-x-2 shadow-sm active:scale-95 transition-all"
              >
                <i className={`fas ${isProcessing ? 'fa-circle-notch fa-spin' : 'fa-cloud-upload-alt'} text-xs`}></i>
                <span className="text-[8px] font-black uppercase tracking-widest">Duplicate All Local Files to Cloud</span>
              </button>

              {/* Unified track list — cloud + local merged */}
              {(() => {
                const cloudAudio = cloudMedia.filter(m => m && m.type === 'audio');
                const localAudio = mediaList.filter(m => m && m.type === 'audio');
                // Merge: cloud items first, then local-only items not in cloud
                const cloudIds = new Set(cloudAudio.map(c => c.id));
                const localOnly = localAudio.filter(l => !cloudIds.has(l.id) && !cloudAudio.find(c => c.name === l.name));
                const allTracks = [...cloudAudio, ...localOnly];
                return (
                  <div className="space-y-2">
                    {/* Master delete */}
                    {allTracks.length > 0 && (
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[7px] font-black uppercase text-gray-500">{allTracks.length} tracks</span>
                        <button onClick={async () => {
                          if (!confirm('Delete ALL audio tracks? This cannot be undone.')) return;
                          for (const t of localAudio) await dbService.deleteMedia(t.id);
                          if (hasApi()) {
                            for (const t of cloudAudio) await deleteSharedMedia(t.id);
                          }
                          await loadData(); await loadCloudMedia();
                          setStatusMsg('🗑 All audio deleted');
                          setTimeout(() => setStatusMsg(''), 3000);
                        }} className="flex items-center space-x-1 px-2 py-1 bg-red-50 text-red-500 rounded-lg text-[6px] font-black uppercase hover:bg-red-100">
                          <i className="fas fa-trash text-[7px]"></i><span>Delete All</span>
                        </button>
                      </div>
                    )}
                    {allTracks.length === 0 ? (
                      <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 p-8 text-center">
                        <i className="fas fa-music text-2xl text-gray-200 mb-2 block"></i>
                        <p className="text-[7px] text-gray-300 font-black uppercase">No audio tracks yet</p>
                      </div>
                    ) : allTracks.map(item => {
                      const isCloud = item.url && String(item.url).startsWith('http');
                      return (
                        <div key={item.id} className={`p-3 rounded-xl border flex items-center justify-between shadow-sm ${isCloud ? 'bg-blue-50 border-blue-100' : 'bg-white border-green-50'}`}>
                          <div className="flex items-center space-x-2 truncate pr-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isCloud ? 'bg-blue-500' : 'bg-gray-200'}`}>
                              <i className={`fas ${isCloud ? 'fa-cloud' : 'fa-hdd'} text-white text-[7px]`}></i>
                            </div>
                            <div className="truncate">
                              <p className="text-[9px] font-bold text-gray-900 truncate">{String(item.name || 'Unknown Track').replace(/\.(mp3|wav|m4a|aac|ogg|flac)$/i, '')}</p>
                              <p className={`text-[6px] ${isCloud ? 'text-blue-400' : 'text-gray-400'}`}>{isCloud ? '☁️ Cloud' : '📱 Local only'}</p>
                            </div>
                          </div>
                          <div className="flex space-x-1 shrink-0">
                            <button onClick={() => onPlayTrack(item)} className={`w-7 h-7 rounded-full flex items-center justify-center ${isCloud ? 'bg-blue-100 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                              <i className="fas fa-play text-[8px]"></i>
                            </button>
                            <button onClick={async () => {
                              await dbService.deleteMedia(item.id);
                              if (hasApi() && isCloud) await deleteSharedMedia(item.id);
                              await loadData(); await loadCloudMedia();
                            }} className="w-7 h-7 bg-red-50 text-red-400 rounded-full flex items-center justify-center hover:bg-red-100">
                              <i className="fas fa-trash text-[7px]"></i>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── VIDEO TAB ── */}
          {mediaSubTab === 'video' && (
            <div className="space-y-3">
              <div className="flex space-x-2">
                <button onClick={() => triggerUpload('video/*')}
                  className="flex-1 bg-purple-600 text-white py-2.5 rounded-xl flex items-center justify-center space-x-1 shadow active:scale-95">
                  <i className="fas fa-cloud-upload-alt text-[10px]"></i>
                  <span className="text-[8px] font-black uppercase">Upload Video</span>
                </button>
              </div>
              {(() => {
                const videos = mediaList.filter(m => m && (m.type === 'video' || m.type === 'youtube' || m.type === 'iptv'));
                return (
                  <div className="space-y-2">
                    {videos.length > 0 && (
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[7px] font-black uppercase text-gray-500">{videos.length} videos</span>
                        <button onClick={async () => {
                          if (!confirm('Delete ALL videos?')) return;
                          for (const v of videos) await dbService.deleteMedia(v.id);
                          await loadData();
                          setStatusMsg('🗑 All videos deleted');
                          setTimeout(() => setStatusMsg(''), 3000);
                        }} className="flex items-center space-x-1 px-2 py-1 bg-red-50 text-red-500 rounded-lg text-[6px] font-black uppercase hover:bg-red-100">
                          <i className="fas fa-trash text-[7px]"></i><span>Delete All</span>
                        </button>
                      </div>
                    )}
                    {videos.length === 0 ? (
                      <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 p-8 text-center">
                        <i className="fas fa-film text-2xl text-gray-200 mb-2 block"></i>
                        <p className="text-[7px] text-gray-300 font-black uppercase">No videos yet — add from TV tab</p>
                      </div>
                    ) : videos.map(item => (
                      <div key={item.id} className="bg-white p-3 rounded-xl border border-purple-50 flex items-center justify-between shadow-sm">
                        <div className="flex items-center space-x-2 truncate pr-2">
                          <div className="w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center shrink-0">
                            <i className={`fas ${item.type === 'youtube' ? 'fa-youtube' : item.type === 'iptv' ? 'fa-satellite-dish' : 'fa-film'} text-purple-500 text-[7px]`}></i>
                          </div>
                          <div className="truncate">
                            <p className="text-[9px] font-bold text-gray-900 truncate">{item.name || 'Unknown Video'}</p>
                            <p className="text-[6px] text-gray-400 uppercase">{item.type}{item.isLive ? ' · 🔴 Live' : ''}</p>
                          </div>
                        </div>
                        <button onClick={async () => {
                          await dbService.deleteMedia(item.id);
                          await loadData();
                        }} className="w-7 h-7 bg-red-50 text-red-400 rounded-full flex items-center justify-center shrink-0">
                          <i className="fas fa-trash text-[7px]"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── ADS TAB ── */}
          {(mediaSubTab as string) === 'ads' && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                <h3 className="text-[8px] font-black uppercase text-amber-700 flex items-center space-x-1">
                  <i className="fas fa-ad text-amber-500"></i><span>Ad Schedule</span>
                </h3>
                <p className="text-[6px] text-amber-600">Set how often ads appear between videos on the Live Monitor</p>
                <div className="flex items-center space-x-2">
                  <span className="text-[7px] text-gray-600 font-black">Show ad every</span>
                  <select
                    value={adInterval}
                    onChange={e => { setAdInterval(Number(e.target.value)); localStorage.setItem('ndr_ad_interval', e.target.value); }}
                    className="bg-white border border-amber-200 rounded-lg px-2 py-1 text-[8px] font-black outline-none"
                  >
                    <option value={1}>1 video</option>
                    <option value={2}>2 videos</option>
                    <option value={3}>3 videos</option>
                    <option value={5}>5 videos</option>
                    <option value={10}>10 videos</option>
                    <option value={0}>Never</option>
                  </select>
                  <span className="text-[7px] text-gray-600 font-black">played</span>
                </div>
              </div>

              <button onClick={() => triggerUpload('video/*,image/*')}
                className="w-full bg-amber-500 text-white py-2.5 rounded-xl flex items-center justify-center space-x-1 shadow active:scale-95">
                <i className="fas fa-cloud-upload-alt text-[10px]"></i>
                <span className="text-[8px] font-black uppercase">Upload Ad (Video/Image)</span>
              </button>

              {/* Ad library — images and videos marked as ads */}
              {(() => {
                const ads = mediaList.filter(m => m && (m.type === 'image' || (m.type === 'video' && m.sponsorName)));
                return ads.length === 0 ? (
                  <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 p-8 text-center">
                    <i className="fas fa-ad text-2xl text-gray-200 mb-2 block"></i>
                    <p className="text-[7px] text-gray-300 font-black uppercase">No ads yet</p>
                    <p className="text-[6px] text-gray-300">Upload images or videos above to use as ads</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {ads.map(item => (
                      <div key={item.id} className="bg-amber-50 p-3 rounded-xl border border-amber-100 flex items-center justify-between">
                        <div className="flex items-center space-x-2 truncate pr-2">
                          <i className={`fas ${item.type === 'image' ? 'fa-image' : 'fa-film'} text-amber-500 text-sm shrink-0`}></i>
                          <p className="text-[9px] font-bold text-gray-900 truncate">{item.name || 'Unknown Ad'}</p>
                        </div>
                        <button onClick={async () => { await dbService.deleteMedia(item.id); await loadData(); }}
                          className="w-7 h-7 bg-red-50 text-red-400 rounded-full flex items-center justify-center shrink-0">
                          <i className="fas fa-trash text-[7px]"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
      
      {activeTab === 'genres' && (
        <GenreManager
          allTracks={[...cloudMedia.filter(m => m.type === 'audio'), ...mediaList.filter(m => m.type === 'audio')]}
          onPlayGenre={(tracks) => {
            if (tracks.length > 0) {
              onPlayTrack(tracks[Math.floor(Math.random() * tracks.length)]);
            }
          }}
        />
      )}

      {activeTab === 'analytics' && (
        <AnalyticsDashboard />
      )}

      {activeTab === 'inbox' && (
        <div className="space-y-3">
          <div className="bg-gray-900 px-4 py-3 rounded-xl flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-wide">Journalist Inbox</h2>
              <p className="text-[7px] text-gray-400 uppercase tracking-widest mt-0.5">{reports.length} reports from listeners</p>
            </div>
            <i className="fas fa-inbox text-gray-400 text-lg" />
          </div>
          {reports.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 p-10 text-center">
              <i className="fas fa-inbox text-3xl text-gray-200 mb-2 block" />
              <p className="text-[8px] font-black uppercase text-gray-400">No reports yet</p>
              <p className="text-[7px] text-gray-300 mt-1">Listener reports will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map(r => (
                <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 bg-[#008751]/10 rounded-full flex items-center justify-center">
                        <i className="fas fa-user text-[#008751] text-[8px]" />
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-gray-800">{r.reporterName || 'Listener'}</p>
                        <p className="text-[6px] text-gray-400 flex items-center space-x-1">
                          <i className="fas fa-map-marker-alt text-red-400 text-[6px]" />
                          <span>{r.location}</span>
                        </p>
                      </div>
                    </div>
                    <span className="text-[6px] text-gray-400 font-mono">
                      {new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {r.content && <p className="text-[9px] text-gray-700 leading-relaxed">"{r.content}"</p>}
                  {/* Video report */}
                  {r.videoUrl && r.videoType === 'upload' && (
                    <div className="rounded-xl overflow-hidden border border-gray-100 bg-black" style={{ height: '160px' }}>
                      <video src={r.videoUrl} controls className="w-full h-full object-contain" playsInline />
                    </div>
                  )}
                  {r.videoUrl && r.videoType === 'youtube' && (
                    <div className="rounded-xl overflow-hidden border border-gray-100">
                      <a href={r.videoUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center space-x-2 p-3 bg-red-50 hover:bg-red-100 transition-colors">
                        <i className="fab fa-youtube text-red-500 text-lg" />
                        <span className="text-[8px] font-black text-red-700 truncate">{r.videoUrl}</span>
                        <i className="fas fa-external-link-alt text-red-400 text-[7px] shrink-0" />
                      </a>
                    </div>
                  )}
                  {r.videoUrl && (
                    <span className="inline-flex items-center space-x-1 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                      <i className="fas fa-video text-green-500 text-[6px]" />
                      <span className="text-[6px] font-black text-green-700 uppercase">Video Report</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="bg-white rounded-xl border border-green-50 p-2 max-h-[300px] overflow-y-auto font-mono text-[7px]">
          {logs.map(log => (
            <div key={log.id} className="border-b border-green-50 py-1 flex justify-between">
              <span className="text-green-700">{log.action}</span>
              <span className="text-gray-400 shrink-0 ml-2">{new Date(log.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminView;
