import { z } from 'zod';

/** Largest multiplier an admin may type — a guard against a stray extra zero. */
export const MAX_PAY = 100_000;

export const pay = z.number().nonnegative().max(MAX_PAY);
export const posPay = z.number().positive().max(MAX_PAY);

/** One RTP figure with a label, e.g. `{ label: 'Banker', rtp: 0.9894 }`. */
export type RtpLine = { label: string; rtp: number };

/** How the admin form renders one editable value of a game's config. */
export type FieldSpec = {
  key: string;
  label: string;
  /** `number` → one input; `numberList` → comma-separated; `json` → textarea. */
  kind: 'number' | 'numberList' | 'json';
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Exact list length (numberList). */
  length?: number;
  /** Optional fields may be left empty (the built-in value is used). */
  optional?: boolean;
};

export type RtpResult = {
  /** One entry per bet / pick count. The headline RTP is the highest of them. */
  lines: RtpLine[];
  /** Shown under the figures when RTP cannot be fully computed. */
  note?: string;
};

export type GameDef<C> = {
  id: string;
  label: string;
  description: string;
  schema: z.ZodType<C>;
  /** The built-in table (what the game runs on without a database row). */
  defaults: () => C;
  fields: FieldSpec[];
  rtp: (config: C) => RtpResult;
};

export type Evaluation = {
  config: unknown;
  lines: RtpLine[];
  /** Highest line, or `null` when the game has no computable RTP. */
  rtp: number | null;
  note: string | null;
};

export type GameEntry = {
  id: string;
  label: string;
  description: string;
  fields: FieldSpec[];
  defaults: () => unknown;
  /** Parses + evaluates a raw config; throws a ZodError when it is malformed. */
  evaluate: (raw: unknown) => Evaluation;
};

/** Erases the config type so every game can live in one registry. */
export function defineGame<C>(def: GameDef<C>): GameEntry {
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    fields: def.fields,
    defaults: def.defaults,
    evaluate(raw: unknown): Evaluation {
      const config = def.schema.parse(raw);
      const { lines, note } = def.rtp(config);
      const rtp = lines.length > 0 ? Math.max(...lines.map((line) => line.rtp)) : null;

      return { config, lines, rtp, note: note ?? null };
    },
  };
}
