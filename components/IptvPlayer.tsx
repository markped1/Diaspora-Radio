/**
 * IptvPlayer — Production-ready HLS/IPTV stream player
 * Works on: Chrome, Firefox, Edge, Safari, Android WebView (Capacitor APK), iOS
 *
 * Strategy:
 * - Uses hls.js on ALL browsers that support MSE (Chrome, Firefox, Edge, Android WebView)
 * - Falls back to native HLS on Safari/iOS
 * - Always starts muted for autoplay compliance
 * - Shows "Tap to Watch" overlay when autoplay is blocked
 * - Auto-recovers from network and media errors
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

    // Destroy previous hls instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = url.includes('.m3u8') || url.includes('m3u8');

    // Attempt play — always start muted for autoplay policy
    const doPlay = () => {
      video.muted = true;
      video.play().catch(err => {
        if (err.name === 'NotAllowedError') {
          setStatus('blocked'); // show tap-to-play overlay
        }
      });
    };

    if (isHls && Hls.isSupported()) {
      // hls.js handles HLS on Chrome, Firefox, Edge, Android WebView
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 30,
        backBufferLength: 60,
        nudgeOffset: 0.1,
        nudgeMaxRetries: 10,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false; // prevents CORS preflight issues
        },
      });
      hlsRef.current = hls;

      // Don't set crossOrigin — many streams don't support CORS headers
      video.removeAttribute('crossorigin');
      video.playsInline = true;

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) doPlay();
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Try to recover from network errors
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              // Try to recover from media errors
              hls.recoverMediaError();
              break;
            default:
              setStatus('error');
              setErrorMsg('Stream unavailable or blocked');
              hls.destroy();
              onError?.();
              break;
          }
        }
      });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari / iOS — native HLS
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.removeAttribute('crossorigin');
      video.load();
      if (autoPlay) doPlay();
    } else {
      // Non-HLS direct URL (MP4, WebM, etc.)
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.removeAttribute('crossorigin');
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

  // Sync muted state after playing starts
  useEffect(() => {
    if (videoRef.current && status === 'playing') {
      videoRef.current.muted = muted;
    }
  }, [muted, status]);

  // User taps to play — unmute and play with user gesture
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
          // Only show error if hls.js isn't handling it
          if (!hlsRef.current) {
            setStatus('error');
            setErrorMsg('Stream unavailable');
            onError?.();
          }
        }}
      />

      {/* Loading */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 space-y-2">
          <i className="fas fa-circle-notch fa-spin text-white text-2xl" />
          <span className="text-[7px] font-black text-white uppercase tracking-widest">Connecting...</span>
        </div>
      )}

      {/* Tap to play — autoplay blocked by browser */}
      {status === 'blocked' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 space-y-3 cursor-pointer"
          onClick={handleTapToPlay}
        >
          <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center shadow-xl">
            <i className="fas fa-play text-white text-xl ml-1" />
          </div>
          <span className="text-[8px] font-black text-white uppercase tracking-widest">Tap to Watch</span>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 space-y-2 px-4">
          <i className="fas fa-exclamation-triangle text-red-400 text-2xl" />
          <span className="text-[7px] font-black text-red-300 uppercase tracking-widest text-center">{errorMsg}</span>
          <span className="text-[6px] text-gray-500 text-center">Stream may be offline or geo-blocked</span>
        </div>
      )}

      {/* Live badge */}
      {status === 'playing' && (
        <div className="absolute top-2 left-2 bg-red-600 px-2 py-0.5 rounded-full flex items-center space-x-1">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
          <span className="text-[6px] font-black text-white uppercase">Live</span>
        </div>
      )}
    </div>
  );
};

export default IptvPlayer;
