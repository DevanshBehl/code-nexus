import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled content card used across dashboards. */
export function Panel({ title, action, children, className = '' }: PanelProps) {
  return (
    <section className={`rounded-2xl border border-line bg-surface ${className}`}>
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
