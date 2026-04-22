/**
 * RadioPlayer — Cross-platform audio player
 *
 * Platform compliance:
 * - iOS Safari: play() MUST be synchronous inside user gesture. Never inside .then()/.catch()
 * - Android WebView / Capacitor: same rule. play() synchronous only.
 * - Chrome autoplay policy: gesture-gated play() always works
 * - HLS: hls.js on MSE browsers, native on Safari/iOS
 *
 * Architecture:
 * 1. Single persistent Audio instance — never recreated
 * 2. URL pre-loaded via useEffect (no gesture needed for src+load)
 * 3. play() called synchronously inside tap handler — zero async before it
 * 4. forcePlaying=true triggers auto-play attempt (for admin-pushed tracks)
 * 5. Media Session API for lock-screen controls
 */

import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import Logo from './Logo';
import {
  isBroadcastActive,
  isBroadcastPaused,
  pauseBroadcast,
  resumeBroadcast,
  stopBroadcast,
  setBroadcastVolume,
} from '../services/aiDjService';
import { dbService } from '../services/dbService';

interface RadioPlayerProps {
  onStateChange: (playing: boolean) => void;
  activeTrackUrl?: string | null;
  currentTrackName?: string;
  forcePlaying?: boolean;
  onTrackEnded?: () => void;
  isDucking?: boolean;
  musicVolumeOverride?: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isHlsUrl(url: string) {
  return url.includes('.m3u8');
}

function applyCrossOrigin(audio: HTMLAudioElement, url: string) {
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    audio.removeAttribute('crossorigin');
  } else if (url.includes('cloudinary.com')) {
    audio.crossOrigin = 'anonymous';
  } else {
    // External streams (Zeno, Icecast, SHOUTcast) — no crossOrigin
    // avoids CORS preflight that many stream servers don't support
    audio.removeAttribute('crossorigin');
  }
}

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

