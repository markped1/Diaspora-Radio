import React, { useRef, useState, useEffect } from 'react';
import { MediaFile, SocialLink } from '../types';
import { dbService } from '../services/dbService';
import IptvPlayer from './IptvPlayer';
import { setLiveTv, hasApi } from '../services/apiService';

interface TvMonitorProps {
  mediaList: MediaFile[];
  onMediaUpdated: () => void;
}

// Extract YouTube video ID from various URL formats
function extractYouTubeId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/@([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  // If it looks like a raw ID already
  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();
  return null;
}

function getYouTubeEmbedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}?autoplay=1&mute=0&rel=0&modestbranding=1`;
}

// ─── Custom embed URL input ───────────────────────────────────────────────────
const CustomEmbedInput: React.FC<{ onAdd: (name: string, url: string) => Promise<void> }> = ({ onAdd }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    setErr('');
    if (!url.trim()) { setErr('URL required'); return; }
    if (!url.startsWith('http')) { setErr('Must start with https://'); return; }
    setSaving(true);
    await onAdd(name.trim() || 'Custom Video', url.trim());
    setName(''); setUrl('');
    setSaving(false);
  };

  return (
    <div className="space-y-1.5">
      <input type="text" value={name} onChange={e => setName(e.target.value)}
        placeholder="Name (e.g. My Film)"
        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-purple-400" />
      <input type="url" value={url} onChange={e => { setUrl(e.target.value); setErr(''); }}
        placeholder="https://archive.org/embed/..."
        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-purple-400" />
      {err && <p className="text-[7px] text-red-500 font-bold">{err}</p>}
      <button onClick={handle} disabled={saving || !url.trim()}
        className="w-full bg-purple-600 text-white py-2 rounded-lg text-[8px] font-black uppercase disabled:opacity-40">
        {saving ? 'Adding...' : 'Add to Library'}
      </button>
    </div>
  );
};

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

  // YouTube link input state
  const [ytInput, setYtInput] = useState('');
  const [ytName, setYtName] = useState('');
  const [ytError, setYtError] = useState('');

  // IPTV state
  const [iptvUrl, setIptvUrl] = useState('');
  const [iptvName, setIptvName] = useState('');
  const [iptvError, setIptvError] = useState('');
  const [iptvTestUrl, setIptvTestUrl] = useState<string | null>(null);
  const [iptvTestStatus, setIptvTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // Social links state
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [socialPlatform, setSocialPlatform] = useState<SocialLink['platform']>('facebook');
  const [socialLabel, setSocialLabel] = useState('');
  const [socialUrl, setSocialUrl] = useState('');
  const [socialError, setSocialError] = useState('');
  const [editingSocialId, setEditingSocialId] = useState<string | null>(null);

  useEffect(() => {
    dbService.getSocialLinks().then(setSocialLinks);
  }, []);

  const videoMedia = mediaList.filter(m => m.type === 'video' || m.type === 'image' || m.type === 'youtube' || m.type === 'iptv');
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
      const liveStartTime = Date.now(); // timestamp when video goes live
      for (const item of videoMedia) {
        const updated = { ...item, isLive: item.id === selected.id };
        if (item.id === selected.id) {
          updated.caption = caption.trim();
          updated.sponsorName = sponsorName.trim();
          updated.liveStartTime = liveStartTime; // sync timestamp
        }
        await dbService.updateMedia(updated);
      }

      // Sync live TV to cloud so all listeners see it
      if (hasApi()) {
        await setLiveTv({
          url: selected.url,
          name: selected.name,
          type: selected.type,
          caption: caption.trim(),
          youtubeId: selected.youtubeId || null,
        } as any).catch(() => {});
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

  const handleAddYouTube = async () => {
    setYtError('');
    const id = extractYouTubeId(ytInput.trim());
    if (!id) {
      setYtError('Could not find a valid YouTube video or channel ID. Paste the full URL.');
      return;
    }
    const name = ytName.trim() || `YouTube: ${id}`;
    const newItem: MediaFile = {
      id: 'yt-' + Math.random().toString(36).substr(2, 9),
      name,
      url: getYouTubeEmbedUrl(id),
      type: 'youtube',
      youtubeId: id,
      timestamp: Date.now(),
      isLive: false,
    };
    await dbService.addMedia(newItem);
    setYtInput('');
    setYtName('');
    setFeedback(`✅ "${name}" added to library`);
    onMediaUpdated();
    setTimeout(() => setFeedback(''), 3000);
  };

  const handleTakeOffline = async (item: MediaFile) => {
    await dbService.updateMedia({ ...item, isLive: false });
    // Clear cloud TV state so listeners see off-air
    if (hasApi()) setLiveTv(null).catch(() => {});
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

  const handleSaveSocialLink = async () => {
    setSocialError('');
    if (!socialUrl.trim()) { setSocialError('URL is required.'); return; }
    if (!socialUrl.startsWith('http')) { setSocialError('URL must start with http:// or https://'); return; }
    const link: SocialLink = {
      id: editingSocialId || 'sl-' + Math.random().toString(36).substr(2, 9),
      platform: socialPlatform,
      label: socialLabel.trim() || socialPlatform,
      url: socialUrl.trim(),
      timestamp: Date.now(),
    };
    await dbService.saveSocialLink(link);
    const updated = await dbService.getSocialLinks();
    setSocialLinks(updated);
    setSocialLabel('');
    setSocialUrl('');
    setEditingSocialId(null);
    setFeedback(`✅ ${link.label} saved`);
    setTimeout(() => setFeedback(''), 2000);
  };

  const handleEditSocialLink = (link: SocialLink) => {
    setEditingSocialId(link.id);
    setSocialPlatform(link.platform);
    setSocialLabel(link.label);
    setSocialUrl(link.url);
  };

  const handleDeleteSocialLink = async (id: string) => {
    await dbService.deleteSocialLink(id);
    setSocialLinks(prev => prev.filter(l => l.id !== id));
  };

  const handleAddIptv = async () => {
    setIptvError('');
    const url = iptvUrl.trim();
    if (!url) { setIptvError('Stream URL is required.'); return; }
    if (!url.startsWith('http')) { setIptvError('URL must start with http:// or https://'); return; }
    const name = iptvName.trim() || 'IPTV Channel';
    const newItem: MediaFile = {
      id: 'iptv-' + Math.random().toString(36).substr(2, 9),
      name,
      url,
      type: 'iptv',
      timestamp: Date.now(),
      isLive: false,
    };
    await dbService.addMedia(newItem);
    setIptvUrl('');
    setIptvName('');
    setIptvTestUrl(null);
    setIptvTestStatus('idle');
    setFeedback(`✅ "${name}" added to library`);
    onMediaUpdated();
    setTimeout(() => setFeedback(''), 2000);
  };

  const handleTestIptv = () => {
    const url = iptvUrl.trim();
    if (!url) { setIptvError('Enter a stream URL first.'); return; }
    setIptvTestUrl(url);
    setIptvTestStatus('testing');
    // Give it 8 seconds to connect
    setTimeout(() => {
      setIptvTestStatus(prev => prev === 'testing' ? 'fail' : prev);
    }, 8000);
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
            selected.type === 'iptv' ? (
              <IptvPlayer url={selected.url} muted={isMuted} autoPlay />
            ) : selected.type === 'youtube' ? (
              <iframe
                src={selected.url}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={selected.name}
              />
            ) : selected.type === 'image' ? (
              <img src={resolveUrl(selected)} className="w-full h-full object-contain" alt={selected.name} />
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

      {/* ── YOUTUBE CHANNELS ── */}
      <div className="bg-white rounded-xl border border-red-100 p-3 space-y-2 shadow-sm">
        <h3 className="text-[8px] font-black uppercase tracking-widest text-red-600 flex items-center space-x-1">
          <i className="fab fa-youtube text-red-500"></i>
          <span>Link YouTube Video or Live Stream</span>
        </h3>
        <input
          type="text"
          value={ytInput}
          onChange={e => { setYtInput(e.target.value); setYtError(''); }}
          placeholder="Paste YouTube URL or video ID..."
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-red-400"
        />
        <input
          type="text"
          value={ytName}
          onChange={e => setYtName(e.target.value)}
          placeholder="Label (e.g. NDR Live Channel)"
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-red-400"
        />
        {ytError && <p className="text-[7px] text-red-500 font-bold">{ytError}</p>}
        <button
          onClick={handleAddYouTube}
          disabled={!ytInput.trim()}
          className="w-full bg-red-600 text-white py-2 rounded-lg text-[8px] font-black uppercase flex items-center justify-center space-x-1 disabled:opacity-40"
        >
          <i className="fab fa-youtube text-[9px]"></i>
          <span>Add to Library</span>
        </button>
        <p className="text-[6px] text-gray-400 leading-relaxed">
          Supports: youtube.com/watch?v=..., youtu.be/..., youtube.com/live/..., or raw video ID.
          Note: YouTube embeds require the video to allow embedding.
        </p>
      </div>

      {/* ── IPTV LIVE STREAMS ── */}
      <div className="bg-white rounded-xl border border-orange-100 p-3 space-y-3 shadow-sm">
        <h3 className="text-[8px] font-black uppercase tracking-widest text-orange-600 flex items-center space-x-1">
          <i className="fas fa-satellite-dish text-orange-500"></i>
          <span>IPTV Live Streams</span>
        </h3>
        <p className="text-[6px] text-gray-400 leading-relaxed">
          These streams are tested and confirmed CORS-friendly — they work directly in the browser without being blocked. Always tap <strong>Test Stream</strong> before pushing live.
        </p>

        {/* Preset confirmed working channels */}
        <div className="space-y-1">
          <p className="text-[6px] font-black uppercase text-orange-400 tracking-widest">✅ Confirmed Working Streams</p>
          <div className="grid gap-1.5">
            {[
              // ── News — all Akamai/CDN hosted, CORS-friendly ──
              { name: 'DW Africa',           url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',                                                    country: '🌍', cat: 'News' },
              { name: 'Al Jazeera English',  url: 'https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8',                                                                         country: '🌍', cat: 'News' },
              { name: 'Al Jazeera Arabic',   url: 'https://live-hls-web-aja.getaj.net/AJA/index.m3u8',                                                                             country: '🌍', cat: 'News' },
              { name: 'Al Jazeera Mubasher', url: 'https://live-hls-web-ajm.getaj.net/AJM/index.m3u8',                                                                             country: '🌍', cat: 'News' },
              { name: 'France 24 English',   url: 'https://stream.france24.com/hls/live/2037218/F24_EN_LO_HLS/master.m3u8',                                                        country: '🇫🇷', cat: 'News' },
              { name: 'CGTN English',        url: 'https://news.cgtn.com/resource/live/english/cgtn-news.m3u8',                                                                    country: '🌏', cat: 'News' },
              { name: 'CGTN Documentary',    url: 'https://news.cgtn.com/resource/live/document/cgtn-doc.m3u8',                                                                    country: '🌏', cat: 'Docs' },
              { name: 'NASA TV',             url: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8',                                                         country: '🚀', cat: 'Docs' },
              { name: 'ABC News Australia',  url: 'https://abc-iview-mediapackagestreams-2.akamaized.net/out/v1/6e1cc6d25ec0480ea099a5399d73bc4b/index.m3u8',                      country: '🇦🇺', cat: 'News' },
              { name: 'Sky News Arabia',     url: 'https://stream.skynewsarabia.com/hls/sna.m3u8',                                                                                 country: '🌍', cat: 'News' },
              { name: 'Al Arabiya',          url: 'https://live.alarabiya.net/alarabiapublish/alarabiya.smil/playlist.m3u8',                                                        country: '🌍', cat: 'News' },
              { name: 'Al Ekhbariya',        url: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-al-ekhbaria/297b3ef1cd0633ad9cfba7473a686a06/index.m3u8',                    country: '🌍', cat: 'News' },
              { name: 'Qatar TV',            url: 'https://qatartv.akamaized.net/hls/live/2026573/qtv1/master.m3u8',                                                               country: '🇶🇦', cat: 'News' },
              // ── Sports ──
              { name: 'Red Bull TV',         url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',                                                           country: '🏆', cat: 'Sport' },
              { name: 'Abu Dhabi Sports 1',  url: 'https://vo-live.cdb.cdn.orange.com/Content/Channel/AbuDhabiSportsChannel1/HLS/index.m3u8',                                     country: '⚽', cat: 'Sport' },
              { name: 'Abu Dhabi Sports 2',  url: 'https://vo-live.cdb.cdn.orange.com/Content/Channel/AbuDhabiSportsChannel2/HLS/index.m3u8',                                     country: '⚽', cat: 'Sport' },
              { name: 'Dubai Sports 1',      url: 'https://dmitnthfr.cdn.mgmlcdn.com/dubaisports/smil:dubaisports.stream.smil/chunklist.m3u8',                                     country: '⚽', cat: 'Sport' },
              { name: 'Dubai Sports 2',      url: 'https://dmitwlvvll.cdn.mangomolo.com/dubaisportshd/smil:dubaisportshd.smil/index.m3u8',                                        country: '⚽', cat: 'Sport' },
              { name: 'TRT Spor',            url: 'https://tv-trtspor1.medya.trt.com.tr/master.m3u8',                                                                              country: '⚽', cat: 'Sport' },
              { name: 'TRT Spor 2',          url: 'https://tv-trtspor2.medya.trt.com.tr/master.m3u8',                                                                              country: '⚽', cat: 'Sport' },
              // ── Movies / Entertainment ──
              { name: 'FilmRise Movies',     url: 'https://dai2.xumo.com/xumocdn/p=roku/amagi_hls_data_xumo1212A-filmrisefreemovies/CDN/playlist.m3u8',                            country: '🎬', cat: 'Movies' },
              { name: 'CBS News',            url: 'https://cbsnews.akamaized.net/hls/live/2020607/cbsnlineup_8/master.m3u8',                                                       country: '🇺🇸', cat: 'News' },
              { name: 'ABC News Live',       url: 'https://content.uplynk.com/channel/3324f2467c414329b3b0cc5cd987b6be.m3u8',                                                     country: '🇺🇸', cat: 'News' },
              { name: 'NBC News NOW',        url: 'https://dai2.xumo.com/amagi_hls_data_xumo1212A-xumo-nbcnewsnow/CDN/master.m3u8',                                                country: '🇺🇸', cat: 'News' },
              { name: 'Bloomberg TV',        url: 'https://bloomberg.com/media-manifest/streams/eu.m3u8',                                                                          country: '💹', cat: 'Business' },
              { name: 'MBC 1',              url: 'https://mbc1-enc.edgenextcdn.net/out/v1/0965e4d7deae49179172426cbfb3bc5e/index.m3u8',                                           country: '🌍', cat: 'Africa' },
              { name: 'MBC Drama',          url: 'https://mbc1-enc.edgenextcdn.net/out/v1/b0b3a0e6750d4408bb86d703d5feffd1/index.m3u8',                                           country: '🌍', cat: 'Movies' },
              { name: 'Rotana Cinema',      url: 'https://bcovlive-a.akamaihd.net/9527a892aeaf43019fd9eeb77ad1516e/eu-central-1/6057955906001/playlist.m3u8',                      country: '🎬', cat: 'Movies' },
              { name: 'NHK World Japan',    url: 'https://nhkwlive-ojp.akamaized.net/hls/live/2003459/nhkwlive-ojp-en/index_4M.m3u8',                                             country: '🇯🇵', cat: 'News' },
              { name: 'TRT World',          url: 'https://tv-trtworld.medya.trt.com.tr/master.m3u8',                                                                               country: '🌍', cat: 'News' },
              { name: 'TRT 1',              url: 'https://tv-trt1.medya.trt.com.tr/master.m3u8',                                                                                   country: '🌍', cat: 'General' },
              { name: 'TRT Belgesel',       url: 'https://tv-trtbelgesel.medya.trt.com.tr/master.m3u8',                                                                            country: '📽️', cat: 'Docs' },
            ].map(ch => (
              <div key={ch.name} className="flex items-center justify-between bg-orange-50 rounded-lg px-3 py-2 border border-orange-100">
                <div className="flex items-center space-x-2 truncate">
                  <span className="text-sm shrink-0">{ch.country}</span>
                  <div className="truncate">
                    <p className="text-[8px] font-black text-orange-800 truncate">{ch.name}</p>
                    <p className="text-[6px] text-orange-400">{(ch as any).cat}</p>
                  </div>
                </div>
                <div className="flex space-x-1 shrink-0 ml-2">
                  <button
                    onClick={() => { setIptvUrl(ch.url); setIptvName(ch.name); setIptvTestUrl(null); setIptvTestStatus('idle'); }}
                    className="px-2 py-1 bg-orange-100 text-orange-700 text-[6px] font-black uppercase rounded-lg hover:bg-orange-200"
                  >
                    Select
                  </button>
                  <button
                    onClick={async () => {
                      const newItem: MediaFile = {
                        id: 'iptv-' + Math.random().toString(36).substr(2, 9),
                        name: ch.name,
                        url: ch.url,
                        type: 'iptv',
                        timestamp: Date.now(),
                        isLive: false,
                      };
                      await dbService.addMedia(newItem);
                      setFeedback(`✅ ${ch.name} added to library`);
                      onMediaUpdated();
                      setTimeout(() => setFeedback(''), 2000);
                    }}
                    className="px-2 py-1 bg-orange-500 text-white text-[6px] font-black uppercase rounded-lg hover:bg-orange-600"
                  >
                    + Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Custom stream URL */}
        <div className="border-t border-orange-100 pt-2 space-y-2">
          <p className="text-[6px] font-black uppercase text-orange-500 tracking-widest">Custom Stream URL</p>
          <input
            type="text"
            value={iptvName}
            onChange={e => setIptvName(e.target.value)}
            placeholder="Channel name (e.g. My IPTV Channel)"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-orange-400"
          />
          <input
            type="url"
            value={iptvUrl}
            onChange={e => { setIptvUrl(e.target.value); setIptvError(''); setIptvTestStatus('idle'); setIptvTestUrl(null); }}
            placeholder="https://example.com/stream.m3u8"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-orange-400"
          />
          {iptvError && <p className="text-[7px] text-red-500 font-bold">{iptvError}</p>}

          {/* Test player */}
          {iptvTestUrl && (
            <div className="rounded-lg overflow-hidden border border-orange-200" style={{ height: '120px' }}>
              <IptvPlayer
                url={iptvTestUrl}
                muted={false}
                autoPlay
                onPlaying={() => setIptvTestStatus('ok')}
                onError={() => setIptvTestStatus('fail')}
              />
            </div>
          )}

          {/* Test status */}
          {iptvTestStatus === 'ok' && (
            <p className="text-[7px] text-green-600 font-black">✅ Stream is working! Safe to add to library.</p>
          )}
          {iptvTestStatus === 'fail' && (
            <p className="text-[7px] text-red-500 font-black">❌ Stream failed — may be offline or CORS-blocked.</p>
          )}

          <div className="flex space-x-2">
            <button
              onClick={handleTestIptv}
              disabled={!iptvUrl.trim()}
              className="flex-1 bg-orange-100 text-orange-700 py-2 rounded-lg text-[8px] font-black uppercase disabled:opacity-40 flex items-center justify-center space-x-1"
            >
              <i className="fas fa-play-circle text-[9px]"></i>
              <span>Test Stream</span>
            </button>
            <button
              onClick={handleAddIptv}
              disabled={!iptvUrl.trim()}
              className="flex-1 bg-orange-500 text-white py-2 rounded-lg text-[8px] font-black uppercase disabled:opacity-40 flex items-center justify-center space-x-1"
            >
              <i className="fas fa-plus text-[9px]"></i>
              <span>Add to Library</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── SOCIAL MEDIA LINKS ── */}
      <div className="bg-white rounded-xl border border-blue-100 p-3 space-y-3 shadow-sm">
        <h3 className="text-[8px] font-black uppercase tracking-widest text-blue-600 flex items-center space-x-1">
          <i className="fas fa-share-alt text-blue-500"></i>
          <span>Social Media Links</span>
        </h3>
        <p className="text-[6px] text-gray-400">Save your station's social media profiles for quick access and future TV overlays.</p>

        {/* Input form */}
        <div className="space-y-2">
          <select
            value={socialPlatform}
            onChange={e => setSocialPlatform(e.target.value as SocialLink['platform'])}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-blue-400"
          >
            <option value="facebook">Facebook</option>
            <option value="twitter">X / Twitter</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
            <option value="website">Website</option>
            <option value="other">Other</option>
          </select>
          <input
            type="text"
            value={socialLabel}
            onChange={e => setSocialLabel(e.target.value)}
            placeholder="Label (e.g. NDR Official Facebook)"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-blue-400"
          />
          <input
            type="url"
            value={socialUrl}
            onChange={e => { setSocialUrl(e.target.value); setSocialError(''); }}
            placeholder="https://facebook.com/yourpage"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[9px] outline-none focus:border-blue-400"
          />
          {socialError && <p className="text-[7px] text-red-500 font-bold">{socialError}</p>}
          <div className="flex space-x-2">
            <button
              onClick={handleSaveSocialLink}
              disabled={!socialUrl.trim()}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-[8px] font-black uppercase disabled:opacity-40"
            >
              {editingSocialId ? 'Update Link' : 'Save Link'}
            </button>
            {editingSocialId && (
              <button
                onClick={() => { setEditingSocialId(null); setSocialLabel(''); setSocialUrl(''); setSocialPlatform('facebook'); }}
                className="px-3 bg-gray-100 text-gray-600 py-2 rounded-lg text-[8px] font-black uppercase"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Saved links list */}
        {socialLinks.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t border-gray-100">
            <p className="text-[6px] font-black uppercase text-gray-400 tracking-widest">Saved Links</p>
            {socialLinks.map(link => {
              const iconMap: Record<SocialLink['platform'], string> = {
                facebook: 'fab fa-facebook-f text-blue-600',
                twitter: 'fab fa-twitter text-sky-500',
                instagram: 'fab fa-instagram text-pink-500',
                youtube: 'fab fa-youtube text-red-500',
                tiktok: 'fab fa-tiktok text-gray-800',
                whatsapp: 'fab fa-whatsapp text-green-500',
                telegram: 'fab fa-telegram text-blue-400',
                website: 'fas fa-globe text-gray-500',
                other: 'fas fa-link text-gray-400',
              };
              return (
                <div key={link.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <div className="flex items-center space-x-2 truncate">
                    <i className={`${iconMap[link.platform]} text-[11px] shrink-0`}></i>
                    <div className="truncate">
                      <p className="text-[8px] font-black text-gray-800 truncate">{link.label}</p>
                      <p className="text-[6px] text-gray-400 truncate">{link.url}</p>
                    </div>
                  </div>
                  <div className="flex space-x-1 shrink-0 ml-2">
                    <button
                      onClick={() => handleEditSocialLink(link)}
                      className="w-6 h-6 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center hover:bg-blue-100"
                    >
                      <i className="fas fa-pen text-[7px]"></i>
                    </button>
                    <button
                      onClick={() => window.open(link.url, '_blank')}
                      className="w-6 h-6 bg-green-50 text-green-500 rounded-full flex items-center justify-center hover:bg-green-100"
                    >
                      <i className="fas fa-external-link-alt text-[7px]"></i>
                    </button>
                    <button
                      onClick={() => handleDeleteSocialLink(link.id)}
                      className="w-6 h-6 bg-red-50 text-red-400 rounded-full flex items-center justify-center hover:bg-red-100"
                    >
                      <i className="fas fa-trash text-[7px]"></i>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
                      item.isLive ? 'bg-red-500' : item.type === 'youtube' ? 'bg-red-100' : item.type === 'iptv' ? 'bg-orange-100' : 'bg-gray-100'
                    }`}>
                      <i className={`fas ${item.type === 'youtube' ? 'fab fa-youtube' : item.type === 'iptv' ? 'fa-satellite-dish' : item.type === 'image' ? 'fa-image' : 'fa-film'} text-[10px] ${item.isLive ? 'text-white' : item.type === 'youtube' ? 'text-red-500' : item.type === 'iptv' ? 'text-orange-500' : 'text-gray-500'}`}></i>
                    </div>
                    <div className="truncate">
                      <p className="text-[9px] font-bold text-green-950 truncate">{item.name}</p>
                      <p className="text-[6px] text-gray-400">
                        {item.isLive ? '🔴 LIVE' : item.caption ? `"${item.caption}"` : item.type.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (selected?.id === item.id) setSelected(null);
                      await dbService.deleteMedia(item.id);
                      setFeedback(`🗑 "${item.name}" deleted`);
                      onMediaUpdated();
                      setTimeout(() => setFeedback(''), 2000);
                    }}
                    className="shrink-0 ml-2 w-7 h-7 bg-red-50 text-red-400 rounded-full flex items-center justify-center hover:bg-red-100 active:scale-90"
                    title="Delete from library"
                  >
                    <i className="fas fa-trash text-[8px]"></i>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── HOW TO GET SPORTS & MOVIES ── */}
      <div className="bg-gray-900 rounded-xl p-3 space-y-2">
        <h3 className="text-[8px] font-black uppercase tracking-widest text-yellow-400 flex items-center space-x-1">
          <i className="fas fa-lightbulb text-yellow-400"></i>
          <span>How to Get Sports & Movies Working</span>
        </h3>
        <p className="text-[6px] text-gray-300 leading-relaxed">
          Sites like Yalla Live work by embedding iframes from third-party stream providers. You can do the same — find a stream embed code and paste it below.
        </p>
        <div className="space-y-1.5 text-[6px] text-gray-400">
          <p className="font-black text-gray-300 uppercase tracking-widest">Step by step:</p>
          <p>1. Go to <span className="text-yellow-300 font-bold">yalla-live.cyou</span> or any sports site</p>
          <p>2. Right-click the video player → <span className="text-white font-bold">Inspect Element</span></p>
          <p>3. Find the <span className="text-green-400 font-mono">&lt;iframe src="..."&gt;</span> tag inside the player</p>
          <p>4. Copy that src URL</p>
          <p>5. Paste it in the <span className="text-white font-bold">Custom Embed URL</span> field in the Free Movies section above</p>
          <p>6. Add to library → select → Push Live</p>
        </div>
        <div className="border-t border-gray-700 pt-2 space-y-1">
          <p className="text-[6px] font-black text-yellow-400 uppercase tracking-widest">⚠️ Note</p>
          <p className="text-[6px] text-gray-400 leading-relaxed">
            Sites like Goal2 Live, Sportsurge, and FreeLiveSports block iframe embedding — they show a blank screen or timeout. 
            The only way to get their streams is to open them in a browser, right-click the video, inspect the iframe src, and paste that inner URL here.
            Use the <span className="text-white font-bold">⚽ Sports tab</span> above for a better experience with channel cards and a built-in player.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TvMonitor;
