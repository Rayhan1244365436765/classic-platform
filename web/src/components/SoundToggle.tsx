import { useEffect, useState } from 'react';

import { isMuted, playSound, setMuted, subscribeMuted } from '../utils/sound';

/**
 * Speaker button for the top bar. Reads the `localStorage` preference through
 * the sound utility, so every instance stays in sync.
 */
export function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted());

  useEffect(() => subscribeMuted(setMutedState), []);

  return (
    <button
      type="button"
      className={`sound-toggle${muted ? ' sound-toggle--off' : ''}`}
      onClick={() => {
        const next = !muted;
        setMuted(next);
        // Unmuting should be audible straight away; muting is silent by design.
        if (!next) {
          playSound('click');
        }
      }}
      aria-pressed={muted}
      aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      title={muted ? 'Sound off — click to enable' : 'Sound on — click to mute'}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}

export default SoundToggle;
