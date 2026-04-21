import React, { useState, useRef, useEffect } from 'react';
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
  onStateChange: (isPlaying: boolean) => void;
  activeTrackUrl?: string | null;
  currentTrackName?: string;
  forcePlaying?: boolean;
  onTrackEnded?: () => void;
  isAdmin?: boolean;
  isDucking?: boolean;
  musicVolumeOverride?: number | null;
}

const RadioPlayer: React.FC<RadioPlayerProps> = ({
  onStateChange,
  activeTrackUrl,
  currentTrackName = 'Live Stream',
  forcePlaying = false,
  onTrackEnded,
  isDucking = false,
  musicVolumeOverride = null,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR'>('IDLE');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const broadcastingRef = useRef(false);

  // Poll broadcast state
  useEffect(() => {
    const poll = setInterval(() => {
      const active = isBroadcastActive();
      if (active !== broadcastingRef.current) {
        broadcastingRef.current = active;
        setIsBroadcasting(active);
      }
    }, 300);
    return () => clearInterval(poll);
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const loadingUrlRef = useRef<string | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const onTrackEndedRef = useRef(onTrackEnded);
  useEffect(() => { onTrackEndedRef.current = onTrackEnded; }, [onTrackEnded]);

  // Connect Web Audio graph for visualizer — ONLY when context is running
  const connectWebAudioGraph = () => {
    const ctx = audioContextRef.current;
    const audio = audioRef.current;
    if (!ctx || !audio || ctx.state !== 'running') return;
    if (!gainNodeRef.current) {
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gainNodeRef.current = gain;
    }
    if (!sourceRef.current) {
      try {
        sourceRef.current = ctx.createMediaElementSource(audio);
        const newAnalyser = ctx.createAnalyser();
        newAnalyser.fftSize = 256;
        sourceRef.current.connect(newAnalyser);
        newAnalyser.connect(gainNodeRef.current!);
        setAnalyser(newAnalyser);
      } catch (err: any) {
        if (!err?.message?.includes('already been created')) {
          console.warn('AudioContext source error:', err);
        }
      }
    }
  };

  const initAudioContext = () => {
    try {
      if (!audioRef.current) return;
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'running') {
        connectWebAudioGraph();
      } else if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          connectWebAudioGraph();
        }).catch(console.warn);
      }
    } catch (e) {
      console.warn('Audio init error:', e);
    }
  };

  // Set CORS based on URL type
  const configureCors = (audio: HTMLAudioElement, url: string) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      audio.crossOrigin = null;
    } else if (url.includes('cloudinary.com') || url.includes('supabase.co')) {
      audio.crossOrigin = 'anonymous';
    } else {
      audio.removeAttribute('crossorigin');
    }
  };

  // Create audio element once on mount
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    audio.addEventListener('play', () => { setStatus('PLAYING'); setIsPlaying(true); onStateChange(true); setErrorMessage(''); });
    audio.addEventListener('pause', () => { setStatus('IDLE'); setIsPlaying(false); onStateChange(false); });
    audio.addEventListener('playing', () => { setStatus('PLAYING'); setIsPlaying(true); onStateChange(true); });
    audio.addEventListener('waiting', () => setStatus('LOADING'));
    audio.addEventListener('ended', () => onTrackEndedRef.current?.());
    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('error', (e) => {
      const target = e.target as HTMLAudioElement;
      if (!target.src || target.src === '' || target.src === window.location.href) return;
      let msg = 'Playback error';
      if (target.error?.code === MediaError.MEDIA_ERR_NETWORK) {
        msg = 'Network error — retrying...';
        // Auto-retry after 2s on network errors
        setTimeout(() => {
          if (audioRef.current && currentUrlRef.current) {
            audioRef.current.load();
            audioRef.current.play().catch(() => {});
          }
        }, 2000);
      } else if (target.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        msg = 'Stream URL not accessible';
      }
      setErrorMessage(msg);
      setStatus('ERROR');
      setIsPlaying(false);
      onStateChange(false);
    });

