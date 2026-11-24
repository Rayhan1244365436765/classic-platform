import { z } from 'zod';

import { CRASH_RETURN_FACTOR } from '../game/aviator/aviator.service.js';
import { DICE_PAYTABLE, diceRtp } from '../game/dice/dice.service.js';
import {
  KENO_MAX_PICKS,
  KENO_TARGET_RTP,
  kenoTablesFor,
  type KenoGameConfig,
} from '../game/keno/keno.service.js';
import { HOUSE_EDGE } from '../game/mines/mines.service.js';
import { PLINKO_MULTIPLIERS, PLINKO_SLOTS, plinkoRtp } from '../game/plinko/plinko.service.js';
import { WHEEL_SEGMENTS } from '../game/roulette/roulette.service.js';
import { SLOT_PAYTABLE } from '../game/slots/slots.service.js';
import { defineGame, pay, posPay, type GameEntry } from './config.types.js';

const keno = defineGame<KenoGameConfig>({
  id: 'keno',
  label: 'Keno',
  description: 'Prize ladders for 1–10 picks. Either rebuild them to a target RTP, or type your own.',
  schema: z
    .object({
      targetRtp: z.number().gt(0).lte(1).optional(),
      payTables: z.record(z.string(), z.array(pay)).optional(),
    })
    .strict()
    .superRefine((config, ctx) => {
      for (const [key, ladder] of Object.entries(config.payTables ?? {})) {
        const picks = Number(key);
        const valid = Number.isInteger(picks) && picks >= 1 && picks <= KENO_MAX_PICKS;

        if (!valid) {
          ctx.addIssue({ code: 'custom', message: `payTables: "${key}" is not a pick count (1–${KENO_MAX_PICKS})` });
        } else if (ladder.length !== picks + 1) {
          ctx.addIssue({ code: 'custom', message: `payTables.${key}: needs ${picks + 1} values (0…${picks} catches)` });
        }
      }
    }),
  defaults: () => ({ targetRtp: KENO_TARGET_RTP }),
  fields: [
    { key: 'targetRtp', label: 'Target RTP for generated ladders', kind: 'number', min: 0.01, max: 1, step: 0.01, optional: true, help: '0.97 = 97%. Used for every pick count without a hand-written ladder.' },
    { key: 'payTables', label: 'Hand-written ladders (optional JSON)', kind: 'json', optional: true, help: 'e.g. {"2": [0, 0, 9]} — for N picks give N+1 values, index = catches.' },
  ],
  rtp: (config) => ({
    lines: kenoTablesFor(config).map((table) => ({
      label: `${table.picks} pick${table.picks === 1 ? '' : 's'}`,
      rtp: table.rtp,
    })),
  }),
});

export const CORE_GAMES: GameEntry[] = [
  defineGame({
    id: 'slots',
    label: 'Lucky Slots',
    description: 'Three paylines on a 3×3 grid.',
    schema: z.object({ lineMultiplier: posPay }).strict(),
    defaults: () => ({ lineMultiplier: SLOT_PAYTABLE.lineMultiplier }),
    fields: [{ key: 'lineMultiplier', label: 'Line multiplier', kind: 'number', min: 0, step: 0.1, help: 'RTP = line multiplier ÷ 12.' }],
    rtp: (config) => ({ lines: [{ label: 'All lines', rtp: config.lineMultiplier / 12 }] }),
  }),
  defineGame({
    id: 'roulette',
    label: 'Spin to Win',
    description: 'A 20-segment wheel; each segment pays a multiple of the stake.',
    schema: z.object({ segments: z.array(pay).length(20) }).strict(),
    defaults: () => ({ segments: [...WHEEL_SEGMENTS] }),
    fields: [{ key: 'segments', label: '20 segment multipliers', kind: 'numberList', length: 20, help: 'RTP = sum of segments ÷ 20.' }],
    rtp: (config) => ({
      lines: [{ label: 'Wheel', rtp: config.segments.reduce((sum, value) => sum + value, 0) / config.segments.length }],
    }),
  }),
  defineGame({
    id: 'aviator',
    label: 'Aviator',
    description: 'Crash game. The crash point is drawn when the round starts.',
    schema: z.object({ returnFactor: z.number().gt(0).lte(1) }).strict(),
    defaults: () => ({ returnFactor: CRASH_RETURN_FACTOR }),
    fields: [{ key: 'returnFactor', label: 'Return factor', kind: 'number', min: 0.01, max: 1, step: 0.01, help: '0.95 = 95% RTP at every cash-out target. Applies to rounds started after saving.' }],
    rtp: (config) => ({
      lines: [{ label: 'Any cash-out target', rtp: config.returnFactor }],
      note: 'Approximate: crash points are floored to 2 decimals and capped at 100×, which shaves a little off.',
    }),
  }),
  defineGame({
    id: 'dice',
    label: 'Dice (High/Low)',
    description: 'One roll of 1–100; 50 loses for both sides.',
    schema: z.object({ multiplier: posPay }).strict(),
    defaults: () => ({ multiplier: DICE_PAYTABLE.multiplier }),
    fields: [{ key: 'multiplier', label: 'Win multiplier', kind: 'number', min: 0, step: 0.01, help: 'Paid on a win, stake included.' }],
    rtp: (config) => ({
      lines: [
        { label: 'High (51–100)', rtp: diceRtp('high', config.multiplier) },
        { label: 'Low (1–49)', rtp: diceRtp('low', config.multiplier) },
      ],
    }),
  }),
  defineGame({
    id: 'mines',
    label: 'Mines',
    description: 'Fair multiplier table with a house edge baked in.',
    schema: z.object({ houseEdge: z.number().min(0).max(0.5) }).strict(),
    defaults: () => ({ houseEdge: HOUSE_EDGE }),
    fields: [{ key: 'houseEdge', label: 'House edge', kind: 'number', min: 0, max: 0.5, step: 0.01, help: '0.03 = 3%. Games already in progress keep paying on the new table from their next reveal.' }],
    rtp: (config) => ({
      lines: [{ label: 'Any mine count', rtp: 1 - config.houseEdge }],
      note: 'Multipliers are floored to 2 decimals, so the real RTP is a hair below this.',
    }),
  }),
  defineGame({
    id: 'plinko',
    label: 'Plinko',
    description: '8 rows, 9 slots. Each slot pays a multiple of the stake.',
    schema: z.object({ multipliers: z.array(pay).length(PLINKO_SLOTS) }).strict(),
    defaults: () => ({ multipliers: [...PLINKO_MULTIPLIERS] }),
    fields: [{ key: 'multipliers', label: '9 slot multipliers (left → right)', kind: 'numberList', length: PLINKO_SLOTS, help: 'Binomial odds: the middle slots are hit most often.' }],
    rtp: (config) => ({ lines: [{ label: 'Board', rtp: plinkoRtp(config.multipliers) }] }),
  }),
  keno,
];
