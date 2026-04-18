import React, { useState, useRef, useEffect } from 'react';
import Logo from './Logo';

interface RadioPlayerProps {
  onStateChange: (isPlaying: boolean) => void;
  activeTrackUrl?: string | null;
  currentTrackName?: string;
  forcePlaying?: boolean;
  onTrackEnded?: () => void;
  isAdmin?: boolean;
  isDucking?: boolean;
  musicVolumeOverride?: number | null; // null = use normal volume, 0-1 = override
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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isStreamRef = useRef<boolean>(false);

  const onTrackEndedRef = useRef(onTrackEnded);
  useEffect(() => {
    onTrackEndedRef.current = onTrackEnded;
  }, [onTrackEnded]);

  const initAudioContext = () => {
    try {
      if (!audioRef.current) return;

      // Only use Web Audio API for local files/blobs to avoid CORS silence for streams
      if (isStreamRef.current) {
        if (analyser) setAnalyser(null);
        return;
      }

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(console.warn);
      }

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
          console.warn("MediaElementSource creation ignored (likely CORS):", err);
          // Fallback handled by the isStreamRef check above
        }
      }
    } catch (e) {
      console.error("Audio Initialization Failure:", e);
    }
  };

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const handlePlay = () => {
      setStatus('PLAYING');
      setIsPlaying(true);
      onStateChange(true);
      setErrorMessage('');
    };

    const handlePause = () => {
      setStatus('IDLE');
      setIsPlaying(false);
      onStateChange(false);
    };

    const handleError = (e: Event) => {
      const target = e.target as HTMLAudioElement;
      let message = 'Playback error';

      if (target.error) {
        switch (target.error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            message = 'Playback aborted';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            message = 'Network error - Check your connection';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            message = 'Audio format not supported';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            message = 'Stream URL not accessible or invalid';
            break;
        }
      }

      console.error("Audio Playback Error:", message, target.error);
      setErrorMessage(message);
      setStatus('ERROR');
      setIsPlaying(false);
      onStateChange(false);
    };

    const handleCanPlay = () => {
      console.log("Stream ready to play");
      if (status === 'LOADING') {
        setStatus('IDLE');
      }
    };

    const handleLoadStart = () => {
      console.log("Loading stream...");
      setStatus('LOADING');
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);
    audio.addEventListener('waiting', () => setStatus('LOADING'));
    audio.addEventListener('playing', handlePlay);
    audio.addEventListener('ended', () => onTrackEndedRef.current?.());
    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('loadstart', handleLoadStart);

    const targetSrc = activeTrackUrl;
    if (!targetSrc) {
      setStatus('IDLE');
      return;
    }
    isStreamRef.current = !targetSrc.startsWith('blob:') && !targetSrc.startsWith('data:');

    // CRITICAL FIX: Don't set crossOrigin for live streams
    // Many streaming services don't send proper CORS headers
    if (targetSrc.startsWith('blob:') || targetSrc.startsWith('data:')) {
      audio.crossOrigin = null;
    } else {
      // For online streams, don't set crossOrigin unless needed
      // This allows the stream to play without CORS restrictions
      audio.removeAttribute('crossorigin');
    }

    audio.src = targetSrc;
    audio.preload = 'none'; // Don't preload streams

    return () => {
      audio.pause();
      audio.src = "";
      audio.removeAttribute('src');
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      const targetSrc = activeTrackUrl;
      if (!targetSrc) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
        setStatus('IDLE');
        setIsPlaying(false);
        onStateChange(false);
        setErrorMessage('');
        return;
      }
      if (audioRef.current.src !== targetSrc) {
        const isLocal = targetSrc.startsWith('blob:') || targetSrc.startsWith('data:');
        isStreamRef.current = !isLocal;

        // Disable CORS handling for blobs/data to avoid issues
        if (isLocal) {
          audioRef.current.crossOrigin = null;
        } else {
          audioRef.current.removeAttribute('crossorigin');
        }

        audioRef.current.src = targetSrc;
        audioRef.current.load();

        if (isPlaying || forcePlaying) {
          if (!isStreamRef.current) {
            initAudioContext();
          }

          audioRef.current.play().catch(err => {
            console.warn("Playback failed:", err);
            setStatus('IDLE');
          });
        }
      }
    }
  }, [activeTrackUrl]);

  useEffect(() => {
    if (audioRef.current) {
      if (forcePlaying && audioRef.current.paused) {
        // Only init audio context for local files
        if (!isStreamRef.current) {
          initAudioContext();
        }

        audioRef.current.play().catch((err) => {
          console.error("Play failed:", err);
          setStatus('ERROR');
          setErrorMessage('Failed to play - Try clicking play again');
        });
      } else if (!forcePlaying && !audioRef.current.paused) {
        audioRef.current.pause();
      }
    }
  }, [forcePlaying]);

  useEffect(() => {
    // Priority: musicVolumeOverride > isDucking > normal volume
    let targetGain: number;
    if (musicVolumeOverride !== null) {
      targetGain = musicVolumeOverride; // Explicit override (0 = stop, 0.15 = duck, 0.30 = soft duck)
    } else if (isDucking) {
      targetGain = volume * 0.15;       // Legacy duck for custom broadcasts
    } else {
      targetGain = volume;              // Normal playback
    }

    if (audioRef.current) {
      audioRef.current.volume = targetGain;
    }
    if (gainNodeRef.current && audioContextRef.current && audioContextRef.current.state !== 'closed') {
      gainNodeRef.current.gain.setTargetAtTime(targetGain, audioContextRef.current.currentTime, 0.1);
    }
  }, [volume, isDucking, musicVolumeOverride]);

  const handlePlayPause = async () => {
    if (!audioRef.current || !activeTrackUrl) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      setStatus('LOADING');
      setErrorMessage('');

      // Only init audio context for local files
      if (!isStreamRef.current) {
        initAudioContext();
      }

      try {
        await audioRef.current.play();
      } catch (err: any) {
        console.error("Play error:", err);
        setStatus('ERROR');
        setErrorMessage(err.message || 'Failed to play stream');
      }
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-2 w-full">
      <Logo size="lg" analyser={analyser} isPlaying={isPlaying} />

      <div className="w-full px-8 -mt-8 relative z-20">
        <div className="h-1 w-full bg-green-100 rounded-full overflow-hidden">
          <div className="h-full bg-[#008751] transition-all duration-300" style={{ width: `${progress}%` }}></div>
        </div>
        {duration > 0 && isFinite(duration) && (
          <div className="flex justify-between mt-1 px-1">
            <span className="text-[6px] font-bold text-green-700">{formatTime(currentTime)}</span>
            <span className="text-[6px] font-bold text-green-700">{formatTime(duration)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center space-y-3 relative z-20 w-full px-12">
        {/* Track Info Display */}
        <div className="bg-[#008751]/10 px-4 py-2 rounded-full border border-green-200/50 w-full overflow-hidden shadow-inner flex items-center justify-center text-center">
          <span className="text-[7px] font-black uppercase text-green-800 tracking-widest line-clamp-1">
            {activeTrackUrl ? `NOW PLAYING: ${currentTrackName}` : 'NO AUDIO SELECTED'}
          </span>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 w-full">
            <p className="text-[8px] font-semibold text-red-600 text-center">{errorMessage}</p>
          </div>
        )}

        <button
          onClick={handlePlayPause}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all ${status === 'ERROR' ? 'bg-red-500' : 'bg-[#008751]'} text-white border-4 border-white`}
          disabled={status === 'LOADING'}
        >
          {status === 'LOADING' ? <i className="fas fa-circle-notch fa-spin"></i> :
            status === 'ERROR' ? <i className="fas fa-exclamation-triangle"></i> :
              isPlaying ? <i className="fas fa-pause text-lg"></i> : <i className="fas fa-play text-lg ml-1"></i>}
        </button>

        <div className="w-32 flex items-center space-x-2">
          <i className="fas fa-volume-down text-green-600 text-[8px]"></i>
          <input
            type="range" min="0" max="1" step="0.01" value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="flex-grow h-0.5 bg-green-100 rounded-lg appearance-none accent-[#008751]"
          />
          <i className="fas fa-volume-up text-green-600 text-[8px]"></i>
        </div>
      </div>
    </div>
  );
};

export default RadioPlayer;
