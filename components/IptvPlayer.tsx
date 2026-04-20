/**
 * IptvPlayer — plays HLS/M3U8 streams using hls.js on all browsers.
 * hls.js is used universally (Chrome, Firefox, Edge, Android WebView)
 * because it handles CORS headers consistently.
 * Safari uses native HLS as fallback since it doesn't support hls.js MSE.
 */
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
  const [status, setStatus] = useState<'loading' | 'playing' | 'error' | 'blocked'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setStatus('loading');
    setErrorMsg('');

    // Destroy previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = url.includes('.m3u8') || url.includes('m3u8');

    const doPlay = () => {
      video.muted = true; // must be muted for autoplay on all browsers
      video.playsInline = true;
      video.play().catch(err => {
        if (err.name === 'NotAllowedError') {
          setStatus('blocked'); // show tap-to-play
        }
      });
    };

    if (isHls && Hls.isSupported()) {
      // Use hls.js on Chrome, Firefox, Edge, Android WebView
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 30,
        backBufferLength: 60,
        nudgeOffset: 0.1,
        nudgeMaxRetries: 10,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        },
      });
      hlsRef.current = hls;
      
      // CRITICAL: Set crossOrigin for HLS streams to allow data access
      video.crossOrigin = 'anonymous';

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) doPlay();
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS Network error, trying to recover...', data);
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS Media error, trying to recover...', data);
              hls.recoverMediaError();
              break;
            default:
              setStatus('error');
              setErrorMsg('Stream unavailable or CORS blocked');
              hls.destroy();
              onError?.();
              break;
          }
        }
      });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.load();
      if (autoPlay) doPlay();
    } else {
      // Non-HLS direct URL (MP4, WebM)
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.load();
      if (autoPlay) doPlay();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.src = '';
    };
  }, [url]);

  // Sync muted state
  useEffect(() => {
    if (videoRef.current && status === 'playing') {
      videoRef.current.muted = muted;
    }
  }, [muted, status]);

  const handleTapToPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.play().then(() => setStatus('playing')).catch(console.warn);
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
            setErrorMsg('Stream unavailable');
            onError?.();
          }
        }}
      />

      {/* Loading spinner */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 space-y-2">
          <i className="fas fa-circle-notch fa-spin text-white text-2xl"></i>
          <span className="text-[7px] font-black text-white uppercase tracking-widest">Connecting...</span>
        </div>
      )}

      {/* Tap to play (autoplay blocked) */}
      {status === 'blocked' && (
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
          <i className="fas fa-exclamation-triangle text-red-400 text-2xl"></i>
          <span className="text-[7px] font-black text-red-300 uppercase tracking-widest text-center">{errorMsg}</span>
          <span className="text-[6px] text-gray-500 text-center">Stream may be offline or geo-blocked</span>
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
