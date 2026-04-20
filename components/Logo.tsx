import React from 'react';
import AudioVisualizer from './AudioVisualizer';
import { STATION_TAGLINE } from '../constants';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  analyser?: AnalyserNode | null;
  isPlaying?: boolean;
  isJingle?: boolean;
}

const Logo: React.FC<LogoProps> = ({ size = 'md', analyser, isPlaying = false, isJingle = false }) => {
  const scale = size === 'sm' ? 0.75 : size === 'md' ? 0.85 : 1.0;
  
  return (
    <div className={`flex flex-col items-center w-full overflow-hidden rounded-none shadow-xl bg-white aspect-square relative transition-all duration-500 ${isJingle ? 'ring-4 ring-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.4)]' : ''}`} style={{ transform: size !== 'lg' ? `scale(${scale})` : undefined }}>
      {/* Background: Nigerian Flag Stripes */}
      <div className="absolute inset-0 flex h-full w-full pointer-events-none">
        <div className="flex-1 bg-[#008751]"></div>
        <div className="flex-1 bg-white"></div>
        <div className="flex-1 bg-[#008751]"></div>
      </div>
      
      {/* Sun Flares / Ambient Light */}
      <div className={`absolute top-0 right-0 w-48 h-48 bg-yellow-200/10 blur-[80px] rounded-full transition-opacity duration-1000 ${isJingle ? 'opacity-100 animate-pulse' : 'opacity-30'}`}></div>

      {/* Main Content Area */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full w-full px-2">
        
        <div className="flex items-center justify-center space-x-2 w-full">
          {/* LEFT SIDE VISUALIZER WALL */}
          <div className={`w-16 h-24 transition-opacity duration-700 ${isPlaying ? 'opacity-100' : 'opacity-20'}`}>
            <AudioVisualizer analyser={analyser || null} isActive={isPlaying} variant="sides" />
          </div>

          {/* CENTRAL BOX FRAME */}
          <div className={`relative bg-white/40 backdrop-blur-md border-[2px] p-4 rounded-[25px] shadow-[0_10px_30px_rgba(0,0,0,0.1)] flex flex-col items-center justify-center min-w-[140px] min-h-[140px] transition-colors duration-500 ${isJingle ? 'border-amber-400 bg-amber-50/60' : 'border-white/60'}`}>
            <div className="text-center font-black leading-none drop-shadow-md">
              <div className={`text-4xl tracking-tighter drop-shadow-sm transition-colors ${isJingle ? 'text-amber-700' : 'text-[#008751]'}`}>
                NDR
              </div>
              <div className={`text-lg tracking-tighter mt-[-2px] uppercase transition-colors ${isJingle ? 'text-amber-600/80' : 'text-green-700/80'}`}>
                RadioTv
              </div>
            </div>
            {/* Gloss Overlay */}
            <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/30 to-transparent rounded-t-[25px]"></div>
          </div>

          {/* RIGHT SIDE VISUALIZER WALL */}
          <div className={`w-16 h-24 transition-opacity duration-700 ${isPlaying ? 'opacity-100' : 'opacity-20'} transform scale-x-[-1]`}>
            <AudioVisualizer analyser={analyser || null} isActive={isPlaying} variant="sides" />
          </div>
        </div>

        {/* TAGLINE - BLACK */}
        <div className="mt-6 text-center">
          <h2 className={`text-xl font-bold tracking-tight uppercase transition-colors duration-500 ${isJingle ? 'text-amber-900 scale-110' : 'text-black'}`}>
            {STATION_TAGLINE}
          </h2>
        </div>
      </div>
    </div>
  );
};

export default Logo;
