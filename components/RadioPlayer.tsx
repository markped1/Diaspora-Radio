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
  const isStreamRef = useRef<boolean>(false);
  const loadingUrlRef = useRef<string | null>(null); // track which URL is currently loading
  const currentUrlRef = useRef<string | null>(null); // reliable URL tracking (audio.src is normalized by browsers)
  const onTrackEndedRef = useRef(onTrackEnded);
  useEffect(() => { onTrackEndedRef.current = onTrackEnded; }, [onTrackEnded]);

  // Connect the audio element to Web Audio API graph (for visualizer)
  // IMPORTANT: createMediaElementSource() redirects ALL audio through Web Audio.
  // If AudioContext is suspended, this causes SILENCE. So we ONLY connect
  // after confirming the context is running.
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
        console.log('🔊 Web Audio graph connected (visualizer active)');
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
        // Context is active — safe to connect the audio graph
        connectWebAudioGraph();
      } else if (ctx.state === 'suspended') {
        // Try to resume; only connect graph AFTER it actually starts running
        // This prevents Edge from swallowing audio into a suspended graph
        ctx.resume().then(() => {
          if (ctx.state === 'running') {
            connectWebAudioGraph();
          }
        }).catch(() => {
          console.warn('AudioContext resume deferred — audio plays through default output');
        });
      }
    } catch (e) {
      console.error('Audio init error:', e);
    }
  };

  // Helper: configure crossOrigin based on URL type
  const configureCrossOrigin = (audio: HTMLAudioElement, url: string) => {
    const isLocal = url.startsWith('blob:') || url.startsWith('data:');
    const isCloudinary = url.includes('cloudinary.com') || url.includes('res.cloudinary');
    const isSupabase = url.includes('supabase');
    const isCorsReady = isCloudinary || isSupabase;

    if (isLocal) {
      // Local blobs don't need CORS
      audio.removeAttribute('crossorigin');
    } else if (isCorsReady) {
      // Cloud CDNs that send proper CORS headers
      audio.crossOrigin = 'anonymous';
    } else {
      // Unknown remote URLs (streams etc.) — don't set crossOrigin
      // Setting it on servers that don't support CORS will block playback
      audio.removeAttribute('crossorigin');
    }
  };

  // Create audio element once on mount
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto'; // hint browsers to buffer ahead
    audioRef.current = audio;
    audio.addEventListener('play', () => { setStatus('PLAYING'); setIsPlaying(true); onStateChange(true); setErrorMessage(''); });
    audio.addEventListener('pause', () => { setStatus('IDLE'); setIsPlaying(false); onStateChange(false); });
    audio.addEventListener('playing', () => { setStatus('PLAYING'); setIsPlaying(true); onStateChange(true); });
    audio.addEventListener('waiting', () => setStatus('LOADING'));
    audio.addEventListener('ended', () => onTrackEndedRef.current?.());
    audio.addEventListener('timeupdate', () => { setCurrentTime(audio.currentTime); });
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('error', (e) => {
      const target = e.target as HTMLAudioElement;
      // Ignore errors when src is empty (happens during cleanup)
      if (!target.src || target.src === '' || target.src === window.location.href) return;
      let msg = 'Playback error';
      if (target.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) msg = 'Format not supported — trying different source';
      else if (target.error?.code === MediaError.MEDIA_ERR_NETWORK) msg = 'Network error — retrying...';
      else if (target.error?.code === MediaError.MEDIA_ERR_DECODE) msg = 'Decode error — audio format issue';
      console.warn(`Audio error [${target.error?.code}]: ${msg}`, target.src?.substring(0, 80));
      setErrorMessage(msg);
      setStatus('ERROR');
      setIsPlaying(false);
      onStateChange(false);
      loadingUrlRef.current = null;

      // Auto-retry once after a short delay (handles transient network blips)
      if (target.error?.code === MediaError.MEDIA_ERR_NETWORK && currentUrlRef.current) {
        setTimeout(() => {
          if (audioRef.current && currentUrlRef.current) {
            console.log('🔄 Auto-retrying audio load...');
            audioRef.current.load();
            audioRef.current.play().catch(() => {});
          }
        }, 2000);
      }
    });

    // 🚀 Global Audio Unlocking Strategy for iOS & Android Webview
    // We attach an interaction listener to unlock the audio element on the very first tap
    // This allows seamless background track switching by Admin without hitting Autoplay blocks
    const unlockAudio = () => {
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
      
      if (!audio.src || audio.src === window.location.href) {
        // Load an initial tiny silent MP3 blob just to unlock the playback API natively
        audio.src = 'data:audio/mp3;base64,//OExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
        audio.play().then(() => {
          audio.pause(); 
          audio.removeAttribute('src'); 
          audio.load();
          console.log('🔓 Audio pipeline globally unlocked');
        }).catch(() => {});
      }
      
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };

    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load(); // release resources properly
      audioRef.current = null;
      currentUrlRef.current = null;
    };
  }, []);

  // Load and play when URL changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!activeTrackUrl) {
      loadingUrlRef.current = null;
      currentUrlRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load(); // release resources
      setStatus('IDLE');
      setIsPlaying(false);
      onStateChange(false);
      setErrorMessage('');
      return;
    }

    // Skip if same URL already loaded/loading — use our ref, not audio.src
    // (browsers normalize audio.src which breaks string comparison for blob: URLs)
    if (currentUrlRef.current === activeTrackUrl || loadingUrlRef.current === activeTrackUrl) return;

    const isLocal = activeTrackUrl.startsWith('blob:') || activeTrackUrl.startsWith('data:');
    isStreamRef.current = !isLocal;
    loadingUrlRef.current = activeTrackUrl;
    currentUrlRef.current = activeTrackUrl;

    // Configure CORS based on URL type
    configureCrossOrigin(audio, activeTrackUrl);

    audio.src = activeTrackUrl;
    audio.load(); // required by Safari and Firefox to start buffering
    setStatus('LOADING');

    // Initialize AudioContext for visualizer (works for both streams and local files)
    initAudioContext();

    // Only auto-play if forcePlaying is true (admin triggered)
    // Otherwise just load — user will tap play themselves
    if (forcePlaying) {
      // Use canplaythrough for better reliability — means enough data is buffered
      const readyEvent = isStreamRef.current ? 'canplay' : 'canplaythrough';
      audio.addEventListener(readyEvent, function onReady() {
        audio.removeEventListener(readyEvent, onReady);
        if (loadingUrlRef.current !== activeTrackUrl) return;
        // Resume AudioContext if suspended (Safari requires this during user gesture chain)
        if (audioContextRef.current?.state === 'suspended') {
          audioContextRef.current.resume().catch(() => {});
        }
        audio.play().catch(err => {
          if (err.name === 'NotAllowedError') {
            setStatus('IDLE');
            setErrorMessage('Tap ▶ to play');
            setTimeout(() => setErrorMessage(''), 4000);
          } else if (err.name === 'AbortError') {
            // Another load interrupted this one — safe to ignore
            setStatus('IDLE');
          } else {
            console.warn('Auto-play failed:', err.message);
            setStatus('IDLE');
          }
          loadingUrlRef.current = null;
        });
      });
    } else {
      // Just preload — user taps play when ready
      setStatus('IDLE');
    }
  }, [activeTrackUrl]);

  // Handle pause when forcePlaying goes false
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!forcePlaying && !audio.paused) {
      audio.pause();
      loadingUrlRef.current = null;
    } else if (forcePlaying && audio.paused && activeTrackUrl) {
      // Auto-resume if forcePlaying is toggled back to true and we have a track
      audio.play().catch(() => {});
    }
  }, [forcePlaying]);

  // Volume control
  useEffect(() => {
    let gain = musicVolumeOverride !== null ? musicVolumeOverride : isDucking ? volume * 0.15 : volume;
    // Always set volume on the audio element directly (works without Web Audio)
    if (audioRef.current) audioRef.current.volume = gain;
    // Also update Web Audio gain node if graph is connected and running
    if (gainNodeRef.current && audioContextRef.current?.state === 'running') {
      try {
        gainNodeRef.current.gain.setTargetAtTime(gain, audioContextRef.current.currentTime, 0.1);
      } catch {
        // Edge sometimes throws if context transitions during this call
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
  }, [activeTrackUrl]); // re-fetch when activeTrackUrl changes

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

    // Resume AudioContext on user gesture — required by Safari/Chrome/Edge autoplay policy
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }

    // Get URL synchronously — no await, no async gap
    const streamUrl = activeTrackUrl || dbService.getLiveStreamUrl() || cloudUrlRef.current || null;

    if (!streamUrl) {
      setStatus('IDLE');
      setErrorMessage('No stream available. Admin needs to start playing.');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }

    setStatus('LOADING');
    setErrorMessage('');

    // Helper: attempt play with proper error handling for all browsers
    const attemptPlay = () => {
      audio.play().catch((err: any) => {
        if (err.name === 'NotAllowedError') {
          setStatus('IDLE');
          setErrorMessage('Tap ▶ to play');
          setTimeout(() => setErrorMessage(''), 4000);
        } else if (err.name === 'AbortError') {
          // load() interrupted play — wait for media to be ready, then retry
          const retryOnReady = () => {
            audio.play().catch(() => { setStatus('IDLE'); });
          };
          // Try canplay first, with a timeout fallback for Edge
          const timeout = setTimeout(() => {
            audio.removeEventListener('canplay', onCanPlay);
            retryOnReady();
          }, 3000);
          const onCanPlay = () => {
            clearTimeout(timeout);
            retryOnReady();
          };
          audio.addEventListener('canplay', onCanPlay, { once: true });
        } else {
          setStatus('ERROR');
          setErrorMessage(err.message || 'Failed to play');
          console.warn('Play failed:', err.name, err.message);
        }
        loadingUrlRef.current = null;
      });
    };

    // Use our ref for comparison instead of audio.src (which browsers normalize)
    if (currentUrlRef.current !== streamUrl) {
      // New URL — need to load first
      const isLocal = streamUrl.startsWith('blob:') || streamUrl.startsWith('data:');
      isStreamRef.current = !isLocal;
      configureCrossOrigin(audio, streamUrl);
      audio.src = streamUrl;
      currentUrlRef.current = streamUrl;
      loadingUrlRef.current = streamUrl;
      initAudioContext();

      // Call attemptPlay() synchronously inside the user gesture.
      // Browsers like Safari and Chrome on Android REQUIRE the play() promise to be
      // initiated synchronously from within the click handler to unlock the audio element.
      // If we defer attemptPlay() using loadstart/setTimeout, they throw NotAllowedError.
      // If load() aborts the play() on Edge, attemptPlay() will catch the AbortError
      // and safely retry once the 'canplay' event fires.
      audio.load();
      attemptPlay();
    } else {
      // Same URL already loaded — play directly (fast path)
      attemptPlay();
    }
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
