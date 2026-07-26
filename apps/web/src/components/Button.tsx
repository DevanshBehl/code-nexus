import type { AnchorHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'link';
type Size = 'md' | 'lg';

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const base =
  'group inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 focus-visible:outline-none disabled:opacity-50';

const sizes: Record<Size, string> = {
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-5 text-[15px] rounded-lg',
};

const variants: Record<Variant, string> = {
  // High-contrast monochrome: near-black button on light, near-white on dark.
  primary: 'bg-fg text-bg hover:opacity-90 active:translate-y-px',
  secondary: 'border border-line-strong text-fg hover:bg-surface-2',
  link: 'text-fg hover:text-accent px-0',
};

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  ...rest
}: ButtonLinkProps) {
  const sizeClass = variant === 'link' ? 'text-[15px]' : sizes[size];
  return (
    <a className={`${base} ${sizeClass} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </a>
  );
}
