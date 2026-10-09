import type { TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'name'> & { label: string; name: string; error?: string };
export function TextArea({ label, id, error, ...props }: Props) {
  const inputId = id ?? props.name;
  return <div className="field"><label htmlFor={inputId}>{label}</label><textarea id={inputId} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} {...props} />{error && <span className="field-error" id={`${inputId}-error`}>{error}</span>}</div>;
}
