import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

interface FieldWrapProps {
  label: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}

export function FieldWrap({ label, error, children, htmlFor }: FieldWrapProps) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1.5 block text-[13px] font-medium text-fg">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-danger">{error}</span> : null}
    </label>
  );
}

const inputBase =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, id, ...rest },
  ref,
) {
  return (
    <FieldWrap label={label} error={error} htmlFor={id}>
      <input ref={ref} id={id} className={inputBase} {...rest} />
    </FieldWrap>
  );
});

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  children: React.ReactNode;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, id, children, ...rest },
  ref,
) {
  return (
    <FieldWrap label={label} error={error} htmlFor={id}>
      <select ref={ref} id={id} className={inputBase} {...rest}>
        {children}
      </select>
    </FieldWrap>
  );
});

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger"
    >
      {message}
    </div>
  );
}
