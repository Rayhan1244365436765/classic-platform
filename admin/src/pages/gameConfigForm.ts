import type { FieldSpec } from '../api/types';

/** What the admin sees in each input — always plain strings, parsed on demand. */
export type FormValues = Record<string, string>;

export const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;

/** Config value → the text shown in its input. */
function toText(field: FieldSpec, value: unknown): string {
  if (value === undefined || value === null) return '';

  if (field.kind === 'number') return String(value);
  if (field.kind === 'numberList') return Array.isArray(value) ? value.join(', ') : '';

  return JSON.stringify(value, null, 2);
}

export function configToForm(fields: FieldSpec[], config: Record<string, unknown>): FormValues {
  return Object.fromEntries(fields.map((field) => [field.key, toText(field, config[field.key])]));
}

export type ParsedForm =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string };

/** Text inputs → a config object, or the first problem found (shown inline). */
export function formToConfig(fields: FieldSpec[], values: FormValues): ParsedForm {
  const config: Record<string, unknown> = {};

  for (const field of fields) {
    const text = (values[field.key] ?? '').trim();

    if (text === '') {
      if (field.optional) continue;
      return { ok: false, error: `${field.label}: required` };
    }

    if (field.kind === 'number') {
      const value = Number(text);
      if (!Number.isFinite(value)) return { ok: false, error: `${field.label}: not a number` };
      config[field.key] = value;
    } else if (field.kind === 'numberList') {
      const numbers = text.split(',').map((part) => Number(part.trim()));
      if (numbers.some((value) => !Number.isFinite(value))) {
        return { ok: false, error: `${field.label}: every entry must be a number` };
      }
      if (field.length !== undefined && numbers.length !== field.length) {
        return { ok: false, error: `${field.label}: needs exactly ${field.length} numbers (got ${numbers.length})` };
      }
      config[field.key] = numbers;
    } else {
      try {
        config[field.key] = JSON.parse(text) as unknown;
      } catch {
        return { ok: false, error: `${field.label}: not valid JSON` };
      }
    }
  }

  return { ok: true, config };
}
