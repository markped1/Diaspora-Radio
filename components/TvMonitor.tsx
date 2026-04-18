import React, { useRef, useState, useEffect } from 'react';
import { MediaFile } from '../types';
import { dbService } from '../services/dbService';

interface TvMonitorProps {
  mediaList: MediaFile[];
  onMediaUpdated: () => void;
}

const TvMonitor: React.FC<TvMonitorProps> = ({ mediaList, onMediaUpdated }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selected, setSelected] = useState<MediaFile | null>(null);
  const [caption, setCaption] = useState('');
  const [sponsorName, setSponsorName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // Videos and images only
  const videoMedia = mediaList.filter(m => m.type === 'video' || m.type === 'image');
  const liveItems = videoMedia.filter(m => m.isLive);

  // Resolve blob URL for selected item
  const resolveUrl = (item: MediaFile): string => {
    if (item.url && item.url.startsWith('blob:')) return item.url;
    if (item.file) return URL.createObjectURL(item.file);
    return item.url;
  };

  useEffect(() => {
    if (selected) {
      setCaption(selected.caption || '');
      setSponsorName(selected.sponsorName || '');
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [selected?.id]);

  useEffect(() => {
    if (videoRef.current && selected?.type === 'video') {
      const url = resolveUrl(selected);
      videoRef.current.src = url;
      videoRef.current.load();
    }
  }, [selected?.id]);

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handlePushLive = async () => {
    if (!selected) return;
    setIsSaving(true);
    try {
      // Push this item live, take all others offline
      for (const item of videoMedia) {
        const updated = { ...item, isLive: item.id === selected.id };
        if (item.id === selected.id) {
          updated.caption = caption.trim();
          updated.sponsorName = sponsorName.trim();
        }
        await dbService.updateMedia(updated);
      }
      setFeedback('✅ Pushed live to listener screen!');
      onMediaUpdated();
    } catch {
      setFeedback('❌ Failed to push live');
    } finally {
      setIsSaving(false);
      setTimeout(() => setFeedback(''), 3000);
    }
  };

  const handleTakeOffline = async (item: MediaFile) => {
    await dbService.updateMedia({ ...item, isLive: false });
    setFeedback('Taken offline.');
    onMediaUpdated();
    setTimeout(() => setFeedback(''), 2000);
  };

  const handleSaveEdits = async () => {
    if (!selected) return;
    setIsSaving(true);
    try {
      await dbService.updateMedia({
        ...selected,
        caption: caption.trim(),
        sponsorName: sponsorName.trim(),
      });
      setFeedback('Edits saved.');
      onMediaUpdated();
    } catch {
      setFeedback('Save failed.');
    } finally {
      setIsSaving(false);
      setTimeout(() => setFeedback(''), 2000);
    }
  };

  return (
    <div className="space-y-4">

      {/* ── TV MONITOR ── */}
      <div className="bg-gray-950 rounded-none border-4 border-gray-800 shadow-2xl overflow-hidden">
        {/* Screen bezel top */}
        <div className="bg-gray-900 px-3 py-1.5 flex items-center justify-between border-b border-gray-800">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
            <span className="w-2 h-2 rounded-full bg-green-400"></span>
          </div>
          <span className="text-[7px] font-black uppercase tracking-widest text-gray-400">
            NDR TV Monitor
          </span>
          <span className={`text-[6px] font-black uppercase px-2 py-0.5 rounded-full ${
            selected?.isLive ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-400'
          }`}>
            {selected?.isLive ? '● LIVE' : 'PREVIEW'}
          </span>
        </div>

        {/* Screen */}
        <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
          {selected ? (
            selected.type === 'image' ? (
              <img
                src={resolveUrl(selected)}
                className="w-full h-full object-contain"
                alt={selected.name}
              />
            ) : (
              <video
                ref={videoRef}
                className="w-full h-full object-contain"
                muted={isMuted}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                onEnded={() => setIsPlaying(false)}
                playsInline
              />
            )
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 space-y-2">
              <i className="fas fa-tv text-4xl"></i>
              <span className="text-[8px] font-black uppercase tracking-widest">Select a video below to preview</span>
            </div>
          )}

          {/* Caption overlay */}
          {selected && caption && (
            <div className="absolute bottom-0 inset-x-0 bg-black/70 px-3 py-1.5">
              <p className="text-[8px] text-white font-bold text-center">{caption}</p>
            </div>
          )}

          {/* Sponsor badge */}
          {selected && sponsorName && (
            <div className="absolute top-2 left-2 bg-black/60 px-2 py-0.5 rounded-full">
              <span className="text-[6px] font-black text-white uppercase tracking-widest">{sponsorName}</span>
            </div>
          )}
        </div>

        {/* Video controls */}
        {selected?.type === 'video' && (
          <div className="bg-gray-900 px-3 py-2 space-y-1.5">
            {/* Seek bar */}
            <input
              type="range" min={0} max={duration || 100} step={0.1} value={currentTime}
              onChange={handleSeek}
              className="w-full h-0.5 accent-red-500 cursor-pointer"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <button onClick={handlePlayPause} className="w-7 h-7 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20">
                  <i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'} text-[9px]`}></i>
                </button>
                <button onClick={() => { setIsMuted(!isMuted); if (videoRef.current) videoRef.current.muted = !isMuted; }}
                  className="w-7 h-7 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20">
                  <i className={`fas ${isMuted ? 'fa-volume-mute' : 'fa-volume-up'} text-[9px]`}></i>
                </button>
                <input type="range" min={0} max={1} step={0.05} value={volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-0.5 accent-white cursor-pointer"
                />
              </div>
              <span className="text-[7px] font-mono text-gray-400">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>
        )}

        {/* Screen bezel bottom */}
        <div className="bg-gray-900 px-3 py-2 border-t border-gray-800 flex items-center justify-between">
          <span className="text-[7px] text-gray-500 truncate max-w-[60%]">
            {selected ? selected.name : 'No file selected'}
          </span>
          <div className="flex space-x-2">
            <button
              onClick={handleSaveEdits}
              disabled={!selected || isSaving}
              className="px-3 py-1 bg-gray-700 text-white text-[7px] font-black uppercase rounded-lg disabled:opacity-40 hover:bg-gray-600"
            >
              Save Edits
            </button>
            <button
              onClick={handlePushLive}
              disabled={!selected || isSaving}
              className="px-3 py-1 bg-red-600 text-white text-[7px] font-black uppercase rounded-lg disabled:opacity-40 hover:bg-red-500 flex items-center space-x-1"
            >
              <i className="fas fa-broadcast-tower text-[8px]"></i>
              <span>Push Live</span>
            </button>
          </div>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className="text-center text-[8px] font-black uppercase text-green-600 animate-pulse">
          {feedback}
        </div>
      )}

      {/* ── EDIT PANEL ── */}
      {selected && (
        <div className="bg-white rounded-xl border border-green-100 p-3 space-y-3 shadow-sm">
          <h3 className="text-[8px] font-black uppercase tracking-widest text-green-700">Edit Before Publishing</h3>
          <div className="space-y-2">
            <div>
              <label className="text-[7px] font-black uppercase text-gray-400 block mb-1">Caption (shown on screen)</label>
              <input
                type="text"
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="e.g. Watch: NDR Special Report"
                className="w-full bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-green-400"
              />
            </div>
            <div>
              <label className="text-[7px] font-black uppercase text-gray-400 block mb-1">Sponsor Name</label>
              <input
                type="text"
                value={sponsorName}
                onChange={e => setSponsorName(e.target.value)}
                placeholder="e.g. Global Diaspora Network"
                className="w-full bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-green-400"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── CURRENTLY LIVE ── */}
      {liveItems.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[7px] font-black uppercase text-red-500 tracking-widest px-1 flex items-center space-x-1">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping inline-block"></span>
            <span>Currently Live on Listener Screen</span>
          </h3>
          {liveItems.map(item => (
            <div key={item.id} className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center space-x-2 truncate">
                <i className="fas fa-film text-red-400 text-xs shrink-0"></i>
                <div className="truncate">
                  <p className="text-[9px] font-black text-red-800 truncate">{item.name}</p>
                  {item.caption && <p className="text-[7px] text-red-400 truncate">{item.caption}</p>}
                </div>
              </div>
              <button
                onClick={() => handleTakeOffline(item)}
                className="shrink-0 ml-2 px-2 py-1 bg-red-500 text-white text-[6px] font-black uppercase rounded-lg hover:bg-red-600"
              >
                Take Offline
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── VIDEO LIBRARY ── */}
      <div className="space-y-1">
        <h3 className="text-[7px] font-black uppercase text-gray-400 tracking-widest px-1">Video Library — tap to preview</h3>
        {videoMedia.length === 0 ? (
          <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 p-8 text-center">
            <i className="fas fa-film text-2xl text-gray-200 mb-2 block"></i>
            <p className="text-[7px] text-gray-300 font-black uppercase">No videos uploaded yet</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {videoMedia.map(item => {
              const isSelected = selected?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => setSelected(item)}
                  className={`bg-white p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all shadow-sm ${
                    isSelected ? 'border-green-400 bg-green-50 shadow-md' : 'border-green-50 hover:border-green-200'
                  }`}
                >
                  <div className="flex items-center space-x-3 truncate">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      item.isLive ? 'bg-red-500' : 'bg-gray-100'
                    }`}>
                      <i className={`fas ${item.type === 'image' ? 'fa-image' : 'fa-film'} text-[10px] ${item.isLive ? 'text-white' : 'text-gray-500'}`}></i>
                    </div>
                    <div className="truncate">
                      <p className="text-[9px] font-bold text-green-950 truncate">{item.name}</p>
                      <p className="text-[6px] text-gray-400">
                        {item.isLive ? '🔴 LIVE' : item.caption ? `"${item.caption}"` : 'Not live'}
                      </p>
                    </div>
                  </div>
                  <i className={`fas fa-chevron-right text-[8px] shrink-0 ml-2 ${isSelected ? 'text-green-500' : 'text-gray-300'}`}></i>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TvMonitor;
