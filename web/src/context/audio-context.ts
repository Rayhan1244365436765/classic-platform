import { createContext, useContext } from 'react';

/** Background-music controls exposed by `AudioProvider`. */
export type AudioContextValue = {
  /** Start (or switch) the looping background track. */
  playBgTrack: (src: string, options?: { loop?: boolean; volume?: number }) => void;
  /** Stop and clear the background track. */
  stopBgTrack: () => void;
};

export const GameAudioContext = createContext<AudioContextValue | null>(null);

export function useAudio(): AudioContextValue {
  const ctx = useContext(GameAudioContext);
  if (!ctx) {
    throw new Error('useAudio must be used within an <AudioProvider>');
  }
  return ctx;
}