import { useEffect } from 'react';

import { useAudio } from '../context/audio-context';

/**
 * Global music level, applied on top of every game's own volume so the sound
 * effects sit clearly above the bed: a 0.4 track plays at 0.3, 0.25 at ~0.19.
 * Lower this one number to push all music further back.
 */
const MUSIC_LEVEL = 0.75;

/**
 * Plays a looping background track while the calling game page is mounted.
 *
 * The track starts on arrival and stops on leave. The shared BGM engine
 * (`utils/bgm.ts`) follows the global mute toggle, so 🔊/🔇 silences it too, and
 * it retries on the first click if the browser blocked autoplay.
 *
 * @param src    public URL of the track, e.g. `/audio/cards-bgm.mp3`
 * @param volume 0–1 (default 0.4), before the global `MUSIC_LEVEL` is applied
 */
export function useGameMusic(src: string, volume = 0.4): void {
  const { playBgTrack, stopBgTrack } = useAudio();

  useEffect(() => {
    playBgTrack(src, { loop: true, volume: volume * MUSIC_LEVEL });
    return () => stopBgTrack();
  }, [playBgTrack, stopBgTrack, src, volume]);
}
