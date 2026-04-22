import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  variant?: 'default' | 'nigerian' | 'strand' | 'sides';
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ analyser, isActive, variant = 'default' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!canvasRef.current || !isActive) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser ? analyser.frequencyBinCount : (variant === 'sides' ? 32 : 128);
    const dataArray = new Uint8Array(bufferLength);
    
    // Smooth targets for fake visualizer
    const targetValues = new Float32Array(bufferLength);
    const currentValues = new Float32Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      
      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // Generate smooth fake data
        for (let i = 0; i < bufferLength; i++) {
          if (Math.random() > 0.8) {
            // Bass frequencies (lower index) get higher values
            const isBass = i < bufferLength * 0.3;
            const max = isBass ? 255 : 180;
            const min = isBass ? 100 : 20;
            targetValues[i] = min + Math.random() * (max - min);
          } else if (Math.random() > 0.95) {
            targetValues[i] = 0; // Occasional drop to 0
          }
          // Ease current towards target
          currentValues[i] += (targetValues[i] - currentValues[i]) * 0.2;
          dataArray[i] = currentValues[i];
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (variant === 'sides') {
        const barCount = 12;
        const barWidth = canvas.width / barCount - 2;
        const spacing = 2;
        
        for (let i = 0; i < barCount; i++) {
          const index = Math.floor((i / barCount) * (bufferLength / 2));
          const barHeight = (dataArray[index] / 255) * canvas.height * 0.9;
          const y = (canvas.height - barHeight) / 2;
          const x = i * (barWidth + spacing);

          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.beginPath();
          // Compatibility check for roundRect
          if ((ctx as any).roundRect) {
            (ctx as any).roundRect(x, y, barWidth, barHeight, 2);
          } else {
            ctx.rect(x, y, barWidth, barHeight);
          }
          ctx.fill();
        }
      } else {
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * canvas.height;
          ctx.fillStyle = variant === 'nigerian' ? (i % 3 === 0 ? '#008751' : '#ffffff') : '#008751';
          ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
          x += barWidth + 1;
        }
      }
    };

    draw();
    return () => cancelAnimationFrame(animationRef.current);
  }, [analyser, isActive, variant]);

  return <canvas ref={canvasRef} width={variant === 'sides' ? 120 : 400} height={variant === 'sides' ? 100 : 240} className="w-full h-full" />;
};

export default AudioVisualizer;