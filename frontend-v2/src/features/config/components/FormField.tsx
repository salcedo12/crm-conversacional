import type { ReactNode } from 'react';

interface FormFieldProps {
  label:       string;
  hint?:       string;
  children:    ReactNode;
  htmlFor?:    string;
}

export function FormField({ label, hint, children, htmlFor }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold text-zinc-300"
      >
        {label}
        {hint && <span className="ml-2 text-zinc-500 font-normal">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
