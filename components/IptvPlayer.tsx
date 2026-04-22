/**
 * IptvPlayer — Production-ready HLS/IPTV stream player
 * Works on: Chrome, Firefox, Edge, Safari, Android WebView (Capacitor APK), iOS
 *
 * Strategy:
 * - Tries direct stream first
 * - On CORS/network failure, retries through CORS proxy automatically
 * - Uses hls.js on MSE browsers, native HLS on Safari/iOS
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

// CORS proxy — routes stream through Cloudflare Worker
const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';
function proxyUrl(url: string): string {
  if (!PROXY_URL) return url;
  return `${PROXY_URL}?url=${encodeURIComponent(url)}`;
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
  const retriedWithProxy = useRef(false);

  const loadStream = (streamUrl: string, video: HTMLVideoElement) => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('m3u8');

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

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) doPlay();
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // First fatal network error — retry with proxy if not already tried
              if (!retriedWithProxy.current && PROXY_URL && !streamUrl.includes(PROXY_URL)) {
                retriedWithProxy.current = true;
                hls.destroy();
                hlsRef.current = null;
                loadStream(proxyUrl(url), video);
              } else {
                hls.startLoad();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
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
      video.src = streamUrl;
      video.muted = true;
      video.playsInline = true;
      video.removeAttribute('crossorigin');
      video.load();
      if (autoPlay) doPlay();
    } else {
      // Non-HLS direct URL (MP4, WebM, etc.)
      video.src = streamUrl;
      video.muted = true;
      video.playsInline = true;
      video.removeAttribute('crossorigin');
      video.load();
      if (autoPlay) doPlay();
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setStatus('loading');
    setErrorMsg('');
    retriedWithProxy.current = false;

    loadStream(url, video);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.src = '';
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync muted state whenever it changes — regardless of play status
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

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
