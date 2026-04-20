
import React, { useState, useEffect, useRef } from 'react';
import { dbService } from '../services/dbService';
import { AdminLog, MediaFile, NewsItem, ListenerReport, SportChannel } from '../types';
import TvMonitor from './TvMonitor';
import SportsTv from './SportsTv';
import { getSharedMedia, hasApi, addMediaToCloud } from '../services/apiService';

interface AdminViewProps {
  onRefreshData: () => void;
  onRefreshNews: () => Promise<void>;
  logs: AdminLog[];
  onPlayTrack: (track: MediaFile) => void;
  isRadioPlaying: boolean;
  onToggleRadio: () => void;
  currentTrackName: string;
  isShuffle: boolean;
  onToggleShuffle: () => void;
  onPlayAll: () => void;
  onSkipNext: () => void;
  onPushBroadcast?: (voiceText: string) => Promise<void>;
  onPlayJingle?: (index: 1 | 2) => Promise<void>;
  news?: NewsItem[];
  onTriggerFullBulletin?: () => Promise<void>;
}

type Tab = 'command' | 'bulletin' | 'tv' | 'sports' | 'media' | 'inbox' | 'logs';
type MediaSubTab = 'audio' | 'video' | 'ads';

const AdminView: React.FC<AdminViewProps> = ({ 
  onRefreshData,
  onRefreshNews,
  logs, 
  onPlayTrack, 
  isRadioPlaying, 
  onToggleRadio,
  currentTrackName,
  isShuffle,
  onToggleShuffle,
  onPlayAll,
  onSkipNext,
  onPushBroadcast,
  onPlayJingle,
  news = [],
  onTriggerFullBulletin
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
    if (mediaSubTab === 'audio') return m.type === 'audio';
    return m.type === 'video' || m.type === 'image';
  });

  return (
    <div className="space-y-4 pb-20 text-green-900 animate-scale-in">
      <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileUpload} />
      <input type="file" ref={folderInputRef} className="hidden" webkitdirectory="true" directory="true" multiple onChange={handleFileUpload} />

      <div className="flex items-center space-x-1.5 px-0.5">
        <div className="flex-grow flex space-x-1 bg-[#008751]/10 p-1 rounded-xl border border-green-200 shadow-sm overflow-x-auto no-scrollbar">
          {(['command', 'bulletin', 'tv', 'sports', 'media', 'inbox', 'logs'] as Tab[]).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`flex-1 min-w-[44px] py-2 text-[7px] font-black uppercase tracking-widest rounded-lg transition-all relative ${activeTab === t ? 'bg-[#008751] text-white shadow-md' : 'text-green-950/50 hover:text-green-950'}`}>
              {t === 'bulletin' ? 'News' : t === 'tv' ? 'TV' : t === 'sports' ? '⚽' : t}
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

          {/* ── LIVE STREAM URL — what all listeners hear ── */}
          <div className="bg-white p-4 rounded-2xl border border-blue-100 shadow-sm space-y-2">
            <div className="flex items-center space-x-2">
              <i className="fas fa-broadcast-tower text-blue-500 text-sm"></i>
              <h3 className="text-[8px] font-black uppercase tracking-widest text-blue-700">Listener Stream URL</h3>
            </div>
            <p className="text-[6px] text-gray-400 leading-relaxed">
              Set a live stream URL that ALL listeners hear when they tap play. Use Zeno.fm, Radio.co, or any .mp3/.m3u8 stream. This is how listeners hear the same music as you.
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
                  dbService.setLiveStreamUrl(liveStreamUrl.trim());
                  setStatusMsg('✅ Stream URL saved — listeners will hear this when they tap play');
                  setTimeout(() => setStatusMsg(''), 3000);
                }}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-[7px] font-black uppercase"
              >
                Save Stream URL
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
          <TvMonitor mediaList={mediaList} onMediaUpdated={async () => { await loadData(); onRefreshData(); }} />
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
                  const allAudio = [...cloudMedia.filter(m => m.type === 'audio'), ...mediaList.filter(m => m.type === 'audio' && m.url?.startsWith('http'))];
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

              {/* Unified track list — cloud + local merged */}
              {(() => {
                const cloudAudio = cloudMedia.filter(m => m.type === 'audio');
                const localAudio = mediaList.filter(m => m.type === 'audio');
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
                          // Delete all local
                          for (const t of localAudio) await dbService.deleteMedia(t.id);
                          // Delete all cloud
                          if (hasApi()) {
                            const remaining = (await getSharedMedia()).filter(m => m.type !== 'audio');
                            await fetch(`${import.meta.env.VITE_API_URL}/media`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(remaining) });
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
                      const isCloud = item.url?.startsWith('http');
                      return (
                        <div key={item.id} className={`p-3 rounded-xl border flex items-center justify-between shadow-sm ${isCloud ? 'bg-blue-50 border-blue-100' : 'bg-white border-green-50'}`}>
                          <div className="flex items-center space-x-2 truncate pr-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isCloud ? 'bg-blue-500' : 'bg-gray-200'}`}>
                              <i className={`fas ${isCloud ? 'fa-cloud' : 'fa-hdd'} text-white text-[7px]`}></i>
                            </div>
                            <div className="truncate">
                              <p className="text-[9px] font-bold text-gray-900 truncate">{item.name.replace(/\.(mp3|wav|m4a|aac|ogg|flac)$/i, '')}</p>
                              <p className={`text-[6px] ${isCloud ? 'text-blue-400' : 'text-gray-400'}`}>{isCloud ? '☁️ Cloud' : '📱 Local only'}</p>
                            </div>
                          </div>
                          <div className="flex space-x-1 shrink-0">
                            <button onClick={() => onPlayTrack(item)} className={`w-7 h-7 rounded-full flex items-center justify-center ${isCloud ? 'bg-blue-100 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                              <i className="fas fa-play text-[8px]"></i>
                            </button>
                            <button onClick={async () => {
                              // Delete local
                              await dbService.deleteMedia(item.id);
                              // Delete from cloud if it's there
                              if (hasApi() && isCloud) {
                                const all = await getSharedMedia();
                                const updated = all.filter((m: any) => m.id !== item.id);
                                await fetch(`${import.meta.env.VITE_API_URL}/media`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
                              }
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
                const videos = mediaList.filter(m => m.type === 'video' || m.type === 'youtube' || m.type === 'iptv');
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
                            <p className="text-[9px] font-bold text-gray-900 truncate">{item.name}</p>
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
                const ads = mediaList.filter(m => m.type === 'image' || (m.type === 'video' && m.sponsorName));
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
                          <p className="text-[9px] font-bold text-gray-900 truncate">{item.name}</p>
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
