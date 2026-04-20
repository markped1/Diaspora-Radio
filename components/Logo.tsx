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
  return (
    <div className={`w-full relative overflow-hidden bg-white transition-all duration-500 ${isJingle ? 'ring-2 ring-amber-400' : ''}`}
      style={{ height: size === 'lg' ? '140px' : size === 'sm' ? '80px' : '110px' }}>
      {/* Nigerian Flag Stripes */}
      <div className="absolute inset-0 flex pointer-events-none">
        <div className="flex-1 bg-[#008751]"></div>
        <div className="flex-1 bg-white"></div>
        <div className="flex-1 bg-[#008751]"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex items-center justify-between h-full px-4">
        {/* Left visualizer */}
        <div className={`transition-opacity duration-700 ${isPlaying ? 'opacity-100' : 'opacity-20'}`} style={{ width: '60px', height: '80px' }}>
          <AudioVisualizer analyser={analyser || null} isActive={isPlaying} variant="sides" />
        </div>

        {/* Center branding */}
        <div className={`flex flex-col items-center justify-center px-4 py-2 rounded-2xl shadow-lg transition-colors duration-500 ${isJingle ? 'bg-amber-50/80 border-2 border-amber-400' : 'bg-white/50 backdrop-blur-sm border border-white/60'}`}>
          <div className={`text-3xl font-black tracking-tighter leading-none ${isJingle ? 'text-amber-700' : 'text-[#008751]'}`}>NDR</div>
          <div className={`text-[10px] font-black tracking-widest uppercase ${isJingle ? 'text-amber-600' : 'text-green-700'}`}>RadioTv</div>
          <div className={`text-[7px] font-bold uppercase tracking-widest mt-0.5 ${isJingle ? 'text-amber-500' : 'text-black/60'}`}>{STATION_TAGLINE}</div>
        </div>

        {/* Right visualizer */}
        <div className={`transition-opacity duration-700 transform scale-x-[-1] ${isPlaying ? 'opacity-100' : 'opacity-20'}`} style={{ width: '60px', height: '80px' }}>
          <AudioVisualizer analyser={analyser || null} isActive={isPlaying} variant="sides" />
        </div>
      </div>
    </div>
  );
};

export default Logo;