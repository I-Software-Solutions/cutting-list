import { Play, Pause, SkipBack, SkipForward, RotateCcw, Gauge } from 'lucide-react';
import type { GuillotineCutStep } from '../types';
import type { Units } from '../lib/units';
import { formatValue } from '../lib/units';

interface Props {
  sequence: GuillotineCutStep[];
  units: Units;
  currentIndex: number;
  isPlaying: boolean;
  speedMs: number;
  setSpeedMs: (speed: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  restart: () => void;
  setCurrentIndex: (index: number) => void;
}

export function CutPlaybackPanel({
  sequence,
  units,
  currentIndex,
  isPlaying,
  speedMs,
  setSpeedMs,
  togglePlay,
  next,
  prev,
  restart,
  setCurrentIndex
}: Props) {
  const ul = units === 'metric' ? 'mm' : 'in';

  if (!sequence || sequence.length === 0) {
    return (
      <div className="flex flex-col h-full bg-muted/30 border border-border rounded-md p-4 items-center justify-center text-muted-foreground text-sm">
        No straight cuts required.
      </div>
    );
  }

  const speedOptions = [
    { label: 'Slow', value: 2500 },
    { label: 'Normal', value: 1500 },
    { label: 'Fast', value: 750 }
  ];

  const cycleSpeed = () => {
    const currentIdx = speedOptions.findIndex(o => o.value === speedMs);
    const nextIdx = (currentIdx + 1) % speedOptions.length;
    setSpeedMs(speedOptions[nextIdx].value);
  };

  const currentSpeedLabel = speedOptions.find(o => o.value === speedMs)?.label || 'Normal';
  const instruction = (cut: GuillotineCutStep) => cut.orientation === 'vertical'
    ? `Vertical at ${formatValue(cut.x, units, 0)} ${ul}, from ${formatValue(cut.y, units, 0)} to ${formatValue(cut.y2, units, 0)} ${ul}`
    : `Horizontal at ${formatValue(cut.y, units, 0)} ${ul}, from ${formatValue(cut.x, units, 0)} to ${formatValue(cut.x2, units, 0)} ${ul}`;

  return (
    <div className="flex flex-col h-[380px] bg-card border border-border rounded-md overflow-hidden flex-1 min-w-[280px]">
      <div className="p-3 border-b border-border bg-muted/40 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Cut Sequence</h3>
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
          <span aria-live="polite">
            {currentIndex < 0 ? 'Ready' : `${currentIndex + 1} / ${sequence.length}`}
          </span>
        </span>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1">
        {sequence.map((cut, idx) => {
          const isActive = idx === currentIndex;
          const isPast = idx < currentIndex;
          const isPending = idx > currentIndex;

          return (
            <button
              key={idx}
              onClick={() => {
                // If they click a step, pause playback and jump there
                if (isPlaying) togglePlay();
                setCurrentIndex(idx);
              }}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex gap-3 ${
                isActive 
                  ? 'bg-primary text-primary-foreground font-medium' 
                  : isPast 
                    ? 'text-muted-foreground hover:bg-muted' 
                    : 'text-foreground hover:bg-muted'
              }`}
            >
              <span className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs ${
                isActive 
                  ? 'bg-primary-foreground/20 text-primary-foreground' 
                  : isPast
                    ? 'bg-muted-foreground/20 text-muted-foreground'
                    : 'bg-muted border border-border text-muted-foreground'
              }`}>
                {cut.number}
              </span>
              <span className="flex-1 leading-snug">
                {instruction(cut)}
                <span className={`ml-2 text-xs opacity-80 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
                  Span {formatValue(cut.span, units, 0)} {ul}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t border-border bg-muted/20 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={restart}
              disabled={currentIndex === -1}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title="Restart"
              aria-label="Restart cut sequence"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={prev}
              disabled={currentIndex <= -1}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title="Previous Step"
              aria-label="Show previous cut"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            
            <button
              onClick={togglePlay}
              className={`p-1.5 rounded-md transition-colors ${
                isPlaying 
                  ? 'bg-primary/20 text-primary hover:bg-primary/30' 
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause cut sequence' : 'Play cut sequence'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>

            <button
              onClick={next}
              disabled={currentIndex >= sequence.length - 1}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title="Next Step"
              aria-label="Show next cut"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={cycleSpeed}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
            title="Change Speed"
            aria-label={`Playback speed: ${currentSpeedLabel}. Change speed`}
          >
            <Gauge className="w-3.5 h-3.5" />
            {currentSpeedLabel}
          </button>
        </div>
        
        {/* Progress bar */}
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-300 ease-out"
            style={{ 
              width: currentIndex === -1 
                ? '0%' 
                : `${((currentIndex + 1) / sequence.length) * 100}%` 
            }}
          />
        </div>
      </div>
    </div>
  );
}