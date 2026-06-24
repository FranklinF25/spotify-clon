import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { Input } from '@/components/atoms/Input/Input';
import { Text } from '@/components/atoms/Text/Text';
import styles from './FormField.module.css';

/**
 * The shape zod issues produce after field-level flattening. `FormField`
 * consumes exactly this so the login/register forms can map a `safeParse`
 * failure (or a backend VALIDATION_ERROR `details[]` entry) straight onto the
 * field.
 */
export interface FieldIssue {
  message: string;
}

interface FormFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  id: string;
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  issue?: FieldIssue;
}

/**
 * FormField molecule (DESIGN §7 + §11.1). Composes the `Input` + `Text` atoms
 * and wires the a11y contract for inline validation errors:
 *  - the `<label>` is associated with the input via `htmlFor`/`id`;
 *  - when an `issue` is present, the input gets `aria-invalid="true"` and
 *    `aria-describedby` pointing at the error message's id, so screen readers
 *    announce the problem; the message renders via the `Text` error variant.
 *
 * Presentational only — no store/hooks imports (§3 dependency rule).
 */
export function FormField({
  id,
  label,
  issue,
  onChange,
  ...rest
}: FormFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <Text as="label" variant="muted" htmlFor={id}>
        {label}
      </Text>
      <Input
        id={id}
        onChange={onChange}
        aria-invalid={issue ? 'true' : undefined}
        aria-describedby={issue ? errorId : undefined}
        {...rest}
      />
      {issue ? (
        <Text id={errorId} variant="error">
          {issue.message}
        </Text>
      ) : null}
    </div>
  );
}
