import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { CalendarEvent, CalendarEventsResponse } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { Panel } from './Panel.tsx';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Dependency-free month calendar. Consumes GET /calendar/events (empty in Phase
 * 3); Phases 4/7 populate events with zero change here (prompt_phase3.md §8).
 */
export function Calendar() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const from = useMemo(() => startOfMonth(cursor).toISOString(), [cursor]);
  const to = useMemo(
    () => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59).toISOString(),
    [cursor],
  );

  const { data } = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.get<CalendarEventsResponse>(`/calendar/events?from=${from}&to=${to}`),
  });
  const events: CalendarEvent[] = data?.events ?? [];

  const grid = useMemo(() => {
    const first = startOfMonth(cursor);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const lead = first.getDay();
    const cells: (number | null)[] = [];
    for (let i = 0; i < lead; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const monthLabel = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const today = new Date();
  const isThisMonth =
    today.getFullYear() === cursor.getFullYear() && today.getMonth() === cursor.getMonth();

  return (
    <Panel
      title="Calendar"
      action={
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="mono-label min-w-[7.5rem] text-center text-[10px] text-fg">
            {monthLabel}
          </span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="mono-label pb-1 text-[9px] text-faint">
            {w}
          </div>
        ))}
        {grid.map((day, i) => {
          const isToday = isThisMonth && day === today.getDate();
          return (
            <div
              key={i}
              className={`aspect-square rounded-md p-1 text-[12px] ${
                day == null
                  ? ''
                  : isToday
                    ? 'bg-accent-soft font-semibold text-accent'
                    : 'text-muted hover:bg-surface-2'
              }`}
            >
              {day ?? ''}
            </div>
          );
        })}
      </div>

      {events.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-[13px] text-muted">
          <CalendarDays className="h-4 w-4 text-faint" aria-hidden="true" />
          No events scheduled.
        </div>
      ) : (
        <ul className="mt-4 space-y-1 border-t border-line pt-4">
          {events.map((e) => (
            <li key={e.id} className="text-[13px] text-fg">
              {e.title}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
