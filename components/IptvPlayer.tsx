/**
 * IptvPlayer — plays M3U8/HLS streams using hls.js (Firefox/Chrome/Edge)
 * or native HLS (Safari/iOS).
 *
 * hls.js handles CORS-friendly streams on all browsers.
 * CORS-blocked streams will still fail — use Test button before pushing live.
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
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading');
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

    if (isHls && Hls.isSupported()) {
      // Use hls.js on ALL browsers that support it (Chrome, Firefox, Edge)
      // This gives consistent behaviour and avoids Chrome's native HLS CORS issues
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hlsRef.current = hls;

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.muted = muted;
        if (autoPlay) {
          // Must be muted for autoplay to work on Chrome without user gesture
          video.muted = true;
          video.play().catch(err => {
            console.warn('HLS autoplay blocked:', err.message);
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setStatus('error');
          setErrorMsg('Stream unavailable or CORS blocked');
          onError?.();
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari / iOS — native HLS
      video.src = url;
      video.muted = muted;
      video.load();
      if (autoPlay) {
        video.play().catch(err => {
          console.warn('Native HLS autoplay blocked:', err.message);
        });
      }
    } else {
      // Non-HLS URL (mp4, etc) — direct src
      video.src = url;
      video.muted = muted;
      video.load();
      if (autoPlay) {
        video.play().catch(err => {
          console.warn('Direct autoplay blocked:', err.message);
        });
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
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
        playsInline
        controls={false}
        onPlaying={() => { setStatus('playing'); onPlaying?.(); }}
        onWaiting={() => setStatus('loading')}
        onError={() => {
          // Only show error if hls.js isn't handling it
          if (!hlsRef.current) {
            setStatus('error');
            setErrorMsg('Stream unavailable or CORS blocked');
            onError?.();
          }
        }}
      />

      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 space-y-2">
          <i className="fas fa-circle-notch fa-spin text-white text-xl"></i>
          <span className="text-[7px] font-black text-white uppercase tracking-widest">Connecting to stream...</span>
        </div>
      )}

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
