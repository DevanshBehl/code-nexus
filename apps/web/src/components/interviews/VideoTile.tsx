import { useEffect, useRef } from 'react';
import { MicOff, VideoOff } from 'lucide-react';

/**
 * One video tile bound to a MediaStream (local or a remote peer). Muted for the
 * local tile to avoid echo. Shows mic/cam-off indicators.
 */
export function VideoTile({
  stream,
  label,
  muted,
  micOff,
  camOff,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  micOff?: boolean;
  camOff?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-black">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${camOff ? 'hidden' : ''}`}
      />
      {camOff || !stream ? (
        <div className="flex h-full w-full items-center justify-center text-white/50">
          <VideoOff className="h-7 w-7" aria-hidden="true" />
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <span className="truncate text-[12px] font-medium text-white">{label}</span>
        {micOff ? (
          <MicOff className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
        ) : null}
      </div>
    </div>
  );
}
