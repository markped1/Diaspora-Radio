/**
 * IptvPlayer — plays M3U8/HLS streams using the native HTML5 video element.
 *
 * Works on:
 *   ✅ Chrome/Edge (desktop & Android) — native HLS via MediaSource Extensions
 *   ✅ Safari/iOS — native HLS support
 *   ✅ Capacitor Android WebView (Android 5+)
 *   ✅ Capacitor iOS WebView
 *
 * CORS note: If a stream fails to load, the server is blocking cross-origin
 * requests. Use the Test button in admin before pushing live.
 */

import React, { useRef, useEffect, useState } from 'react';

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
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setStatus('loading');
    setErrorMsg('');

    video.src = url;
    video.muted = muted;
    video.load();

    if (autoPlay) {
      video.play().catch(err => {
        console.warn('IPTV autoplay blocked:', err.message);
      });
    }

    return () => {
      video.pause();
      video.src = '';
      video.load();
    };
  }, [url]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        className={className}
        muted={muted}
        autoPlay={autoPlay}
        playsInline
        controls={false}
        onPlaying={() => { setStatus('playing'); onPlaying?.(); }}
        onWaiting={() => setStatus('loading')}
        onError={() => {
          setStatus('error');
          setErrorMsg('Stream unavailable or CORS blocked');
          onError?.();
        }}
      />

      {/* Loading overlay */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 space-y-2">
          <i className="fas fa-circle-notch fa-spin text-white text-xl"></i>
          <span className="text-[7px] font-black text-white uppercase tracking-widest">Connecting to stream...</span>
        </div>
      )}

      {/* Error overlay */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 space-y-2 px-4">
          <i className="fas fa-exclamation-triangle text-red-400 text-xl"></i>
          <span className="text-[7px] font-black text-red-300 uppercase tracking-widest text-center">
            {errorMsg || 'Stream failed'}
          </span>
          <span className="text-[6px] text-gray-500 text-center">
            This stream may be offline or CORS-blocked. Try another channel.
          </span>
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
