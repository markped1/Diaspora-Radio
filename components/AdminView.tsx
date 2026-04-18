
import React, { useState, useEffect, useRef } from 'react';
import { dbService } from '../services/dbService';
import { AdminLog, MediaFile, NewsItem, ListenerReport } from '../types';
import TvMonitor from './TvMonitor';

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

type Tab = 'command' | 'bulletin' | 'media' | 'inbox' | 'logs';
type MediaSubTab = 'audio' | 'video';

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
  const [reports, setReports] = useState<ListenerReport[]>([]);
  const [voiceMsg, setVoiceMsg] = useState('');
  const [nextSyncIn, setNextSyncIn] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    const [m, r] = await Promise.all([dbService.getMedia(), dbService.getReports()]);
    setMediaList(m || []);
    setReports(r || []);
  };

  useEffect(() => {
    loadData();
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

        setStatusMsg(`Importing: ${count + 1}...`);
        await dbService.addMedia({ 
          id: 'local-' + Math.random().toString(36).substr(2, 9), 
          name: file.name, 
          url: '', 
          file: file,
          type: finalType, 
          timestamp: Date.now(), 
          likes: 0 
        });
        count++;
      }
      setStatusMsg(`Success: ${count} items added.`);
      onRefreshData();
      await loadData();
    } catch (error) { setStatusMsg('Import Error.'); }
    finally { setIsProcessing(false); setTimeout(() => setStatusMsg(''), 5000); if (e.target) e.target.value = ''; }
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
          {(['command', 'bulletin', 'media', 'inbox', 'logs'] as Tab[]).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`flex-1 min-w-[65px] py-2 text-[9.5px] font-black uppercase tracking-widest rounded-lg transition-all relative ${activeTab === t ? 'bg-[#008751] text-white shadow-md' : 'text-green-950/50 hover:text-green-950'}`}>
              {t === 'bulletin' ? 'Newsroom' : t}
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

      {activeTab === 'media' && (
        <div className="space-y-4">
          <div className="flex bg-[#008751]/5 p-1 rounded-xl border border-green-100">
             <button onClick={() => setMediaSubTab('audio')} className={`flex-1 py-2 text-[8px] font-black uppercase rounded-lg ${mediaSubTab === 'audio' ? 'bg-white text-[#008751] shadow-sm' : 'text-green-600/60'}`}>Tracks</button>
             <button onClick={() => setMediaSubTab('video')} className={`flex-1 py-2 text-[8px] font-black uppercase rounded-lg ${mediaSubTab === 'video' ? 'bg-white text-[#008751] shadow-sm' : 'text-green-600/60'}`}>TV Studio</button>
          </div>

          {mediaSubTab === 'video' && (
            <div className="space-y-3">
              <button
                onClick={() => triggerUpload('video/*,image/*')}
                className="w-full bg-blue-600 text-white py-3 rounded-2xl flex items-center justify-center space-x-2 shadow-lg active:scale-95 transition-all"
              >
                <i className="fas fa-cloud-upload-alt"></i>
                <span className="text-[10px] font-black uppercase tracking-widest">Upload Video / Image</span>
              </button>
              <TvMonitor mediaList={mediaList} onMediaUpdated={async () => { await loadData(); onRefreshData(); }} />
            </div>
          )}

          {mediaSubTab === 'audio' && (
            <div className="grid gap-2">
              {filteredMedia.map(item => (
                <div key={item.id} className="bg-white p-3 rounded-xl border border-green-50 flex items-center justify-between shadow-sm animate-scale-in">
                  <div className="flex items-center space-x-3 truncate pr-4">
                    <i className="fas fa-music text-xs text-green-600"></i>
                    <p className="text-[9px] font-bold text-green-950 truncate">{item.name}</p>
                  </div>
                  <div className="flex space-x-1">
                     <button onClick={() => onPlayTrack(item)} className="w-7 h-7 bg-green-50 text-green-600 rounded-full flex items-center justify-center"><i className="fas fa-play text-[8px]"></i></button>
                     <button onClick={() => dbService.deleteMedia(item.id).then(loadData)} className="w-7 h-7 bg-red-50 text-red-500 rounded-full flex items-center justify-center"><i className="fas fa-trash-alt text-[8px]"></i></button>
                  </div>
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
