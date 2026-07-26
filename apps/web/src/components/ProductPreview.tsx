import { Video, Code2, PenTool, MessageSquare, Mic, LayoutGrid, Circle, Check } from 'lucide-react';

const CODE: { n: number; text: string; kind?: 'kw' | 'muted' }[] = [
  { n: 1, text: 'function twoSum(nums, target) {' },
  { n: 2, text: '  const seen = new Map();' },
  { n: 3, text: '  for (let i = 0; i < nums.length; i++) {' },
  { n: 4, text: '    const need = target - nums[i];', kind: 'muted' },
  { n: 5, text: '    if (seen.has(need))' },
  { n: 6, text: '      return [seen.get(need), i];', kind: 'kw' },
  { n: 7, text: '    seen.set(nums[i], i);' },
  { n: 8, text: '  }' },
  { n: 9, text: '  return [];', kind: 'kw' },
  { n: 10, text: '}' },
];

/**
 * A realistic, static representation of the in-app interview room — a synced
 * code editor beside live video, with a test-runner bar. No screenshots, no
 * real data; built entirely from markup and theme tokens.
 */
export function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-lift">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <div className="mono-label mx-auto flex items-center gap-2 rounded border border-line bg-surface px-2.5 py-1 text-[10px] text-faint">
          codenexus.app/room/IN-2481
        </div>
        <span className="mono-label flex items-center gap-1.5 text-[10px] text-faint">
          <Circle className="h-2 w-2 fill-red-500 text-red-500" />
          REC 12:04
        </span>
      </div>

      <div className="flex">
        <div className="hidden w-11 shrink-0 flex-col items-center gap-4 border-r border-line py-4 sm:flex">
          <LayoutGrid className="h-4 w-4 text-accent" />
          <Video className="h-4 w-4 text-faint" />
          <Code2 className="h-4 w-4 text-faint" />
          <PenTool className="h-4 w-4 text-faint" />
          <MessageSquare className="h-4 w-4 text-faint" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-5">
            <div className="col-span-2 flex flex-col gap-2 border-r border-line p-2.5">
              <VideoTile initials="AR" label="Recruiter" />
              <VideoTile initials="SK" label="Candidate" muted />
            </div>

            <div className="col-span-3 flex flex-col">
              <div className="flex items-center gap-3 border-b border-line px-3 py-2">
                <span className="mono-label flex items-center gap-1.5 rounded bg-accent-soft px-2 py-1 text-[10px] text-accent">
                  <Code2 className="h-3 w-3" /> two-sum.ts
                </span>
                <span className="mono-label text-[10px] text-faint">typescript</span>
              </div>

              <div className="overflow-hidden px-1 py-2.5 font-mono text-[11px] leading-[1.55]">
                {CODE.map((line) => (
                  <div key={line.n} className="flex gap-3 px-2">
                    <span className="w-4 select-none text-right text-faint/70">{line.n}</span>
                    <span
                      className={
                        line.kind === 'kw'
                          ? 'text-accent'
                          : line.kind === 'muted'
                            ? 'text-faint'
                            : 'text-muted'
                      }
                    >
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-auto border-t border-line px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="mono-label flex items-center gap-1.5 text-[10px] text-fg">
                    <Check className="h-3 w-3 text-emerald-500" /> 3 / 5 tests passing
                  </span>
                  <span className="mono-label text-[10px] text-faint">run ⌘↵</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full w-3/5 rounded-full bg-emerald-500" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
            <Tab icon={Video} label="Video" active />
            <Tab icon={Code2} label="Code" />
            <Tab icon={PenTool} label="Whiteboard" />
            <Tab icon={MessageSquare} label="Chat" />
          </div>
        </div>
      </div>
    </div>
  );
}

function VideoTile({
  initials,
  label,
  muted = false,
}: {
  initials: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-line bg-surface-2">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-surface font-mono text-[11px] font-medium text-muted">
          {initials}
        </div>
      </div>
      <span className="mono-label absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-bg/70 px-1.5 py-0.5 text-[9px] text-muted backdrop-blur">
        <Mic className={`h-2.5 w-2.5 ${muted ? 'text-faint' : 'text-emerald-500'}`} />
        {label}
      </span>
    </div>
  );
}

function Tab({
  icon: Icon,
  label,
  active = false,
}: {
  icon: typeof Video;
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
        active ? 'bg-surface-2 text-fg' : 'text-faint'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
