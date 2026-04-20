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
      
      // REMOVED crossOrigin: Many streams don't support CORS and Chrome blocks them if this is set
      video.removeAttribute('crossorigin');

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
              console.error('HLS Fatal Error:', data);
              setStatus('error');
              setErrorMsg('Stream unavailable or blocked');
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
      video.removeAttribute('crossorigin');
      video.load();
      if (autoPlay) doPlay();
    } else {
      // Non-HLS direct URL (MP4, WebM)
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

  // Sync muted state
  useEffect(() => {
    if (videoRef.current) {
      // Chrome requires muted=true to start. We unmute only if status is playing.
      videoRef.current.muted = status === 'playing' ? muted : true;
    }
  }, [muted, status]);

  const handleTapToPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.play().then(() => {
      setStatus('playing');
    }).catch(err => {
      console.warn('Manual play failed, retrying muted...', err);
      video.muted = true;
      video.play().then(() => setStatus('playing'));
    });
  };

  return (
    <div className="relative w-full h-full bg-black group overflow-hidden">
      <video
        ref={videoRef}
        className={className}
        muted={true} // Chrome mandatory
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

      {/* Modern Overlay for States */}
      {(status === 'blocked' || status === 'error' || status === 'loading') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-30 transition-all p-4">
          {status === 'loading' ? (
             <div className="flex flex-col items-center space-y-3">
               <i className="fas fa-circle-notch fa-spin text-green-500 text-3xl"></i>
               <span className="text-[10px] font-black text-white uppercase tracking-widest">Connecting...</span>
             </div>
          ) : (
            <div className="flex flex-col items-center space-y-4">
              <button 
                onClick={handleTapToPlay}
                className="w-20 h-20 rounded-full bg-green-600 text-white flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all outline-none border-4 border-white/20"
              >
                <i className={`fas ${status === 'error' ? 'fa-sync-alt' : 'fa-play'} text-3xl`}></i>
              </button>
              <div className="text-center">
                <p className="text-[12px] font-black text-white uppercase tracking-widest leading-none">
                  {status === 'error' ? 'Stream Error' : 'Tap to Watch Live'}
                </p>
                <p className="text-[8px] text-white/60 uppercase mt-1">NDR Diaspora Network</p>
                {status === 'error' && <p className="text-[7px] text-gray-500 mt-2">Check internet or try another channel</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live badge */}
      {status === 'playing' && (
        <div className="absolute top-3 left-3 bg-red-600 px-3 py-1 rounded-sm flex items-center space-x-1.5 shadow-lg border border-red-500">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
          <span className="text-[7px] font-black text-white uppercase tracking-widest">Live</span>
        </div>
      )}
    </div>
  );
};

export default IptvPlayer;
