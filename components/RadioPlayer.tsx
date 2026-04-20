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
  const onTrackEndedRef = useRef(onTrackEnded);
  useEffect(() => { onTrackEndedRef.current = onTrackEnded; }, [onTrackEnded]);

  const initAudioContext = () => {
    try {
      if (!audioRef.current || isStreamRef.current) return;
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(console.warn);
      if (!gainNodeRef.current) {
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gainNodeRef.current = gain;
      }
      if (!sourceRef.current) {
        try {
          sourceRef.current = ctx.createMediaElementSource(audioRef.current);
          const newAnalyser = ctx.createAnalyser();
          newAnalyser.fftSize = 256;
          sourceRef.current.connect(newAnalyser);
          newAnalyser.connect(gainNodeRef.current!);
          setAnalyser(newAnalyser);
        } catch (err) {
          console.warn('AudioContext source error:', err);
        }
      }
    } catch (e) {
      console.error('Audio init error:', e);
    }
  };

  // Create audio element once on mount
  useEffect(() => {
    const audio = new Audio();
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
      let msg = 'Playback error';
      if (target.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) msg = 'Stream URL not accessible';
      else if (target.error?.code === MediaError.MEDIA_ERR_NETWORK) msg = 'Network error';
      setErrorMessage(msg);
      setStatus('ERROR');
      setIsPlaying(false);
      onStateChange(false);
      loadingUrlRef.current = null;
    });
    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  // Load and play when URL changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!activeTrackUrl) {
      loadingUrlRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setStatus('IDLE');
      setIsPlaying(false);
      onStateChange(false);
      setErrorMessage('');
      return;
    }

    // Skip if same URL already loaded/loading
    if (audio.src === activeTrackUrl || loadingUrlRef.current === activeTrackUrl) return;

    const isLocal = activeTrackUrl.startsWith('blob:') || activeTrackUrl.startsWith('data:');
    isStreamRef.current = !isLocal;
    loadingUrlRef.current = activeTrackUrl;

    if (isLocal) audio.crossOrigin = null;
    else audio.removeAttribute('crossorigin');

    audio.src = activeTrackUrl;
    audio.load();
    setStatus('LOADING');

    if (!isStreamRef.current) initAudioContext();

    // Play as soon as enough data is available
    audio.addEventListener('canplay', function onReady() {
      audio.removeEventListener('canplay', onReady);
      if (loadingUrlRef.current !== activeTrackUrl) return; // URL changed, abort
      audio.play().catch(err => {
        if (err.name === 'NotAllowedError') {
          setStatus('IDLE');
          setErrorMessage('Tap ▶ to play');
          setTimeout(() => setErrorMessage(''), 4000);
        } else {
          setStatus('IDLE');
        }
        loadingUrlRef.current = null;
      });
    });
  }, [activeTrackUrl]);

  // Handle pause when forcePlaying goes false
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!forcePlaying && !audio.paused) {
      audio.pause();
      loadingUrlRef.current = null;
    }
  }, [forcePlaying]);

  // Volume control
  useEffect(() => {
    let gain = musicVolumeOverride !== null ? musicVolumeOverride : isDucking ? volume * 0.15 : volume;
    if (audioRef.current) audioRef.current.volume = gain;
    if (gainNodeRef.current && audioContextRef.current?.state !== 'closed') {
      gainNodeRef.current.gain.setTargetAtTime(gain, audioContextRef.current!.currentTime, 0.1);
    }
  }, [volume, isDucking, musicVolumeOverride]);

  const handlePlayPause = async () => {
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

    // Find stream URL
    let streamUrl = activeTrackUrl || dbService.getLiveStreamUrl() || null;
    if (!streamUrl && hasApi()) {
      try {
        setStatus('LOADING');
        const live = await getLiveState();
        if (live?.track?.url?.startsWith('http')) streamUrl = live.track.url;
      } catch {}
    }

    if (!streamUrl) {
      setStatus('IDLE');
      setErrorMessage('No stream available. Admin needs to start playing.');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }

    setStatus('LOADING');
    setErrorMessage('');

    if (audio.src !== streamUrl) {
      isStreamRef.current = true;
      audio.removeAttribute('crossorigin');
      audio.src = streamUrl;
      audio.load();
      loadingUrlRef.current = streamUrl;
    }

    try {
      await audio.play();
    } catch (err: any) {
      setStatus('ERROR');
      setErrorMessage(err.message || 'Failed to play');
      loadingUrlRef.current = null;
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
              : (activeTrackUrl ? `NOW PLAYING: ${currentTrackName}` : '📻 TAP ▶ TO LISTEN LIVE')}
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