// Unlock audio pipeline on first user gesture using AudioContext (more reliable than blob)
const unlockAudio = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      setTimeout(() => ctx.close(), 100);
    }
  } catch {}
  window.removeEventListener('click', unlockAudio);
  window.removeEventListener('touchstart', unlockAudio);
};
window.addEventListener('click', unlockAudio, { once: true });
window.addEventListener('touchstart', unlockAudio, { once: true });

    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
      currentUrlRef.current = null;
    };
  }, []);

  // Load when URL changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!activeTrackUrl) {
      loadingUrlRef.current = null;
      currentUrlRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setStatus('IDLE');
      setIsPlaying(false);
      onStateChange(false);
      setErrorMessage('');
      return;
    }

    // Skip if same URL already loaded
    if (currentUrlRef.current === activeTrackUrl) return;

    currentUrlRef.current = activeTrackUrl;
    loadingUrlRef.current = activeTrackUrl;
    configureCors(audio, activeTrackUrl);
    audio.src = activeTrackUrl;
    setStatus('LOADING');
    // Don't auto-play — listener taps play
    setStatus('IDLE');
  }, [activeTrackUrl]);

  // Pause when forcePlaying goes false
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!forcePlaying && !audio.paused) {
      audio.pause();
    }
  }, [forcePlaying]);

  // Volume control
  useEffect(() => {
    const gain = musicVolumeOverride !== null ? musicVolumeOverride : isDucking ? volume * 0.15 : volume;
    if (audioRef.current) audioRef.current.volume = gain;
    if (gainNodeRef.current && audioContextRef.current?.state !== 'closed') {
      try {
        gainNodeRef.current.gain.setTargetAtTime(gain, audioContextRef.current!.currentTime, 0.1);
      } catch {
        gainNodeRef.current.gain.value = gain;
      }
    }
  }, [volume, isDucking, musicVolumeOverride]);

  // Pre-fetch cloud URL so it's ready when user taps play
  const cloudUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (hasApi()) {
      getLiveState().then(live => {
        if (live?.track?.url?.startsWith('http')) {
          cloudUrlRef.current = live.track.url;
        }
      }).catch(() => {});
    }
  }, [activeTrackUrl]);

  const handlePlayPause = () => {
    if (isBroadcasting) {
      isBroadcastPaused() ? resumeBroadcast() : pauseBroadcast();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    // Resume AudioContext on user gesture — required by all browsers
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }

    // Get URL synchronously — NO await, no async gap (required for mobile)
    const streamUrl = activeTrackUrl || dbService.getLiveStreamUrl() || cloudUrlRef.current || null;

    if (!streamUrl) {
      // No URL yet — fetch from Supabase and show loading
      setStatus('LOADING');
      setErrorMessage('');
      getLiveState().then(live => {
        const url = live?.track?.url;
        if (url?.startsWith('http')) {
          cloudUrlRef.current = url;
          currentUrlRef.current = url;
          loadingUrlRef.current = url;
          configureCors(audio, url);
          audio.src = url;
          audio.play().catch((err: any) => {
            setStatus('IDLE');
            setErrorMessage(err.name === 'NotAllowedError' ? 'Tap ▶ to play' : 'Failed to play');
          });
        } else {
          setStatus('IDLE');
          setErrorMessage('No stream available. Admin needs to start playing.');
          setTimeout(() => setErrorMessage(''), 3000);
        }
      }).catch(() => {
        setStatus('IDLE');
        setErrorMessage('Connection error. Check your internet.');
        setTimeout(() => setErrorMessage(''), 3000);
      });
      return;
    }

    setStatus('LOADING');
    setErrorMessage('');

    // Load new URL if different
    if (currentUrlRef.current !== streamUrl) {
      currentUrlRef.current = streamUrl;
      loadingUrlRef.current = streamUrl;
      configureCors(audio, streamUrl);
      audio.src = streamUrl;
    }

    // Init audio context for visualizer (local files only)
    const isLocal = streamUrl.startsWith('blob:') || streamUrl.startsWith('data:');
    if (isLocal) initAudioContext();

    // Play — synchronous call inside user gesture satisfies mobile autoplay policy
    audio.play().catch((err: any) => {
      if (err.name === 'NotAllowedError') {
        setStatus('IDLE');
        setErrorMessage('Tap ▶ to play');
        setTimeout(() => setErrorMessage(''), 4000);
      } else {
        setStatus('ERROR');
        setErrorMessage(err.message || 'Failed to play');
      }
    });
  };

  const handleStop = () => {
    if (isBroadcasting) { stopBroadcast(); return; }
    audioRef.current?.pause();
  };

  const handleVolumeChange = (val: number) => {
    setVolume(val);
    if (isBroadcasting) setBroadcastVolume(val);
    if (audioRef.current && musicVolumeOverride === null) audioRef.current.volume = val;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const fmt = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex flex-col items-center justify-center space-y-2 w-full">
      <Logo size="lg" analyser={analyser} isPlaying={isPlaying} />

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
        <div className={`px-4 py-2 rounded-full border w-full overflow-hidden shadow-inner flex items-center justify-center text-center ${isBroadcasting ? 'bg-red-50 border-red-200' : 'bg-[#008751]/10 border-green-200/50'}`}>
          <span className={`text-[7px] font-black uppercase tracking-widest line-clamp-1 ${isBroadcasting ? 'text-red-700' : 'text-green-800'}`}>
            {isBroadcasting
              ? (isBroadcastPaused() ? '⏸ BROADCAST PAUSED' : '🔴 LIVE BROADCAST — TAP TO PAUSE')
              : isPlaying
                ? `🔴 NOW PLAYING: ${currentTrackName}`
                : activeTrackUrl
                  ? `📻 TAP ▶ — ${currentTrackName || 'LIVE STREAM READY'}`
                  : '📻 TAP ▶ TO LISTEN LIVE'}
          </span>
        </div>

        {errorMessage && (
          <div className="bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 w-full">
            <p className="text-[8px] font-semibold text-red-600 text-center">{errorMessage}</p>
          </div>
        )}

        <div className="flex items-center space-x-3">
          <button
            onClick={handlePlayPause}
            disabled={status === 'LOADING' && !isBroadcasting}
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all border-4 border-white ${isBroadcasting ? (isBroadcastPaused() ? 'bg-amber-500' : 'bg-red-500') : status === 'ERROR' ? 'bg-red-500' : 'bg-[#008751]'} text-white`}
          >
            {status === 'LOADING' && !isBroadcasting
              ? <i className="fas fa-circle-notch fa-spin" />
              : isBroadcasting
                ? <i className={`fas ${isBroadcastPaused() ? 'fa-play' : 'fa-pause'} text-lg`} />
                : status === 'ERROR'
                  ? <i className="fas fa-exclamation-triangle" />
                  : isPlaying
                    ? <i className="fas fa-pause text-lg" />
                    : <i className="fas fa-play text-lg ml-1" />}
          </button>
          {isBroadcasting && (
            <button onClick={handleStop} className="w-10 h-10 rounded-full bg-gray-800 text-white flex items-center justify-center shadow-lg active:scale-95 border-2 border-white">
              <i className="fas fa-stop text-sm" />
            </button>
          )}
        </div>

        <div className="w-32 flex items-center space-x-2">
          <i className="fas fa-volume-down text-green-600 text-[8px]" />
          <input type="range" min="0" max="1" step="0.01" value={volume}
            onChange={e => handleVolumeChange(parseFloat(e.target.value))}
            className="flex-grow h-0.5 bg-green-100 rounded-lg appearance-none accent-[#008751]" />
          <i className="fas fa-volume-up text-green-600 text-[8px]" />
        </div>
      </div>
    </div>
  );
};

export default RadioPlayer;
