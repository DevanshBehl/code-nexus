const STYLES: Record<string, string> = {
  ACTIVE: 'border-success-line bg-success-soft text-success',
  PENDING_PROFILE: 'border-warn-line bg-warn-soft text-warn',
  SUSPENDED: 'border-danger-line bg-danger-soft text-danger',
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
