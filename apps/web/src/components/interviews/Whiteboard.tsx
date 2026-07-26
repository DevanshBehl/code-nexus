import { useEffect, useRef } from 'react';
import { Eraser } from 'lucide-react';

/**
 * A minimal shared whiteboard. Local drags emit strokes via `onStroke`; remote
 * strokes are pushed in through `incoming` (a ref-counter bump + the stroke). A
 * "stroke" is a pair of normalized points [x0,y0,x1,y1] (0..1) so it renders the
 * same across differing canvas sizes. Ephemeral — nothing is persisted.
 */
export type Stroke = [number, number, number, number];

export function Whiteboard({
  onStroke,
  incoming,
}: {
  onStroke: (s: Stroke) => void;
  incoming: { seq: number; stroke: Stroke } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const draw = (s: Stroke): void => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.strokeStyle = getComputedStyle(c).getPropertyValue('--wb-ink') || '#888';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s[0] * c.width, s[1] * c.height);
    ctx.lineTo(s[2] * c.width, s[3] * c.height);
    ctx.stroke();
  };

  // Render an incoming remote stroke.
  useEffect(() => {
    if (incoming) draw(incoming.stroke);
  }, [incoming?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e: React.PointerEvent): { x: number; y: number } => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const clear = (): void => {
    const c = canvasRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface [--wb-ink:#334155] dark:[--wb-ink:#cbd5e1]">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="mono-label text-[10px] text-faint">Whiteboard</span>
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg"
        >
          <Eraser className="h-3.5 w-3.5" /> Clear (local)
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={500}
        className="h-full w-full flex-1 cursor-crosshair touch-none bg-white/60 dark:bg-black/30"
        onPointerDown={(e) => {
          drawing.current = true;
          last.current = pos(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = pos(e);
          const s: Stroke = [last.current.x, last.current.y, p.x, p.y];
          draw(s);
          onStroke(s);
          last.current = p;
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerLeave={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
    </div>
  );
}
