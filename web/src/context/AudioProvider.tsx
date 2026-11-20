import { useMemo, type ReactNode } from 'react';

import { playBgTrack, stopBgTrack } from '../utils/bgm';
import { GameAudioContext, type AudioContextValue } from './audio-context';

/**
 * Global background-music provider.
 *
 * Exposes the BGM controls from `utils/bgm.ts` through React context. The
 * engine (the looping `<audio>` element, mute handling and autoplay unlock)
 * lives outside React in `utils/bgm.ts`, so this stays a thin, stable seam for
 * `useAudio()`.
 */
export function AudioProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AudioContextValue>(() => ({ playBgTrack, stopBgTrack }), []);

  return <GameAudioContext.Provider value={value}>{children}</GameAudioContext.Provider>;
}