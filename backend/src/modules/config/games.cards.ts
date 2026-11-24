import { z } from 'zod';

import { BACCARAT_PAYOUTS, baccaratRtp } from '../game/baccarat/baccarat.service.js';
import { WIN_MULTIPLIER as BLACKJACK_WIN } from '../game/blackjack/blackjack.service.js';
import { DRAGON_TIGER_PAYOUTS, dragonTigerRtp } from '../game/dragontiger/dragontiger.service.js';
import { TEEN_PATTI_RAKE, teenPattiRtpForRake } from '../game/teenpatti/teenpatti.service.js';
import { defineGame, posPay, type GameEntry } from './config.types.js';

export const CARD_GAMES: GameEntry[] = [
  defineGame({
    id: 'baccarat',
    label: 'Baccarat',
    description: 'Total return per unit staked on each bet (a Player/Banker push on a tie returns the stake).',
    schema: z.object({ player: posPay, banker: posPay, tie: posPay }).strict(),
    defaults: () => ({ ...BACCARAT_PAYOUTS }),
    fields: [
      { key: 'player', label: 'Player pays', kind: 'number', min: 0, step: 0.01, help: 'Default 2.' },
      { key: 'banker', label: 'Banker pays', kind: 'number', min: 0, step: 0.01, help: 'Default 1.95 (2× less 5% commission).' },
      { key: 'tie', label: 'Tie pays', kind: 'number', min: 0, step: 0.1, help: 'Default 8.' },
    ],
    rtp: (config) => {
      const rtp = baccaratRtp(config);
      return {
        lines: [
          { label: 'Player', rtp: rtp.player },
          { label: 'Banker', rtp: rtp.banker },
          { label: 'Tie', rtp: rtp.tie },
        ],
      };
    },
  }),
  defineGame({
    id: 'blackjack',
    label: 'Blackjack',
    description: 'Single deck, dealer stands on 17. A win pays the stake times this multiplier.',
    schema: z.object({ winMultiplier: z.number().min(1).max(2.1) }).strict(),
    defaults: () => ({ winMultiplier: BLACKJACK_WIN }),
    fields: [{ key: 'winMultiplier', label: 'Win multiplier', kind: 'number', min: 1, max: 2.1, step: 0.05, help: '2 = even money (default). Allowed range 1–2.1.' }],
    rtp: () => ({
      lines: [],
      note: 'RTP depends on how players play, so it cannot be calculated here. The range is capped at 2.1× so a typo cannot make the table player-favoured by a wide margin.',
    }),
  }),
  defineGame({
    id: 'dragontiger',
    label: 'Dragon Tiger',
    description: 'Total return per unit staked. A tie loses Dragon and Tiger bets.',
    schema: z.object({ dragon: posPay, tiger: posPay, tie: posPay }).strict(),
    defaults: () => ({ ...DRAGON_TIGER_PAYOUTS }),
    fields: [
      { key: 'dragon', label: 'Dragon pays', kind: 'number', min: 0, step: 0.01, help: 'Default 2.' },
      { key: 'tiger', label: 'Tiger pays', kind: 'number', min: 0, step: 0.01, help: 'Default 2.' },
      { key: 'tie', label: 'Tie pays', kind: 'number', min: 0, step: 0.1, help: 'Default 8.' },
    ],
    rtp: (config) => {
      const rtp = dragonTigerRtp(undefined, config);
      return {
        lines: [
          { label: 'Dragon', rtp: rtp.dragon },
          { label: 'Tiger', rtp: rtp.tiger },
          { label: 'Tie', rtp: rtp.tie },
        ],
      };
    },
  }),
  defineGame({
    id: 'teenpatti',
    label: 'Teen Patti',
    description: 'A win pays 2× less the rake on the profit; a tie refunds the stake.',
    schema: z.object({ rake: z.number().min(0).max(0.5) }).strict(),
    defaults: () => ({ rake: TEEN_PATTI_RAKE }),
    fields: [{ key: 'rake', label: 'Rake', kind: 'number', min: 0, max: 0.5, step: 0.01, help: '0.05 = a win pays 1.95×. 0 = a literal 2× (RTP 100%).' }],
    rtp: (config) => ({ lines: [{ label: 'Player', rtp: teenPattiRtpForRake(config.rake) }] }),
  }),
];
