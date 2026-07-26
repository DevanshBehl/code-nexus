import type { LucideIcon } from 'lucide-react';

interface StatTileProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
}

/** A single KPI tile (part of a hairline-separated row). */
export function StatTile({ label, value, icon: Icon }: StatTileProps) {
  return (
    <div className="bg-bg p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono-label text-[10px] text-faint">{label}</span>
        {Icon ? <Icon className="h-4 w-4 text-faint" aria-hidden="true" /> : null}
      </div>
      <p className="text-2xl font-semibold tracking-tight text-fg">{value}</p>
    </div>
  );
}

/** Hairline-gridded row wrapper for StatTiles. */
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  );
}
