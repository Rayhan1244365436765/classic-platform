import type { FieldSpec } from '../api/types';
import type { FormValues } from '../pages/gameConfigForm';

type Props = {
  fields: FieldSpec[];
  values: FormValues;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
};

/** One labelled input per field spec: number, comma-separated list, or JSON textarea. */
export function GameConfigFields({ fields, values, disabled, onChange }: Props) {
  return (
    <>
      {fields.map((field) => (
        <label className="field" key={field.key}>
          <span>
            {field.label}
            {field.optional ? ' (optional)' : ''}
          </span>

          {field.kind === 'json' ? (
            <textarea
              className="textarea"
              rows={7}
              spellCheck={false}
              value={values[field.key] ?? ''}
              disabled={disabled}
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          ) : (
            <input
              type={field.kind === 'number' ? 'number' : 'text'}
              inputMode="decimal"
              min={field.min}
              max={field.max}
              step={field.step ?? 'any'}
              value={values[field.key] ?? ''}
              disabled={disabled}
              onChange={(event) => onChange(field.key, event.target.value)}
              placeholder={field.kind === 'numberList' ? 'comma-separated, e.g. 1, 2, 0.5' : undefined}
            />
          )}

          {field.help && <small className="field__help">{field.help}</small>}
        </label>
      ))}
    </>
  );
}
