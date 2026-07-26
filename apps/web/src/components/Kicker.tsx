import type { ReactNode } from 'react';

interface KickerProps {
  index?: string;
  children: ReactNode;
  className?: string;
}

/** Monospace section label with an optional index, e.g. "01 / PLATFORM". */
export function Kicker({ index, children, className = '' }: KickerProps) {
  return (
    <div className={`mono-label flex items-center gap-2 text-faint ${className}`}>
      {index ? (
        <>
          <span className="text-accent">{index}</span>
          <span className="text-line-strong">/</span>
        </>
      ) : null}
      <span>{children}</span>
    </div>
  );
}
