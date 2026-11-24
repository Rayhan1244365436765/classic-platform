import { z } from 'zod';

import { CLUSTER_PAYS, boxingKingRtp } from '../game/boxing_king/boxing_king.service.js';
import { CASCADE_RTP } from '../game/cascade/cascade.service.js';
import { HIGH_LOW_PAY, ROLL_OUTCOMES, SUM_COMBOS, SUM_PAYS, type Dice3dGameConfig } from '../game/dice3d/dice3d.service.js';
import { FORTUNE_PAYS, fortuneGemsRtp } from '../game/fortune_gems/fortune_gems.service.js';
import { FRUIT_PAYS, fruitBonanzaRtp } from '../game/fruit_bonanza/fruit_bonanza.service.js';
import { defineGame, pay, type GameEntry } from './config.types.js';

const SUM_KEYS = Object.keys(SUM_COMBOS);

export const CLUSTER_GAMES: GameEntry[] = [
  defineGame({
    id: 'cascade',
    label: 'Showdown',
    description: 'Cascading cluster-pays slot. One scale factor multiplies every pay in the table.',
    schema: z.object({ payScale: z.number().gt(0).max(2) }).strict(),
    defaults: () => ({ payScale: 1 }),
    fields: [{ key: 'payScale', label: 'Pay scale', kind: 'number', min: 0.01, max: 2, step: 0.01, help: '1 = the built-in table. 0.9 pays 10% less on every cluster.' }],
    rtp: (config) => ({
      lines: [{ label: 'Whole game', rtp: CASCADE_RTP * config.payScale }],
      note: 'The built-in table was measured by simulation at 95.72% RTP; RTP scales linearly with the pays, so this is 95.72% × scale.',
    }),
  }),
  defineGame({
    id: 'fortune_gems',
    label: 'Fortune Gems',
    description: 'Cluster pays by size: 4–5, 6–7, 8–9 and 10+ symbols.',
    schema: z.object({ small: pay, medium: pay, large: pay, huge: pay }).strict(),
    defaults: () => ({ ...FORTUNE_PAYS }),
    fields: [
      { key: 'small', label: '4–5 symbols pay', kind: 'number', min: 0, step: 0.5 },
      { key: 'medium', label: '6–7 symbols pay', kind: 'number', min: 0, step: 0.5 },
      { key: 'large', label: '8–9 symbols pay', kind: 'number', min: 0, step: 0.5 },
      { key: 'huge', label: '10+ symbols pay', kind: 'number', min: 0, step: 1 },
    ],
    rtp: (config) => ({
      lines: [{ label: 'Whole game', rtp: fortuneGemsRtp(config) }],
      note: 'Uses cluster frequencies measured over 4,000,000 boards.',
    }),
  }),
  defineGame({
    id: 'boxing_king',
    label: 'Boxing King',
    description: 'Cluster pays by size: 3–4, 5–6 and 7+ symbols.',
    schema: z.object({ small: pay, medium: pay, large: pay }).strict(),
    defaults: () => ({ ...CLUSTER_PAYS }),
    fields: [
      { key: 'small', label: '3–4 symbols pay', kind: 'number', min: 0, step: 0.1 },
      { key: 'medium', label: '5–6 symbols pay', kind: 'number', min: 0, step: 0.1 },
      { key: 'large', label: '7+ symbols pay', kind: 'number', min: 0, step: 0.5 },
    ],
    rtp: (config) => ({
      lines: [{ label: 'Whole game', rtp: boxingKingRtp(config) }],
      note: 'Exact: frequencies were counted over all 10,077,696 boards.',
    }),
  }),
  defineGame({
    id: 'fruit_bonanza',
    label: 'Fruit Bonanza',
    description: 'Five paylines; each pays a multiple of its own line stake.',
    schema: z.object({ three: pay, two: pay }).strict(),
    defaults: () => ({ ...FRUIT_PAYS }),
    fields: [
      { key: 'three', label: 'Three of a kind pays', kind: 'number', min: 0, step: 0.1 },
      { key: 'two', label: 'Two of a kind pays', kind: 'number', min: 0, step: 0.05 },
    ],
    rtp: (config) => ({ lines: [{ label: 'Whole game', rtp: fruitBonanzaRtp(config) }] }),
  }),
  defineGame<Dice3dGameConfig>({
    id: 'dice3d',
    label: '3D Dice',
    description: 'High/Low pay, plus a pay for each exact total from 3 to 18.',
    schema: z
      .object({ highLowPay: pay, sumPays: z.record(z.string(), pay) })
      .strict()
      .superRefine((config, ctx) => {
        for (const key of SUM_KEYS) {
          if (!(key in config.sumPays)) {
            ctx.addIssue({ code: 'custom', message: `sumPays: missing the pay for total ${key}` });
          }
        }
        for (const key of Object.keys(config.sumPays)) {
          if (!SUM_KEYS.includes(key)) {
            ctx.addIssue({ code: 'custom', message: `sumPays: "${key}" is not a total (3–18)` });
          }
        }
      }),
    defaults: () => ({ highLowPay: HIGH_LOW_PAY, sumPays: Object.fromEntries(Object.entries(SUM_PAYS).map(([sum, value]) => [sum, value])) }),
    fields: [
      { key: 'highLowPay', label: 'High / Low pays', kind: 'number', min: 0, step: 0.05, help: 'Default 2. A triple loses both.' },
      { key: 'sumPays', label: 'Pay per exact total (JSON, totals 3–18)', kind: 'json', help: 'e.g. {"3": 210, "4": 70, …} — all 16 totals are required.' },
    ],
    rtp: (config) => ({
      lines: [
        { label: 'High / Low', rtp: ((108 - 3) * config.highLowPay) / ROLL_OUTCOMES },
        ...SUM_KEYS.map((key) => ({
          label: `Total ${key}`,
          rtp: (SUM_COMBOS[Number(key)]! * config.sumPays[key]!) / ROLL_OUTCOMES,
        })),
      ],
    }),
  }),
];
