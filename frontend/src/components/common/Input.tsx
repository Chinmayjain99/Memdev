import type { InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'name'> & { label: string; name: string; error?: string };
export function Input({ label, id, error, ...props }: Props) {
  const inputId = id ?? props.name;
  return <div className="field"><label htmlFor={inputId}>{label}</label><input id={inputId} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} {...props} />{error && <span className="field-error" id={`${inputId}-error`}>{error}</span>}</div>;
}
