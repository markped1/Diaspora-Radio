
import React, { useRef, useEffect, useState } from 'react';
import { MediaFile } from '../types';

interface SponsoredVideoProps {
  video: MediaFile;
  onEnded?: () => void;
}

const SponsoredVideo: React.FC<SponsoredVideoProps> = ({ video, onEnded }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.play().catch(error => {
        console.debug("Autoplay suppressed by browser policy", error);
      });
    }
  }, [video.url, isMuted]);

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMuted(!isMuted);
  };

  return (
    <div style={{ borderRadius: 0 }} className="overflow-hidden group shadow-lg border border-green-100/30 w-full h-full bg-black relative flex items-center justify-center">
      {/* Video with object-contain to ensure it fits the frame perfectly without cropping */}
      {/* Removed loop to allow onEnded to fire after one full playback */}
      <video 
        ref={videoRef}
        src={video.url} 
        className="max-w-full max-h-full object-contain"
        muted={isMuted}
        autoPlay
        playsInline
        onEnded={onEnded}
      />
      
      {/* Subtle Broadcast Indicator */}
      <div className="absolute top-2 left-2 bg-black/40 backdrop-blur-md px-2 py-0.5 rounded-full text-[5px] font-black text-white uppercase tracking-widest border border-white/10 flex items-center">
        <span className="w-1 h-1 bg-red-500 rounded-full mr-1 animate-pulse"></span>
        SPONSORED
      </div>

      {/* Volume Control Button - Always visible, muted by default */}
      <button 
        onClick={toggleMute}
        className="absolute bottom-3 right-3 z-30 w-8 h-8 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white flex items-center justify-center hover:bg-black/80 transition-all active:scale-90"
      >
        <i className={`fas ${isMuted ? 'fa-volume-mute' : 'fa-volume-up'} text-[10px]`}></i>
      </button>

      {/* Branding Overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-transparent to-transparent p-4 h-1/3 flex items-end pointer-events-none">
         <div className="flex items-center justify-between w-full pr-10">
           <div className="flex flex-col">
             <span className="text-[7px] font-black text-white uppercase tracking-[0.2em]">Verified Sponsor</span>
             <span className="text-[5px] text-white/50 uppercase font-bold tracking-widest">Global Diaspora Network</span>
           </div>
         </div>
      </div>
    </div>
  );
};

export default SponsoredVideo;
