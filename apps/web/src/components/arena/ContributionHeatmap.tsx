import { useMemo } from 'react';
import type { HeatmapDay } from '@code-nexus/types';

interface ContributionHeatmapProps {
  year: number;
  days: HeatmapDay[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function bucket(count: number): string {
  if (count <= 0) return 'bg-line/40';
  if (count <= 2) return 'bg-emerald-500/30';
  if (count <= 5) return 'bg-emerald-500/60';
  return 'bg-emerald-500';
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * GitHub-style contribution grid (weeks × days) for one year of submit activity.
 * Dependency-free, theme-aware, honest (empty days are empty). Follows the
 * dataviz honesty rules — no fabricated counts.
 */
export function ContributionHeatmap({ year, days }: ContributionHeatmapProps) {
  const counts = useMemo(() => new Map(days.map((d) => [d.date, d.count])), [days]);

  const { weeks, monthLabels, total } = useMemo(() => {
    // Start on the Sunday on/before Jan 1; end on the Saturday on/after Dec 31.
    const start = new Date(Date.UTC(year, 0, 1));
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const end = new Date(Date.UTC(year, 11, 31));
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));

    const cols: { date: Date; inYear: boolean; count: number }[][] = [];
    const labels: { col: number; label: string }[] = [];
    let sum = 0;
    const cursor = new Date(start);
    let lastMonth = -1;
    let col = 0;
    while (cursor <= end) {
      const week: { date: Date; inYear: boolean; count: number }[] = [];
      for (let d = 0; d < 7; d += 1) {
        const inYear = cursor.getUTCFullYear() === year;
        const count = inYear ? (counts.get(ymd(cursor)) ?? 0) : 0;
        if (inYear) sum += count;
        if (inYear && cursor.getUTCMonth() !== lastMonth && cursor.getUTCDate() <= 7) {
          labels.push({ col, label: MONTHS[cursor.getUTCMonth()]! });
          lastMonth = cursor.getUTCMonth();
        }
        week.push({ date: new Date(cursor), inYear, count });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      cols.push(week);
      col += 1;
    }
    return { weeks: cols, monthLabels: labels, total: sum };
  }, [year, counts]);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[13px] text-muted">
          <span className="font-semibold text-fg">{total}</span> submissions in {year}
        </p>
      </div>
      <div className="overflow-x-auto">
        <div className="inline-block">
          <div className="mb-1 flex gap-[3px] pl-1 text-[9px] text-faint">
            {weeks.map((_, i) => {
              const label = monthLabels.find((m) => m.col === i);
              return (
                <div key={i} className="w-[11px]">
                  {label ? <span className="mono-label">{label.label}</span> : null}
                </div>
              );
            })}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((day, di) => (
                  <div
                    key={di}
                    title={day.inYear ? `${ymd(day.date)}: ${day.count} submissions` : ''}
                    className={`h-[11px] w-[11px] rounded-[2px] ${
                      day.inYear ? bucket(day.count) : 'bg-transparent'
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-end gap-1 text-[9px] text-faint">
            <span>Less</span>
            <span className="h-[11px] w-[11px] rounded-[2px] bg-line/40" />
            <span className="h-[11px] w-[11px] rounded-[2px] bg-emerald-500/30" />
            <span className="h-[11px] w-[11px] rounded-[2px] bg-emerald-500/60" />
            <span className="h-[11px] w-[11px] rounded-[2px] bg-emerald-500" />
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}
