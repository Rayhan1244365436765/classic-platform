import { useEffect } from 'react';

import { useAudio } from '../context/audio-context';

/**
 * Plays a looping background track while the calling game page is mounted.
 *
 * The track starts on arrival and stops on leave. The shared BGM engine
 * (`utils/bgm.ts`) follows the global mute toggle, so 🔊/🔇 silences it too, and
 * it retries on the first click if the browser blocked autoplay.
 *
 * @param src    public URL of the track, e.g. `/audio/cards-bgm.mp3`
 * @param volume 0–1 (default 0.4)
 */
export function useGameMusic(src: string, volume = 0.4): void {
  const { playBgTrack, stopBgTrack } = useAudio();

  useEffect(() => {
    playBgTrack(src, { loop: true, volume });
    return () => stopBgTrack();
  }, [playBgTrack, stopBgTrack, src, volume]);
}
