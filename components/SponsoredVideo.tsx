
import React, { useRef, useEffect, useState } from 'react';
import { MediaFile } from '../types';

interface SponsoredVideoProps {
  video: MediaFile;
  onEnded?: () => void;
  isMutedByRadio?: boolean; // true = radio is playing, keep TV audio off
}

const SponsoredVideo: React.FC<SponsoredVideoProps> = ({ video, onEnded, isMutedByRadio = true }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Always start muted; user can unmute only if radio is not playing
  const [userWantsAudio, setUserWantsAudio] = useState(false);

  // Effective mute = muted by radio OR user hasn't turned audio on
  const effectiveMuted = isMutedByRadio || !userWantsAudio;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = effectiveMuted;
      videoRef.current.play().catch(err => {
        console.debug('Autoplay suppressed:', err);
      });
    }
  }, [video.url]);

  // Sync mute state when radio starts/stops
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = effectiveMuted;
    }
    // If radio takes over, reset user preference so it starts muted next time
    if (isMutedByRadio) setUserWantsAudio(false);
  }, [effectiveMuted, isMutedByRadio]);

  return (
    <div style={{ borderRadius: 0 }} className="overflow-hidden group shadow-lg border border-green-100/30 w-full h-full bg-black relative flex items-center justify-center">
      <video
        ref={videoRef}
        src={video.url}
        className="max-w-full max-h-full object-contain"
        muted={effectiveMuted}
        autoPlay
        playsInline
        onEnded={onEnded}
      />

      {/* Broadcast indicator */}
      <div className="absolute top-2 left-2 bg-black/40 backdrop-blur-md px-2 py-0.5 rounded-full text-[5px] font-black text-white uppercase tracking-widest border border-white/10 flex items-center">
        <span className="w-1 h-1 bg-red-500 rounded-full mr-1 animate-pulse"></span>
        SPONSORED
      </div>

      {/* Radio-muted indicator */}
      {isMutedByRadio && (
        <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-md px-2 py-0.5 rounded-full text-[5px] font-black text-amber-300 uppercase tracking-widest border border-amber-400/30 flex items-center space-x-1">
          <i className="fas fa-radio text-[7px]"></i>
          <span>Radio Active</span>
        </div>
      )}

      {/* Branding overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-transparent to-transparent p-4 h-1/3 flex items-end pointer-events-none">
        <div className="flex flex-col">
          <span className="text-[7px] font-black text-white uppercase tracking-[0.2em]">Verified Sponsor</span>
          <span className="text-[5px] text-white/50 uppercase font-bold tracking-widest">Global Diaspora Network</span>
        </div>
      </div>
    </div>
  );
};

export default SponsoredVideo;
