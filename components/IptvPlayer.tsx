import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';

interface IptvPlayerProps {
  url: string;
  muted?: boolean;
  autoPlay?: boolean;
  onError?: () => void;
  onPlaying?: () => void;
  className?: string;
}

const IptvPlayer: React.FC<IptvPlayerProps> = ({
  url,
  muted = false,
  autoPlay = true,
  onError,
  onPlaying,
  className = 'w-full h-full object-contain',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [status, setStatus] = useState<'loading' | 'playing' | 'error' | 'paused'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const tryPlay = (video: HTMLVideoElement) => {
    video.play().catch(err => {
      if (err.name === 'NotAllowedError') {
        // Autoplay blocked — show tap to play
        setStatus('paused');
      } else {
        console.warn('Play failed:', err.message);
      }
    });
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setStatus('loading');
    setErrorMsg('');

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = url.includes('.m3u8');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.muted = true; // must be muted for autoplay
        if (autoPlay) tryPlay(video);
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setStatus('error');
          setErrorMsg('Stream unavailable or CORS blocked');
          onError?.();
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = url;
      video.muted = true;
      video.load();
      if (autoPlay) tryPlay(video);
    } else {
      video.src = url;
      video.muted = true;
      video.load();
      if (autoPlay) tryPlay(video);
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      video.pause();
      video.src = '';
    };
  }, [url]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const handleTapToPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.play().catch(console.warn);
  };

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        className={className}
        muted
        playsInline
        controls={false}
        onPlaying={() => { setStatus('playing'); onPlaying?.(); }}
        onWaiting={() => { if (status === 'playing') setStatus('loading'); }}
        onError={() => {
          if (!hlsRef.current) {
            setStatus('error');
            setErrorMsg('Stream unavailable or CORS blocked');
            onError?.();
          }
        }}
      />

      {/* Loading */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 space-y-2">
          <i className="fas fa-circle-notch fa-spin text-white text-xl"></i>
          <span className="text-[7px] font-black text-white uppercase tracking-widest">Connecting...</span>
        </div>
      )}

      {/* Tap to play — Chrome autoplay blocked */}
      {status === 'paused' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 space-y-3 cursor-pointer"
          onClick={handleTapToPlay}
        >
          <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center shadow-xl">
            <i className="fas fa-play text-white text-xl ml-1"></i>
          </div>
          <span className="text-[8px] font-black text-white uppercase tracking-widest">Tap to Watch</span>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 space-y-2 px-4">
          <i className="fas fa-exclamation-triangle text-red-400 text-xl"></i>
          <span className="text-[7px] font-black text-red-300 uppercase tracking-widest text-center">{errorMsg}</span>
          <span className="text-[6px] text-gray-500 text-center">Stream may be offline or CORS-blocked</span>
        </div>
      )}

      {/* Live badge */}
      {status === 'playing' && (
        <div className="absolute top-2 left-2 bg-red-600 px-2 py-0.5 rounded-full flex items-center space-x-1">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
          <span className="text-[6px] font-black text-white uppercase">Live</span>
        </div>
      )}
    </div>
  );
};

export default IptvPlayer;
