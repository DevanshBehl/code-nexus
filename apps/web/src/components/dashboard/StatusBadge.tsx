const STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  PENDING_PROFILE: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  SUSPENDED: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
};

const LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  PENDING_PROFILE: 'Pending',
  SUSPENDED: 'Suspended',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? 'border-line bg-surface-2 text-muted';
  return (
    <span className={`mono-label rounded-full border px-2 py-0.5 text-[9px] ${cls}`}>
      {LABEL[status] ?? status}
    </span>
  );
}
