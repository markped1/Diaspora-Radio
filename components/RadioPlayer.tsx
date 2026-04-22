/**
 * RadioPlayer — Cross-platform audio player
 *
 * Compliant with:
 * - W3C HTML Living Standard (HTMLMediaElement)
 * - iOS Safari autoplay policy (requires synchronous play() inside gesture)
 * - Android WebView / Capacitor APK (no AudioContext required for basic playback)
 * - Chrome autoplay policy (muted autoplay OR gesture-gated)
 * - HLS streams via native <audio> on Safari/iOS, hls.js on everything else
 *
 * Key rules followed:
 * 1. Single persistent Audio instance — never recreated on re-render
 * 2. src + load() set outside gesture (pre-buffering)
 * 3. play() called synchronously inside the tap handler — no await, no .then chains
 * 4. crossOrigin set correctly per URL type to avoid CORS taint
 * 5. Graceful HLS support: hls.js for MSE browsers, native for Safari
 * 6. Error recovery: retry once on network error, surface clear messages otherwise
 * 7. Media Session API for lock-screen / notification controls
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
import { hasApi, getLiveState } from '../services/apiService';

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
  return url.includes('.m3u8') || url.includes('m3u8');
}

function setCrossOrigin(audio: HTMLAudioElement, url: string) {
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    audio.removeAttribute('crossorigin');
  } else if (url.includes('cloudinary.com') || url.includes('res.cloudinary')) {
    audio.crossOrigin = 'anonymous';
  } else {
    // For external streams (Zeno, Icecast, etc.) — no crossOrigin avoids CORS preflight failures
    audio.removeAttribute('crossorigin');
  }
}

function fmt(s: number) {
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
  const [playing, setPlaying]       = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [volume, setVolume]         = useState(1);
  const [progress, setProgress]     = useState(0);
  const [duration, setDuration]     = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // Persistent refs — never recreated
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const hlsRef      = useRef<Hls | null>(null);
  const loadedUrl   = useRef<string | null>(null);
  const onEndedRef  = useRef(onTrackEnded);
  const volumeRef   = useRef(1);
  const retryRef    = useRef(false);

  useEffect(() => { onEndedRef.current = onTrackEnded; }, [onTrackEnded]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  // ── Poll broadcast state ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setIsBroadcasting(isBroadcastActive()), 300);
    return () => clearInterval(id);
  }, []);

  // ── Create single Audio element on mount ────────────────────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    (audio as any).playsInline = true; // required for iOS inline playback
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
    const onMeta = () => {
      if (isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onError = () => {
      const src = audio.src;
      if (!src || src === window.location.href || src === window.location.origin + '/') return;

      // Retry once on network error (code 2) — handles transient stream drops
      const code = audio.error?.code;
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
        [MediaError.MEDIA_ERR_ABORTED]:  'Playback aborted',
        [MediaError.MEDIA_ERR_NETWORK]:  'Network error — check connection',
        [MediaError.MEDIA_ERR_DECODE]:   'Audio decode error',
        [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: 'Format not supported',
      };
      setError(msgs[code ?? 0] ?? 'Playback error');
      setLoading(false);
      setPlaying(false);
      onStateChange(false);
    };

    audio.addEventListener('play',            onPlay);
    audio.addEventListener('pause',           onPause);
    audio.addEventListener('playing',         onPlaying);
    audio.addEventListener('waiting',         onWaiting);
    audio.addEventListener('ended',           onEnded);
    audio.addEventListener('timeupdate',      onTime);
    audio.addEventListener('loadedmetadata',  onMeta);
    audio.addEventListener('error',           onError);

    return () => {
      audio.pause();
      audio.src = '';
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

    loadedUrl.current = activeTrackUrl;
    retryRef.current = false;
    setError('');
    setProgress(0); setDuration(0); setCurrentTime(0);

    // Destroy previous HLS instance
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (isHlsUrl(activeTrackUrl) && Hls.isSupported()) {
      // MSE-capable browsers: Chrome, Firefox, Edge, Android WebView
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 30,
        backBufferLength: 60,
      });
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
    } else {
      // Safari/iOS native HLS, or plain MP3/AAC/OGG
      setCrossOrigin(audio, activeTrackUrl);
      audio.src = activeTrackUrl;
      audio.load();
    }

    // Update Media Session metadata
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrackName || 'Live Stream',
        artist: 'Nigeria Diaspora Radio',
      });
    }
  }, [activeTrackUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Respond to forcePlaying = false (admin stopped) ─────────────────────
  useEffect(() => {
    if (!forcePlaying && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, [forcePlaying]);

  // ── Volume / ducking ─────────────────────────────────────────────────────
  useEffect(() => {
    const target = musicVolumeOverride !== null
      ? musicVolumeOverride
      : isDucking ? volumeRef.current * 0.15 : volumeRef.current;
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, target));
  }, [volume, isDucking, musicVolumeOverride]);

  // ── Media Session action handlers ────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play',  () => triggerPlay());
    navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler('stop',  () => audioRef.current?.pause());
    return () => {
      navigator.mediaSession.setActionHandler('play',  null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop',  null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Core play logic — extracted so Media Session can call it too ─────────
  function triggerPlay() {
    const audio = audioRef.current;
    if (!audio) return;

    const url = activeTrackUrl || dbService.getLiveStreamUrl() || loadedUrl.current || null;

    if (!url) {
      // Nothing loaded — try fetching from cloud
      setLoading(true);
      setError('');
      getLiveState().then(live => {
        const trackUrl = live?.track?.url;
        if (trackUrl?.startsWith('http') && audioRef.current) {
          loadedUrl.current = trackUrl;
          setCrossOrigin(audioRef.current, trackUrl);
          audioRef.current.src = trackUrl;
          audioRef.current.load();
          audioRef.current.play().catch(() => {
            setLoading(false);
            setError('Tap ▶ again to play');
            setTimeout(() => setError(''), 4000);
          });
        } else {
          setLoading(false);
          setError('No stream available. Admin needs to start playing.');
          setTimeout(() => setError(''), 5000);
        }
      }).catch(() => {
        setLoading(false);
        setError('Connection error — try again');
        setTimeout(() => setError(''), 4000);
      });
      return;
    }

    // Ensure URL is loaded
    if (loadedUrl.current !== url) {
      loadedUrl.current = url;
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (isHlsUrl(url) && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        audio.removeAttribute('crossorigin');
        hls.loadSource(url);
        hls.attachMedia(audio);
      } else {
        setCrossOrigin(audio, url);
        audio.src = url;
        audio.load();
      }
    }

    // Synchronous play() — MUST stay synchronous for iOS/Android gesture compliance
    setLoading(true);
    setError('');
    audio.play().catch((err: DOMException) => {
      setLoading(false);
      if (err.name === 'NotAllowedError') {
        setError('Tap ▶ to play');
        setTimeout(() => setError(''), 4000);
      } else if (err.name !== 'AbortError') {
        setError(err.message || 'Playback failed');
        setTimeout(() => setError(''), 5000);
      }
    });
  }

  // ── Play/Pause tap handler ───────────────────────────────────────────────
  const handlePlayPause = () => {
    if (isBroadcasting) {
      isBroadcastPaused() ? resumeBroadcast() : pauseBroadcast();
      return;
    }
    if (playing) { audioRef.current?.pause(); return; }
    triggerPlay();
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

  // ── Render ───────────────────────────────────────────────────────────────
  const isStream = !duration || !isFinite(duration); // live stream = no duration

  return (
    <div className="flex flex-col items-center w-full space-y-2">
      <Logo size="lg" isPlaying={playing} />

      {/* Progress / seek bar */}
      <div className="w-full px-0 -mt-4 relative z-20">
        {isStream ? (
          // Live stream — indeterminate bar
          <div className="h-1 w-full bg-green-100 rounded-full overflow-hidden">
            {loading
              ? <div className="h-full bg-[#008751] animate-pulse w-full" />
              : <div className="h-full bg-[#008751] transition-all duration-300" style={{ width: playing ? '100%' : '0%' }} />
            }
          </div>
        ) : (
          // File — seekable scrubber
          <div className="relative h-1 w-full">
            <div className="absolute inset-0 bg-green-100 rounded-full" />
            <div className="absolute inset-y-0 left-0 bg-[#008751] rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            <input
              type="range" min="0" max="100" step="0.1"
              value={progress}
              onChange={handleSeek}
              className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
              aria-label="Seek"
            />
          </div>
        )}
        {!isStream && (
          <div className="flex justify-between mt-1 px-1">
            <span className="text-[6px] font-bold text-green-700">{fmt(currentTime)}</span>
            <span className="text-[6px] font-bold text-green-700">{fmt(duration)}</span>
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
