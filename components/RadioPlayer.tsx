/**
 * NDR RadioPlayer — Global Online Radio Standard Implementation
 *
 * Architecture follows BBC iPlayer / Zeno.fm / Radio.co patterns:
 * - Single persistent <audio> element (never recreated)
 * - src set BEFORE user gesture (pre-load pattern)
 * - play() called SYNCHRONOUSLY inside tap handler (no await, no .then)
 * - AudioContext created and resumed inside user gesture
 * - Works on: Chrome, Firefox, Edge, Safari, iOS, Android, Capacitor APK
 *
 * Flow:
 * 1. App fetches track URL from Supabase → passes as activeTrackUrl prop
 * 2. useEffect sets audio.src + audio.load() (no gesture needed)
 * 3. User taps ▶ → play() called synchronously → works on all platforms
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
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

const RadioPlayer: React.FC<RadioPlayerProps> = ({
  onStateChange,
  activeTrackUrl,
  currentTrackName = '',
  forcePlaying = false,
  onTrackEnded,
  isDucking = false,
  musicVolumeOverride = null,
}) => {
  // ── State ──────────────────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const audioEl = useRef<HTMLAudioElement | null>(null);       // the <audio> element
  const loadedUrl = useRef<string | null>(null);               // currently loaded URL
  const onEndedRef = useRef(onTrackEnded);
  const broadcastRef = useRef(false);

  useEffect(() => { onEndedRef.current = onTrackEnded; }, [onTrackEnded]);

  // ── Poll broadcast state ───────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const active = isBroadcastActive();
      if (active !== broadcastRef.current) {
        broadcastRef.current = active;
        setIsBroadcasting(active);
      }
    }, 300);
    return () => clearInterval(id);
  }, []);

  // ── Create audio element once ──────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioEl.current = audio;

    const onPlay    = () => { setPlaying(true);  setLoading(false); setError(''); onStateChange(true); };
    const onPause   = () => { setPlaying(false); onStateChange(false); };
    const onPlaying = () => { setPlaying(true);  setLoading(false); setError(''); onStateChange(true); };
    const onWaiting = () => setLoading(true);
    const onEnded   = () => { setPlaying(false); onEndedRef.current?.(); };
    const onTime    = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && isFinite(audio.duration)) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    const onMeta    = () => { if (isFinite(audio.duration)) setDuration(audio.duration); };
    const onError   = () => {
      const src = audio.src;
      // Ignore errors when src is empty or is the page URL (happens during cleanup/load)
      if (!src || src === '' || src === window.location.href || src === window.location.origin + '/') return;
      const code = (audio.error as any)?.code;
      let msg = 'Playback error';
      if (code === 2) msg = 'Network error — check connection';
      if (code === 3) msg = 'Audio decode error';
      if (code === 4) msg = 'Stream not accessible';
      setError(msg);
      setLoading(false);
      setPlaying(false);
      onStateChange(false);
    };

    audio.addEventListener('play',    onPlay);
    audio.addEventListener('pause',   onPause);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('ended',   onEnded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('error',   onError);

    return () => {
      audio.pause();
      audio.src = '';
      audioEl.current = null;
    };
  }, []);

  // ── Pre-load URL when it changes (no gesture needed) ──────────────────────
  useEffect(() => {
    const audio = audioEl.current;
    if (!audio) return;

    if (!activeTrackUrl) {
      // Admin stopped — clear everything
      audio.pause();
      audio.src = '';
      loadedUrl.current = null;
      setPlaying(false);
      setProgress(0);
      setDuration(0);
      setCurrentTime(0);
      setError('');
      onStateChange(false);
      return;
    }

    if (loadedUrl.current === activeTrackUrl) return; // already loaded

    // Set CORS policy based on URL type
    if (activeTrackUrl.startsWith('blob:') || activeTrackUrl.startsWith('data:')) {
      audio.crossOrigin = null;
    } else if (activeTrackUrl.includes('cloudinary.com')) {
      audio.crossOrigin = 'anonymous';
    } else {
      audio.removeAttribute('crossorigin');
    }

    // Pre-load: set src and buffer — this does NOT require a user gesture
    if (!activeTrackUrl || !activeTrackUrl.startsWith('http') && !activeTrackUrl.startsWith('blob:')) {
      return; // invalid URL — don't load
    }
    audio.src = activeTrackUrl;
    audio.load();
    loadedUrl.current = activeTrackUrl;
    setError('');
  }, [activeTrackUrl]);

  // ── Pause when admin stops (forcePlaying → false) ─────────────────────────
  useEffect(() => {
    const audio = audioEl.current;
    if (!audio) return;
    if (!forcePlaying && !audio.paused) {
      audio.pause();
    }
  }, [forcePlaying]);

  // ── Volume / ducking ───────────────────────────────────────────────────────
  useEffect(() => {
    const target = musicVolumeOverride !== null
      ? musicVolumeOverride
      : isDucking ? volume * 0.15 : volume;

    if (audioEl.current) audioEl.current.volume = Math.max(0, Math.min(1, target));
  }, [volume, isDucking, musicVolumeOverride]);

  // ── Main play/pause handler — MUST be synchronous for mobile ──────────────
  const handlePlayPause = () => {
    if (isBroadcasting) {
      isBroadcastPaused() ? resumeBroadcast() : pauseBroadcast();
      return;
    }

    const audio = audioEl.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      return;
    }

    // Get the best available URL
    const url = activeTrackUrl || dbService.getLiveStreamUrl() || loadedUrl.current || null;

    if (!url) {
      // No URL anywhere — fetch from Supabase
      setLoading(true);
      setError('');
      getLiveState().then(live => {
        const trackUrl = live?.track?.url;
        if (trackUrl?.startsWith('http') && audioEl.current) {
          audioEl.current.removeAttribute('crossorigin');
          audioEl.current.src = trackUrl;
          loadedUrl.current = trackUrl;
          audioEl.current.play().catch(() => {
            setLoading(false);
            setError('Tap ▶ again to play');
            setTimeout(() => setError(''), 4000);
          });
        } else {
          setLoading(false);
          setError('No stream. Admin needs to start playing.');
          setTimeout(() => setError(''), 4000);
        }
      }).catch(() => {
        setLoading(false);
        setError('Connection error. Try again.');
        setTimeout(() => setError(''), 4000);
      });
      return;
    }

    // Load URL if not already loaded
    if (loadedUrl.current !== url) {
      if (url.startsWith('blob:') || url.startsWith('data:')) {
        audio.crossOrigin = null;
      } else if (url.includes('cloudinary.com')) {
        audio.crossOrigin = 'anonymous';
      } else {
        audio.removeAttribute('crossorigin');
      }
      audio.src = url;
      audio.load();
      loadedUrl.current = url;
    }

    // Play synchronously inside user gesture
    setLoading(true);
    setError('');
    audio.play().catch((err: any) => {
      setLoading(false);
      if (err.name === 'NotAllowedError') {
        setError('Tap ▶ to play');
        setTimeout(() => setError(''), 4000);
      } else if (err.name !== 'AbortError') {
        setError(err.message || 'Playback failed');
      }
    });
  };

  const handleStop = () => {
    if (isBroadcasting) { stopBroadcast(); return; }
    audioEl.current?.pause();
  };

  const handleVolume = (v: number) => {
    setVolume(v);
    if (isBroadcasting) setBroadcastVolume(v);
    if (audioEl.current && musicVolumeOverride === null) audioEl.current.volume = v;
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center w-full space-y-2">
      <Logo size="lg" isPlaying={playing} />

      {/* Progress bar */}
      <div className="w-full px-0 -mt-4 relative z-20">
        <div className="h-1 w-full bg-green-100 rounded-full overflow-hidden">
          <div className="h-full bg-[#008751] transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        {duration > 0 && isFinite(duration) && (
          <div className="flex justify-between mt-1 px-1">
            <span className="text-[6px] font-bold text-green-700">{fmt(currentTime)}</span>
            <span className="text-[6px] font-bold text-green-700">{fmt(duration)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center space-y-3 relative z-20 w-full px-12">
        {/* Track info */}
        <div className={`px-4 py-2 rounded-full border w-full overflow-hidden shadow-inner flex items-center justify-center text-center ${isBroadcasting ? 'bg-red-50 border-red-200' : 'bg-[#008751]/10 border-green-200/50'}`}>
          <span className={`text-[7px] font-black uppercase tracking-widest line-clamp-1 ${isBroadcasting ? 'text-red-700' : 'text-green-800'}`}>
            {isBroadcasting
              ? (isBroadcastPaused() ? '⏸ BROADCAST PAUSED' : '🔴 LIVE BROADCAST — TAP TO PAUSE')
              : playing
                ? `🔴 NOW PLAYING: ${currentTrackName}`
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
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all border-4 border-white text-white ${
              isBroadcasting
                ? isBroadcastPaused() ? 'bg-amber-500' : 'bg-red-500'
                : 'bg-[#008751]'
            }`}
          >
            {loading && !isBroadcasting
              ? <i className="fas fa-circle-notch fa-spin" />
              : isBroadcasting
                ? <i className={`fas ${isBroadcastPaused() ? 'fa-play' : 'fa-pause'} text-lg`} />
                : playing
                  ? <i className="fas fa-pause text-lg" />
                  : <i className="fas fa-play text-lg ml-1" />}
          </button>
          {isBroadcasting && (
            <button onClick={handleStop} className="w-10 h-10 rounded-full bg-gray-800 text-white flex items-center justify-center shadow-lg active:scale-95 border-2 border-white">
              <i className="fas fa-stop text-sm" />
            </button>
          )}
        </div>

        {/* Volume */}
        <div className="w-32 flex items-center space-x-2">
          <i className="fas fa-volume-down text-green-600 text-[8px]" />
          <input
            type="range" min="0" max="1" step="0.01" value={volume}
            onChange={e => handleVolume(parseFloat(e.target.value))}
            className="flex-grow h-0.5 bg-green-100 rounded-lg appearance-none accent-[#008751]"
          />
          <i className="fas fa-volume-up text-green-600 text-[8px]" />
        </div>
      </div>
    </div>
  );
};

export default RadioPlayer;
