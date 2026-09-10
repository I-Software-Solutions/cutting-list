import { useState, useEffect, useCallback, useRef } from 'react';
import type { GuillotineCutStep } from '../types';

export function useCutPlayback(sequence: GuillotineCutStep[]) {
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(1500);

  const reset = useCallback(() => {
    setCurrentIndex(-1);
    setIsPlaying(false);
  }, []);

  // Reset when sequence changes
  const sequenceRef = useRef(sequence);
  useEffect(() => {
    if (sequenceRef.current !== sequence) {
      sequenceRef.current = sequence;
      reset();
    }
  }, [sequence, reset]);

  // Handle playback timer
  useEffect(() => {
    if (!isPlaying) return;

    if (sequence.length === 0) {
      setIsPlaying(false);
      return;
    }
    if (currentIndex >= sequence.length - 1) {
      setIsPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setCurrentIndex((prev) => {
        return Math.min(prev + 1, sequence.length - 1);
      });
    }, speedMs);

    return () => window.clearTimeout(timer);
  }, [isPlaying, sequence.length, speedMs, currentIndex]);

  const togglePlay = () => {
    if (sequence.length === 0) return;
    
    if (currentIndex >= sequence.length - 1 && !isPlaying) {
      // Restart and play
      setCurrentIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const next = () => {
    setIsPlaying(false);
    if (currentIndex < sequence.length - 1) setCurrentIndex((c) => c + 1);
  };

  const prev = () => {
    setIsPlaying(false);
    if (currentIndex > -1) setCurrentIndex((c) => c - 1);
  };

  const restart = () => {
    setIsPlaying(false);
    setCurrentIndex(-1);
  };

  return {
    currentIndex,
    isPlaying,
    speedMs,
    setSpeedMs,
    togglePlay,
    next,
    prev,
    restart,
    setCurrentIndex
  };
}