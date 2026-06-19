import { type ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:  'primary' | 'secondary' | 'ghost' | 'danger';
  size?:     'sm' | 'md' | 'lg';
  loading?:  boolean;
}

const variants = {
  primary:   'bg-violet-600 hover:bg-violet-500 text-white',
  secondary: 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100',
  ghost:     'bg-transparent hover:bg-zinc-800 text-zinc-300',
  danger:    'bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30',
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2   text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export function Button({
  variant = 'primary',
  size    = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-2 rounded-lg font-medium
        transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500/50
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]} ${sizes[size]} ${className}
      `}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