const RadioPlayer: React.FC<RadioPlayerProps> = ({
  onStateChange,
  activeTrackUrl,
  currentTrackName = '',
  forcePlaying = false,
  onTrackEnded,
  isDucking = false,
  musicVolumeOverride = null,
}) => {
  const [playing, setPlaying]         = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [volume, setVolume]           = useState(1);
  const [progress, setProgress]       = useState(0);
  const [duration, setDuration]       = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const hlsRef     = useRef<Hls | null>(null);
  const loadedUrl  = useRef<string | null>(null);
  const onEndedRef = useRef(onTrackEnded);
  const volRef     = useRef(1);
  const retryRef   = useRef(false);

  useEffect(() => { onEndedRef.current = onTrackEnded; }, [onTrackEnded]);
  useEffect(() => { volRef.current = volume; }, [volume]);

  // ── Poll broadcast state ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setIsBroadcasting(isBroadcastActive()), 300);
    return () => clearInterval(id);
  }, []);

  // ── Create single Audio element on mount ────────────────────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    (audio as any).playsInline = true;
    audioRef.current = audio;

    const onPlay    = () => { setPlaying(true);  setLoading(false); setError(''); onStateChange(true); };
    const onPause   = () => { setPlaying(false); onStateChange(false); };
    const onPlaying = () => { setPlaying(true);  setLoading(false); setError(''); onStateChange(true); };
    const onWaiting = () => setLoading(true);
    const onEnded   = () => { setPlaying(false); onStateChange(false); onEndedRef.current?.(); };
    const onTime    = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && isFinite(audio.duration)) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    const onMeta = () => { if (isFinite(audio.duration)) setDuration(audio.duration); };
    const onError = () => {
      const src = audio.src;
      if (!src || src === window.location.href || src === window.location.origin + '/') return;
      const code = audio.error?.code;
      // Retry once on transient network drop
      if (code === MediaError.MEDIA_ERR_NETWORK && !retryRef.current) {
        retryRef.current = true;
        setTimeout(() => {
          if (audioRef.current && loadedUrl.current) {
            audioRef.current.load();
            audioRef.current.play().catch(() => {});
          }
        }, 2000);
        return;
      }
      retryRef.current = false;
      const msgs: Record<number, string> = {
        [MediaError.MEDIA_ERR_ABORTED]:           'Playback aborted',
        [MediaError.MEDIA_ERR_NETWORK]:           'Network error — check connection',
        [MediaError.MEDIA_ERR_DECODE]:            'Audio decode error',
        [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: 'Stream format not supported',
      };
      setError(msgs[code ?? 0] ?? 'Playback error');
      setLoading(false);
      setPlaying(false);
      onStateChange(false);
    };

    audio.addEventListener('play',           onPlay);
    audio.addEventListener('pause',          onPause);
    audio.addEventListener('playing',        onPlaying);
    audio.addEventListener('waiting',        onWaiting);
    audio.addEventListener('ended',          onEnded);
    audio.addEventListener('timeupdate',     onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('error',         onError);

    return () => {
      audio.pause();
      audio.removeAttribute('src');
      hlsRef.current?.destroy();
      hlsRef.current = null;
      audioRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load URL when it changes ─────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!activeTrackUrl) {
      audio.pause();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      audio.removeAttribute('src');
      audio.load();
      loadedUrl.current = null;
      setPlaying(false); setProgress(0); setDuration(0); setCurrentTime(0); setError('');
      onStateChange(false);
      return;
    }

    if (loadedUrl.current === activeTrackUrl) return;

    console.log('[NDR] loading URL into audio element:', activeTrackUrl);
    loadedUrl.current = activeTrackUrl;
    retryRef.current = false;
    setError('');
    setProgress(0); setDuration(0); setCurrentTime(0);

    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (isHlsUrl(activeTrackUrl) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 30 });
      hlsRef.current = hls;
      audio.removeAttribute('crossorigin');
      hls.loadSource(activeTrackUrl);
      hls.attachMedia(audio);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else { setError('Stream error'); setLoading(false); }
        }
      });
      // Auto-play once HLS manifest is loaded, if forcePlaying is set
      if (forcePlaying) {
        hls.once(Hls.Events.MANIFEST_PARSED, () => {
          audio.play().catch(() => {});
        });
      }
    } else {
      applyCrossOrigin(audio, activeTrackUrl);
      audio.src = activeTrackUrl;
      audio.load();
      // Auto-play once enough data is buffered, if forcePlaying is set
      if (forcePlaying) {
        const onCanPlay = () => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.play().catch(() => {});
        };
        audio.addEventListener('canplay', onCanPlay);
      }
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrackName || 'Live Stream',
        artist: 'Nigeria Diaspora Radio',
      });
    }
  }, [activeTrackUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── forcePlaying: pause/resume when flag changes ────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (forcePlaying && loadedUrl.current && audio.paused) {
      console.log('[NDR] forcePlaying=true, attempting auto-play, src:', audio.src, '| readyState:', audio.readyState);
      setLoading(true);
      audio.play().catch((err: DOMException) => {
        setLoading(false);
        if (err.name === 'NotAllowedError') {
          setError('Tap ▶ to play');
          setTimeout(() => setError(''), 4000);
        }
      });
    }

    if (!forcePlaying && !audio.paused) {
      audio.pause();
    }
  }, [forcePlaying]);

  // ── Volume / ducking ─────────────────────────────────────────────────────
  useEffect(() => {
    const target = musicVolumeOverride !== null
      ? musicVolumeOverride
      : isDucking ? volRef.current * 0.15 : volRef.current;
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, target));
  }, [volume, isDucking, musicVolumeOverride]);

  // ── Media Session handlers ───────────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const play  = () => { if (audioRef.current) { setLoading(true); audioRef.current.play().catch(() => setLoading(false)); } };
    const pause = () => audioRef.current?.pause();
    navigator.mediaSession.setActionHandler('play',  play);
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('stop',  pause);
    return () => {
      navigator.mediaSession.setActionHandler('play',  null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop',  null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Play/Pause tap handler — MUST stay synchronous ──────────────────────
  const handlePlayPause = () => {
    if (isBroadcasting) {
      isBroadcastPaused() ? resumeBroadcast() : pauseBroadcast();
      return;
    }

    const audio = audioRef.current;
    if (!audio) { console.error('[NDR] audioRef is null'); return; }

    if (playing) { audio.pause(); return; }

    console.log('[NDR] tap play — loadedUrl:', loadedUrl.current, '| activeTrackUrl:', activeTrackUrl, '| dbStream:', dbService.getLiveStreamUrl(), '| resolved:', loadedUrl.current || activeTrackUrl || dbService.getLiveStreamUrl() || null);

    const url = loadedUrl.current || activeTrackUrl || dbService.getLiveStreamUrl() || null;

    if (!url) {
      // Nothing cached yet — fetch from Supabase right now
      console.log('[NDR] no URL — checking hasApi:', typeof import.meta.env.VITE_SUPABASE_URL, '|', import.meta.env.VITE_SUPABASE_URL?.slice(0, 30));
      // We can't call play() after an await (iOS gesture chain breaks)
      // So: set src first with a known fallback, then fetch and update
      setLoading(true);
      setError('');
      import('../services/apiService').then(({ getLiveState }) => {
        getLiveState().then(live => {
          const liveUrl = live?.track?.url || live?.stream;
          if (liveUrl?.startsWith('http') && audioRef.current) {
            loadedUrl.current = liveUrl;
            applyCrossOrigin(audioRef.current, liveUrl);
            audioRef.current.src = liveUrl;
            audioRef.current.load();
            audioRef.current.play().catch((err: DOMException) => {
              setLoading(false);
              if (err.name === 'NotAllowedError') {
                setError('Tap ▶ to play');
              } else if (err.name !== 'AbortError') {
                setError(err.message || 'Playback failed');
              }
              setTimeout(() => setError(''), 5000);
            });
          } else {
            setLoading(false);
            setError('No stream available — admin needs to start playing');
            setTimeout(() => setError(''), 5000);
          }
        }).catch(() => {
          setLoading(false);
          setError('Connection error — try again');
          setTimeout(() => setError(''), 4000);
        });
      });
      return;
    }

    if (loadedUrl.current !== url) {
      console.log('[NDR] loading new URL:', url);
      loadedUrl.current = url;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (isHlsUrl(url) && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        audio.removeAttribute('crossorigin');
        hls.loadSource(url);
        hls.attachMedia(audio);
      } else {
        applyCrossOrigin(audio, url);
        audio.src = url;
        audio.load();
      }
    }

    console.log('[NDR] calling audio.play(), src:', audio.src, '| readyState:', audio.readyState);
    setLoading(true);
    setError('');
    audio.play().catch((err: DOMException) => {
      console.error('[NDR] play() failed:', err.name, err.message);
      setLoading(false);
      if (err.name === 'NotAllowedError') {
        setError('Tap ▶ to play');
        setTimeout(() => setError(''), 4000);
      } else if (err.name !== 'AbortError') {
        setError(err.message || 'Playback failed');
        setTimeout(() => setError(''), 5000);
      }
    });
  };

  const handleStop = () => {
    if (isBroadcasting) { stopBroadcast(); return; }
    audioRef.current?.pause();
  };

  const handleVolume = (v: number) => {
    setVolume(v);
    if (isBroadcasting) setBroadcastVolume(v);
    if (audioRef.current && musicVolumeOverride === null) audioRef.current.volume = v;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || !isFinite(audio.duration)) return;
    const t = (parseFloat(e.target.value) / 100) * audio.duration;
    audio.currentTime = t;
    setCurrentTime(t);
    setProgress(parseFloat(e.target.value));
  };

  const isLiveStream = !duration || !isFinite(duration);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center w-full space-y-2">
      <Logo size="lg" isPlaying={playing} />

      {/* Progress / seek bar */}
      <div className="w-full px-0 -mt-4 relative z-20">
        {isLiveStream ? (
          <div className="h-1 w-full bg-green-100 rounded-full overflow-hidden">
            <div
              className={`h-full bg-[#008751] transition-all duration-300 ${loading ? 'animate-pulse w-full' : ''}`}
              style={{ width: loading ? '100%' : playing ? '100%' : '0%' }}
            />
          </div>
        ) : (
          <div className="relative h-1 w-full">
            <div className="absolute inset-0 bg-green-100 rounded-full" />
            <div
              className="absolute inset-y-0 left-0 bg-[#008751] rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range" min="0" max="100" step="0.1"
              value={progress}
              onChange={handleSeek}
              className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
              aria-label="Seek"
            />
          </div>
        )}
        {!isLiveStream && (
          <div className="flex justify-between mt-1 px-1">
            <span className="text-[6px] font-bold text-green-700">{fmtTime(currentTime)}</span>
            <span className="text-[6px] font-bold text-green-700">{fmtTime(duration)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center space-y-3 relative z-20 w-full px-12">
        {/* Track info */}
        <div className={`px-4 py-2 rounded-full border w-full overflow-hidden shadow-inner flex items-center justify-center text-center ${
          isBroadcasting ? 'bg-red-50 border-red-200' : 'bg-[#008751]/10 border-green-200/50'
        }`}>
          <span className={`text-[7px] font-black uppercase tracking-widest line-clamp-1 ${
            isBroadcasting ? 'text-red-700' : 'text-green-800'
          }`}>
            {isBroadcasting
              ? (isBroadcastPaused() ? '⏸ BROADCAST PAUSED' : '🔴 LIVE BROADCAST — TAP TO PAUSE')
              : playing
                ? `🔴 NOW PLAYING: ${currentTrackName || 'LIVE STREAM'}`
                : activeTrackUrl
                  ? `📻 TAP ▶ — ${currentTrackName || 'STREAM READY'}`
                  : '📻 TAP ▶ TO LISTEN LIVE'}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 w-full">
            <p className="text-[8px] font-semibold text-red-600 text-center">{error}</p>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handlePlayPause}
            disabled={loading && !isBroadcasting}
            aria-label={playing ? 'Pause' : 'Play'}
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all border-4 border-white text-white ${
              isBroadcasting
                ? isBroadcastPaused() ? 'bg-amber-500' : 'bg-red-500'
                : 'bg-[#008751]'
            }`}
          >
            {loading && !isBroadcasting
              ? <i className="fas fa-circle-notch fa-spin" aria-hidden="true" />
              : isBroadcasting
                ? <i className={`fas ${isBroadcastPaused() ? 'fa-play' : 'fa-pause'} text-lg`} aria-hidden="true" />
                : playing
                  ? <i className="fas fa-pause text-lg" aria-hidden="true" />
                  : <i className="fas fa-play text-lg ml-1" aria-hidden="true" />}
          </button>

          {isBroadcasting && (
            <button
              onClick={handleStop}
              aria-label="Stop broadcast"
              className="w-10 h-10 rounded-full bg-gray-800 text-white flex items-center justify-center shadow-lg active:scale-95 border-2 border-white"
            >
              <i className="fas fa-stop text-sm" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Volume */}
        <div className="w-32 flex items-center space-x-2">
          <i className="fas fa-volume-down text-green-600 text-[8px]" aria-hidden="true" />
          <input
            type="range" min="0" max="1" step="0.01"
            value={volume}
            onChange={e => handleVolume(parseFloat(e.target.value))}
            aria-label="Volume"
            className="flex-grow h-0.5 bg-green-100 rounded-lg appearance-none accent-[#008751]"
          />
          <i className="fas fa-volume-up text-green-600 text-[8px]" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
};

export default RadioPlayer;
